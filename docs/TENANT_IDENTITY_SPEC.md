# Tenant Identity Spec

## Current Scope

Guichet currently models only internal company users. Tenant-company end users are out of scope for now and should not drive the authentication design.

- `users` are internal employees of Guichet
- `partners` are customer organizations and should be treated as tenants
- `memberships` link internal users to one or more tenants

In product language:

- `agent`: asks support questions inside assigned tenants
- `support`: answers questions inside assigned tenants
- `admin`: tenant admin for assigned tenants
- `platform_operator`: platform admin with global access

The codebase still uses `partner`, `admin`, and `platform_operator` names. Functionally these map to:

- `partner` -> tenant
- `admin` -> tenant admin
- `platform_operator` -> platform admin

## Identity Model

Authentication and tenant access are separate concerns.

- Authentication answers: who is this internal user?
- Authorization answers: which tenant can this internal user access, and with what role?

### Authentication

Production default:

- all users — platform operators, tenant admins, support, agents — authenticate via Microsoft Entra / Azure SSO
- partner employees without a corporate Azure tenant join via Azure B2B guest invites and sign in with their home IdP
- the `users` table stores no password, MFA, lockout, or step-up state

Auth method per partner:

- All partners are SSO-only. The current schema has never carried password / MFA / lockout / step-up / `auth_method` columns — Guichet shipped clean as SSO-only, no historical local-auth subsystem to migrate away from.

Non-SSO login paths:

- `/api/v1/auth/dev-login` mints JWTs by `userId` for the demo picker and Playwright suite. The route returns 404 when `NODE_ENV=production`.
- The break-glass CLI (`server/scripts/break_glass.ts`) mints a short-lived JWT (1–60m) for a platform operator when SSO is unavailable. Writes an `auth.break_glass` audit row. See `docs/BREAK_GLASS_RUNBOOK.md`.

### Authorization

Tenant access is granted by `memberships`.

- one user may belong to multiple tenants
- one tenant may contain many users
- each membership carries the tenant-scoped role and department scope

## Role Model

### Platform-wide role

`platform_operator`

- creates tenants
- manages global settings
- assigns tenant admins and other tenant memberships
- can enter tenant context without an explicit membership when required by platform workflows

### Tenant-scoped roles

`agent`

- creates support tickets/questions
- works only inside assigned tenants

`support`

- views and answers support tickets/questions
- works only inside assigned tenants

`admin`

- tenant admin
- manages labels, departments, business hours, and tenant team membership
- works only inside assigned tenants

## Assignment Rules

Membership assignment is fully Azure-driven. Guichet has no UI flow to invite
users, change roles, or revoke memberships — the partner-side
`inviteExternalUser` / `updateMember` / `removeMember` mutations and the
platform-side `inviteUser` / `updateMembership` / `removeMembership` /
`revokePendingInvite` mutations were removed. The only surviving partner-side
member knob is `partner.updateMemberDepartments` (admin-only, narrow scope —
flips department visibility for an existing member). `platform.deleteUser`
survives only as a non-prod test fixture (`testFixtures.deleteUser`). To
grant, change, or revoke access generally, a platform admin updates Azure
security group assignments in Entra; the SSO callback then provisions or
syncs memberships on next login.

- `platform_operator` can create tenants (`platform.createPartner`)
- tenant creation is the only identity-related mutation that survives in Guichet's UI
- everything else (memberships + roles + B2B guest provisioning) flows through Azure

SSO group mapping:

- `partner_group_mappings` table maps Azure group IDs to tenant roles + departments
- on SSO login, matched groups auto-provision or update `source='sso'` memberships
- a strict single-partner rule rejects B2B guests whose groups resolve to >1 partner
- the only configurable Guichet-side surface is the SSO mappings panel in PlatformView

## Data Model

Current tables already fit the agreed design:

- `users`
- `partners`
- `memberships`

Useful interpretation:

- `users.id` = internal identity
- `partners.id` = tenant identifier
- `memberships(user_id, partner_id)` = tenant access grant

## Future Extension

If tenant-company users are added later, they should be modeled separately from internal users.

Do not overload the current internal `users` model with tenant-owned identities until the product explicitly needs customer-side login.

## Permission Matrix

Current intended behavior:

- `agent`
  - create tickets
  - view own ticket conversations
  - work only inside assigned tenants

- `support`
  - view and answer tickets in assigned tenants
  - participate in support presence and queue workflows
  - export ticket data in assigned tenant context

- `admin` (`tenant admin`)
  - everything `support` can do
  - manage labels, departments, business hours, and canned responses
  - read-only roster view of the tenant team (assignments flow through Azure groups)

- `platform_operator` (`platform admin`)
  - create and manage tenants
  - manage platform-wide settings + SSO group mappings (Azure group → role + departments)
  - read-only roster across tenants
  - enter tenant context explicitly when acting inside one tenant

## Auth Flow

### SSO auth (sole production path)

1. User authenticates through Microsoft Entra / Azure.
2. Existing user is matched by `external_id` (Azure OID) or email.
3. Optional group mapping provisions tenant memberships for SSO-managed tenants (via `partner_group_mappings`).
4. Memberships are loaded.
5. If the user has multiple memberships, the client selects a tenant context.
6. The issued JWT carries:
   - `userId`
   - `role`
   - `partnerId`
   - `membershipId`
   - `isPlatformOperator`
   - `isExternal` (B2B-guest flag)
   - `departments` (department-scope array from the active membership)
   - `jti` (per-token id used by the Redis revocation gate)

### Dev-login (non-prod only)

1. Client calls `/api/v1/auth/dev-login` with `{ userId }`.
2. Route returns 404 when `NODE_ENV=production`; otherwise mints a JWT using the same session builder as the SSO path.
3. Used by the demo picker and the Playwright suite.

### Break-glass

1. Operator runs `docker compose exec server npx tsx server/scripts/break_glass.ts <email> [ttlMinutes]`.
2. CLI enforces `isPlatformOperator`, mints a JWT with TTL clamped to 1–60 minutes.
3. Writes an `auth.break_glass` audit row. The `actor_id` column on the row identifies the operator; `metadata` carries `{ jti, ttlMinutes, email }`.

### SSO auth — Azure B2B guest federation

Partner employees can log in without a local account or a separate IdP by
being invited into our Azure tenant as B2B guests. They authenticate via
their home tenant; Azure vouches for them; our SSO callback sees a token
issued by our tenant with the `acct=1` claim (or an `idp` claim) and marks
the Guichet user as external.

- `users.is_external` is set at every SSO login from `claims.acct === 1 || !!claims.idp`. The flag is refreshed on each login so a member→guest or guest→member change in Azure auto-syncs.
- **Strict single-partner rule**: a guest whose Azure groups resolve to more than one partner is rejected with `sso_error=guest_multi_partner_mapping`. An audit entry (`sso.guest_multi_partner_rejected`) is written with `partnerIds` + `groupCount` — never the full group array. Internal staff keep the existing multi-partner behavior and can use `PartnerSwitcher`.
- **Admin guest gates** — capability checks resolved inline at each callsite via `trpcActor(ctx, { capability })` (no shared procedure wrapper; the rules live once in `server/services/auth/capabilities.ts`). Operators bypass both rules.
  - **Destructive mutations** (`destructive_admin` capability) throw FORBIDDEN when `ctx.user.isExternal === true`: webhook CRUD + secret rotation + test (`webhook.{create, update, delete, regenerateSecret, test}`), partner department + SLA edits (`partner.{updateDepartments, updateDepartmentSla}`), label CRUD (`label.{create, update, delete}`), canned-response CRUD (`cannedResponse.{create, update, delete, regenerate, backfillUntranslated}`).
  - **Internal-only admin reads** (`audit_read` capability — same effective rule today, separately named for future divergence): `partner.listAdmins` (admin roster), `partner.audit.{getAuditLog, getForTicket}` (actor `users.name` join would leak platform-operator identities).
  - Plain `adminProcedure` covers the default case: admin reads safe for guests.
- **UI signal**: a `GuestBadge` renders next to guest names in `UserMenuChip`, `AdminTeam`, and the SupportView `SidebarFooter` team panel. Driven by `users.isExternal` exposed via `trpc.user.me` and batch-looked-up in `trpc.status.getTeamStatus`.
- Platform operators are never external by definition (staff authenticate via our tenant as members, `acct !== 1`). The capability rule short-circuits for operators regardless of the JWT claim.
- The capability check reads `isExternal` from the JWT claim on `ctx.user`. Pre-flip tokens cannot evade the gate because every flag flip atomically revokes the user's sessions + refresh-token families before the next request can land — see `services/auth/isExternalFlip.ts`.

SSO callback wiring lives in `server/routes/sso.ts`; capability rules in `server/services/auth/capabilities.ts`; JWT-flip cascade in `server/services/auth/isExternalFlip.ts` (re-exported from the `services/auth/` barrel).

## Current Implementation Rules

- The codebase should prefer shared permission helpers over raw role string checks.
- Platform-wide behavior should key off `isPlatformOperator`, not synthetic tenant memberships.
- Tenant-scoped behavior should key off membership role.
- Legacy routes must still enforce tenant scope explicitly, even if newer tRPC flows already do.

## Migration Strategy

The current recommendation is evolutionary, not disruptive:

1. Keep storage-compatible names in the database for now.
2. Use business-language terminology in docs and UI:
   - `tenant`
   - `tenant admin`
   - `platform admin`
3. Centralize permission logic before attempting any schema rename.
4. Only rename `partner` to `tenant` at the persistence layer after:
   - route and socket authorization are fully centralized
   - tests cover membership and tenant-context behavior
   - platform workflows are stable

## Platform Admin Hardening

Platform admins are the highest-risk internal identities in the system.

Recommended controls:

- enforce MFA at the Azure tenant level for all platform admins
- keep the number of platform admins small
- audit all platform-admin actions that cross tenant boundaries
- require explicit tenant entry before platform admins operate inside a tenant
- avoid break-glass use in day-to-day operations

### Break-Glass Access

When SSO is unavailable, a platform operator can mint a short-lived JWT via the break-glass CLI (`server/scripts/break_glass.ts`):

- CLI runs inside the server container — no external network dependency
- TTL is clamped to 1–60 minutes (default 15)
- target user must exist with `is_platform_operator = true`
- every mint writes an `auth.break_glass` audit row
- no passwords, recovery codes, or secondary secrets are stored — access is gated by shell/container access to production

See `docs/BREAK_GLASS_RUNBOOK.md` for the operational procedure.

## Session Revocation

The platform now supports Redis-backed session revocation without a database migration.

### Model

- every JWT includes a unique `jti`
- current-session logout revokes the active `jti`
- platform admins can revoke all sessions for a user by setting a per-user `revoked_after` cutoff
- auth middleware and tRPC context both reject:
  - explicitly revoked token IDs
  - tokens issued at or before a user's `revoked_after` cutoff

### Operational Use

- normal logout:
  - revoke the current token

- force logout after security event:
  - revoke all sessions for the affected user

- break-glass cleanup:
  - revoke all sessions for the break-glass account after the incident
  - rotate the secret
  - review the audit trail

### Constraints

- revocation depends on Redis availability
- if Redis is unavailable, JWT verification still works, but revocation checks degrade
- because of that, platform-admin and break-glass operations should treat Redis health as security-relevant infrastructure

### Auditing Expectations

At minimum, audit these privileged actions:

- platform tenant entry
- tenant creation, deactivation, and deletion
- membership grants and removals
- session revocation actions
- tenant-admin grants and revocations
- SSO group mapping changes
- mail/system configuration changes
