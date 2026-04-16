# Plan — Partner SSO via Azure B2B Guests + Agent/Support Tenant Switcher

**Date:** 2026-04-16
**Status:** Draft — awaiting review
**Author:** Claude (drafted from dialog with Bart)

## Goal

Allow partner employees (e.g. a telecom partner's own staff) to log into Guichet to help our agents or review their tenant's admin view, without building per-partner SSO infrastructure. Use Azure B2B guest federation in our existing single-tenant Azure AD setup. While at it, surface the existing `POST /switch-partner` API in AgentView and SupportView so internal staff can flip tenants mid-session.

## Background

Today:
- Single Azure AD tenant is the only IdP (`server/routes/sso.ts` hardcodes `AZURE_AD_*`).
- `partner_group_mappings` rows decide which Azure group id → (partnerId, role, departments).
- Internal staff authenticate via our Azure, auto-provisioned into one or more partners based on group membership. Multi-partner staff can switch mid-session via `PartnerSwitcher` — but that component is only rendered in `AdminView`.
- Partner employees cannot currently log in at all because they're not in our Azure AD.

Requirement:
- Invite partner employee as Azure B2B guest in our tenant. Add them to a partner-specific Azure group. SSO + group mapping does the rest.
- Strict rule: a guest maps to **exactly one** partner. Multi-partner mapping for a guest is a misconfiguration and must fail closed.
- Guest admin gets Full AdminView **except destructive mutations** (webhook secrets, SSO mapping edits, member removal of non-guests, etc.).
- Render a "GUEST" badge next to external users in team/queue/chat UI.
- Agents and support (internal) should be able to switch partner mid-session — not just at login.

## Scope

### In

1. `users.isExternal` boolean column + migration.
2. SSO callback updates (`server/routes/sso.ts`):
   - Detect Azure B2B guest via claims (`acct === 1`, or home-tenant `tid` differs from our tenant id, or `idp` claim present).
   - Set `users.isExternal` at upsert time.
   - After resolving `targetMemberships` (line ~341), if `isExternal === true` and `targetMemberships.size > 1`, reject login with `?sso_error=guest_multi_partner_mapping`. Log audit entry with both partnerIds and the matched Azure group ids. No memberships written, no cookie issued.
   - If `isExternal === true` and `targetMemberships.size === 0`, reuse the existing `no_matching_groups` path.
   - Internal-staff behavior (auto-migrate on group change, lines 411–430) is unchanged.
3. `destructiveAdminProcedure` middleware in `server/trpc/trpc.ts`:
   - Builds on `adminProcedure`, adds `if (ctx.user.isExternal) throw FORBIDDEN`.
   - Applied to: webhook create/update/delete, webhook secret rotation/reveal, SSO group-mapping CRUD (`platform.sso.*`), member removal where target role is `admin`, partner auth-method edits, any integration secret mutation. Concrete list produced by pre-implementation grep — see Task 3.
4. UI GUEST badge:
   - `client/src/components/GuestBadge.tsx` — brutalist outlined badge, mono uppercase "GUEST", `accent-amber` text, no icon, no radius (except tokens already forbid it).
   - Expose `isExternal` in `user.me` tRPC output and in `presence.listTeam` / `support.onlineUsers` payloads used by QueueSidebar.
   - Render in: `QueueSidebar` team rows, `AdminTeam` table row, `ChatHeader` participant line, `MessageBubble` sender label next to display name, `UserMenu` self (only when viewing own identity).
5. Partner switcher in AgentNav + SupportNav:
   - Render `<PartnerSwitcher />` inside `client/src/components/agent/AgentNav.tsx` and `client/src/components/support/SupportNav.tsx`, positioned between partner-name text and the right-side controls.
   - Extend `PartnerSwitcher` with a confirmation dialog when switching:
     - Agent: always confirm ("Switch tenant? Your current ticket draft will be lost.") — reads draft state from store.
     - Support: confirm if any open chat tab has an in-progress composition; otherwise switch silently.
     - Admin: unchanged (no in-flight user data).
   - Switch triggers socket reconnect (existing behavior via new JWT) — verify presence re-emits `status:set` to the new partner.
6. Runbook doc: `docs/superpowers/specs/partner-sso-b2b-guest.md` — Azure admin steps (invite guest, create per-(partner,role) group, add guest to group, create `partner_group_mappings` row in Guichet AdminView or via platform ops), expected user experience, security caveats, troubleshooting matrix.
7. Tests:
   - Server unit: SSO callback sets `isExternal` correctly for guest vs member token shapes (fixture tokens).
   - Server unit: SSO callback rejects guest with multi-partner mapping, no memberships written.
   - Server unit: `destructiveAdminProcedure` throws FORBIDDEN when `ctx.user.isExternal === true`.
   - Server unit: each destructive mutation now uses `destructiveAdminProcedure` (table-driven test iterates the list from Task 3).
   - E2E (`testing/e2e/partner-guest-b2b.spec.ts`): seed an external user with admin membership in partner A; verify admin panels visible; verify webhook save button disabled/hidden; verify deleting a member fails with FORBIDDEN.
   - E2E (`testing/e2e/partner-switcher-agent.spec.ts`): internal agent with memberships in A + B can flip tenants via AgentNav switcher; confirm dialog appears when a draft exists.

### Out

- Per-partner SSO IdP / multi-IdP architecture (that's the big Option B plan, deliberately deferred).
- Automatic provisioning of B2B guests from Azure Graph (invite still happens by Azure admin manually or via PlatformView link-out).
- Changing `partner_group_mappings` schema (`azureGroupId` stays Azure-specific — fine for single-IdP world).
- Restricted/read-only admin role. We chose the blocklist approach (full admin minus destructive), not a new role.
- Localization of new strings (GUEST badge, confirm dialog, runbook) — add NL/FR after initial English ships.

## Tasks (sequenced)

1. **Schema migration**
   - Add `is_external boolean not null default false` to `users`.
   - Generate + apply via `docker compose exec server npx drizzle-kit generate` then `npm run db:migrate`.
   - Backfill: all existing rows → `false` (default covers it).

2. **SSO callback — guest detection + single-partner enforcement**
   - Add `detectIsExternal(claims)` helper in `sso.ts`.
   - On upsert, write `isExternal`.
   - New branch at line ~341 after group resolution: reject if guest + size≠1.
   - Unit tests with fixture claims for internal, guest-single, guest-multi, guest-zero.

3. **Identify + convert destructive admin mutations**
   - Grep: `grep -rn 'adminProcedure' server/trpc/routers/` — enumerate all `adminProcedure` mutations.
   - Review manually; tag each as destructive or not per the criteria (touches secrets, removes/grants access, changes auth config, deletes data).
   - Introduce `destructiveAdminProcedure` in `server/trpc/trpc.ts`.
   - Swap the tagged procedures over.
   - Update router barrel exports unchanged.

4. **Expose `isExternal` in user payloads**
   - Add to `user.me` output schema.
   - Add to presence listings used by `QueueSidebar` and `AdminTeam`.
   - Update `client/src/types/index.ts` `User` / `OnlineSupport` interfaces.

5. **GuestBadge component + placements**
   - Build component following brutalist tokens (mono, uppercase, outline border, `accent-amber` text, no radius, no shadow).
   - Render in the five UI spots listed above. One integration test per spot via existing component tests where they exist; otherwise rely on E2E.

6. **PartnerSwitcher in AgentNav + SupportNav**
   - Read existing `AgentNav.tsx` / `SupportNav.tsx` and drop `<PartnerSwitcher />` in between partner-name text and the right-side controls.
   - Extend `PartnerSwitcher` to accept optional `confirmBeforeSwitch?: 'always' | 'if-dirty' | 'never'` prop (default `never` to preserve AdminView behavior).
   - Wire the switcher in AgentNav with `confirmBeforeSwitch="always"` when a ticket form has unsaved data (read from store); `"if-dirty"` in SupportNav based on active chat compose state.
   - Ensure socket reconnects on switch re-emits presence to new partner (verify in E2E).

7. **Runbook doc**
   - Write `docs/superpowers/specs/partner-sso-b2b-guest.md` with sections: Prerequisites, Invite flow (step-by-step with Azure portal screenshots placeholder), Group + mapping setup in Guichet, User experience, Security model, Troubleshooting, FAQ.

8. **CHANGELOG + CLAUDE.md**
   - CHANGELOG entry under next unreleased version.
   - Add a short paragraph to CLAUDE.md under "SSO-Only Auth" mentioning B2B guest support and the destructive-admin blocklist.

## Verification

Before claiming done:
- `powershell -File scripts/ci.ps1` — all 5 steps pass.
- Manual: two test Azure users — one internal member of `partner-a-agent` + `partner-b-agent` groups; one B2B guest in `partner-a-admin` only. Verify:
  - Internal user sees both partners in switcher, can flip without re-login.
  - Guest user logs in, lands in partner A, sees GUEST badge on their own UserMenu, cannot click webhook create, cannot remove a member.
  - Guest user added to `partner-b-admin` group in Azure → next login rejected with clear error.
- Audit log entries present for: guest rejection, destructive mutation denied, guest admin membership creation.

## Risks / Open questions

- **Email claim shape for B2B guests** is sometimes missing — Azure may send it in `preferred_username` with the guest's home email, or omit it. Current SSO callback already falls back; confirm during implementation.
- **Group overage** (user in >200 groups, line 314) — already handled. Guests with overage can't log in because groups claim is truncated. Accepted: partners don't typically have this problem; document.
- **Webhook secret visibility** — if the existing UI already masks secrets for admins, fewer places need guarding. Verify during Task 3.
- **If partner IT refuses B2B federation**, we have no fallback in this plan. That's the signal to revisit Option B (per-partner SSO). Not in this scope.

## Definition of done

- All Scope-In items shipped.
- `scripts/ci.ps1` green.
- Manual verification matrix above passes.
- CHANGELOG + CLAUDE.md updated.
- Runbook published under `docs/superpowers/specs/`.
- At least one real B2B guest smoke-tested in dev against a seeded partner.
