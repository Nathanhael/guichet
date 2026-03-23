# Tenant Identity Spec

## Current Scope

Tessera currently models only internal company users. Tenant-company end users are out of scope for now and should not drive the authentication design.

- `users` are internal employees of Tessera
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

- internal users authenticate with Tessera-controlled identity
- preferred path is Microsoft Entra / Azure SSO
- local passwords are allowed only for development, testing, or break-glass accounts

Local password policy:

- new local passwords are hashed with `Argon2id`
- `bcrypt` is not supported for new development

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

Default policy:

- `platform_operator` can create tenants and assign any tenant membership
- `admin` can assign only `agent` and `support` memberships inside their own tenant
- `admin` cannot assign another `admin` by default
- `admin` cannot create tenants

This is now enforced in the tenant admin UI and partner router APIs.

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
  - manage labels, departments, business hours, and tenant team setup
  - assign `agent` and `support` to the same tenant
  - cannot grant `admin` by default

- `platform_operator` (`platform admin`)
  - create and manage tenants
  - manage platform-wide settings
  - assign any tenant membership
  - enter tenant context explicitly when acting inside one tenant

## Auth Flow

### Local auth

1. User authenticates with email/password.
2. Password is verified with `Argon2id`.
3. Memberships are loaded.
4. If the user has multiple memberships, the client selects a tenant context.
5. The issued JWT carries:
   - `userId`
   - `role`
   - `partnerId`
   - `membershipId`
   - `isPlatformOperator`
   - `platformStepUpAt` when platform TOTP verification has been completed

### SSO auth

1. User authenticates through Microsoft Entra / Azure.
2. Existing user is matched by external subject or email.
3. Optional group mapping provisions tenant memberships for SSO-managed tenants.
4. Memberships are loaded using the same session builder as local auth.
5. The same JWT/session shape is returned as local auth.

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

- require TOTP-based MFA for all platform admins
- keep the number of platform admins small
- audit all platform-admin actions that cross tenant boundaries
- require explicit tenant entry before platform admins operate inside a tenant
- avoid permanent break-glass use in day-to-day operations

### Current Step-Up Enforcement

The current implementation enforces platform-admin step-up in code:

- platform admins configure a TOTP secret on their `users` record
- local login and Entra SSO still establish the base session
- privileged platform actions require a recent TOTP verification
- the verification result is carried in the JWT as `platformStepUpAt`
- the active step-up window is controlled by `PLATFORM_STEP_UP_WINDOW_MINUTES`

Protected paths now include:

- all `platformProcedure` tRPC operations
- platform-user session revocation
- explicit tenant entry through `POST /api/v1/auth/enter-partner`

`isPlatformOperator` alone is no longer sufficient for privileged platform actions.

### Break-Glass Accounts

If break-glass accounts are needed:

- keep them local to Tessera, not dependent on external SSO availability
- store passwords with `Argon2id`
- keep them separate from normal daily accounts
- protect them with strong secrets and out-of-band storage procedures
- monitor and audit every login and tenant entry
- review and rotate them on a schedule

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
