# PRD: Hide admin roster from B2B guest admins

## Problem Statement

B2B guest admins (external users invited into our Azure tenant via Entra B2B) currently see the internal admin roster in `AdminTeam` — names, emails, and audit chips of platform/admin staff. That's internal-only PII a guest partner organization should never learn. Guests have a legitimate need to manage *their* support staff and agents inside their partner; they have no business reading the list of internal Guichet staff who hold admin tier on their tenant.

## Solution

Hide the admin roster section from B2B guest viewers at both layers:

- **Server (source of truth):** the `partner.listAdmins` read endpoint refuses guest callers with FORBIDDEN.
- **Client (defense-in-depth):** `AdminTeam` skips the tRPC query when the viewer is `isExternal`, and the admin chip row is omitted from the render tree.

The rest of the admin UI is unchanged — guests retain access to manage their own support staff and agents (gated for *destructive* operations by the existing `destructiveAdminProcedure` + `<ExternalGuestGuard>` pattern). This PRD adds a sibling pattern for *reads* that expose internal-only data.

## User Stories

1. As a partner B2B guest admin, I want to manage my organization's support staff and agents, so that I can run the support operation for my partner.
2. As a partner B2B guest admin, I must NOT see the internal admin roster, so that I never learn the identities or contact details of the platform's internal staff.
3. As an internal partner admin (non-guest), I want to see the admin roster as I always have, so that I retain audit visibility into who holds admin tier on my partner.
4. As a platform operator entered into a partner via `/enter-partner`, I want to see the admin roster on that partner, so that I can audit admin assignments across tenants.
5. As a platform operator, I am never `isExternal=true`, so that the gate never accidentally hides data from me.
6. As an attacker scraping the API directly with a guest token, I cannot retrieve the admin roster from `partner.listAdmins` — the server throws FORBIDDEN.
7. As a future developer who removes the client-side gate by mistake, the server still refuses the data, so the failure mode is empty UI state, not leaked PII.
8. As a future developer adding a different "internal-only read" endpoint (e.g. group mappings, internal audit metadata), I have a named server primitive `internalAdminReadProcedure` to apply, so I don't hand-roll the same DB lookup and pattern again.
9. As a future developer reading `server/trpc/trpc.ts`, the `destructiveAdminProcedure` docstring tells me there's a read-side sibling and when to use which, so the contract is explicit instead of folkloric.
10. As an automated test runner, I have a server test proving the endpoint returns data for internal admins, returns data for platform operators, and throws FORBIDDEN for guests, so the security boundary is regression-proofed.
11. As an automated test runner, I have a client test proving the tRPC query is never invoked when the viewer is a guest, so we catch the regression where someone strips the server gate but TanStack Query cache or stale render leaks the data.
12. As a partner admin of any flavor, the `AdminTeam` view loads without errors regardless of my `isExternal` status, so the new gate doesn't break the page.
13. As a B2B guest admin loading `AdminTeam`, I see no "this section is hidden" empty-state hint or placeholder for the admin row — silent omission is correct because I should never have known the section existed.

## Implementation Decisions

- **New server primitive `internalAdminReadProcedure`** in `server/trpc/trpc.ts`, defined as `adminProcedure.use(blockExternalUsers)` — mirroring the shape of `destructiveAdminProcedure`. The existing `blockExternalUsers` middleware already performs the DB lookup for `users.isExternal` and throws FORBIDDEN; the new primitive is a one-line composition.
- **Update the `destructiveAdminProcedure` docstring** to reference `internalAdminReadProcedure` and clarify the dichotomy:
  - `destructiveAdminProcedure` — admin mutations a guest may not perform.
  - `internalAdminReadProcedure` — admin reads that expose internal-only PII a guest may not see.
  - Plain `adminProcedure` — admin reads safe for guests (the default; covers the majority of routes).
- **Refactor `partner.listAdmins`** to use `internalAdminReadProcedure`. Remove the inlined hand-rolled DB lookup currently in WIP — the middleware does it. This is intentional: name the pattern once, at introduction, rather than ship the inlined version and refactor later when someone has already copy-pasted it.
- **Platform operator bypass** is handled inside `blockExternalUsers` already (operators authenticate via internal SSO with `acct=member`, so `isExternal` is never true for them). No router-level operator branch needed.
- **Client gate in `AdminTeam.tsx`:**
  - `enabled: !!activeMembershipId && !isExternal` on the `partner.listAdmins` tRPC query.
  - Render guard `!isExternal && admins && admins.length > 0` on the admin chip row.
  - `isExternal` sourced from the existing `useIsExternalAdmin()` hook.
- **No new schema, no new audit events, no new translation strings.** Silent hide. Repeated FORBIDDEN attempts would surface in Express request logs if needed.
- **No change** to `useIsExternalAdmin`, `<ExternalGuestGuard>`, `disabledIfExternal()`, `<GuestBadge>`, or any other existing guest primitive — those serve the destructive-mutation pattern unchanged.

## Testing Decisions

A good test asserts external behavior at the security boundary, not implementation details. For the server: viewer role + `isExternal` flag → output (data or FORBIDDEN). For the client: viewer flag → was the network query invoked.

- **Server — `partner.listAdmins` behavioral test.** Colocated next to the existing `server/trpc/routers/partner.*.test.ts` files (this pattern is established). Three cases, all asserting the visible behavior of the procedure call:
  1. Internal admin caller (`isExternal=false`, role=`admin`) → returns the admin roster.
  2. Platform operator caller (`isPlatformOperator=true`) → returns the roster, operator bypass holds.
  3. B2B guest admin caller (`isExternal=true`, role=`admin`) → throws `FORBIDDEN`.

  Prior art: `presence.test.ts` and `support.test.ts` use `createCaller({ user })` with `vi.mock` on the DB module — match that style. The `presence.test.ts` mock pattern for `users` table reads is the closest analogue.

- **Client — `AdminTeam.test.tsx` behavioral test.** One focused test:
  - When the viewer is `isExternal=true`, the `partner.listAdmins` tRPC query is *never invoked*.
  - Assert via the tRPC mock spy (`vi.fn` on the underlying `useQuery` or fetch). Do NOT assert "admin name not visible in DOM" — that's a render-only smoke test and is explicitly forbidden by `CLAUDE.md`.
  - The query-not-invoked assertion catches the real regression risk: someone strips the server gate, the cached or in-flight result leaks data, the UI renders it.

- **No additional test for the chip-row render guard.** It is tautological if the query is gated and is therefore covered transitively by the query-not-invoked assertion.
- **No E2E test.** The server boundary test plus the client behavior test fully cover the security boundary; an E2E would re-prove the same invariant more slowly without exercising any additional integration surface.

## Out of Scope

- **Documentation update** to `docs/superpowers/plans/2026-04-16-partner-sso-b2b-guest.md` (or a new addendum) describing the read-side guest gate as a sibling pattern to the destructive-mutation gate. Zero-runtime-impact; deferred per standing user preference for cosmetic doc work. Revisit once a second caller of `internalAdminReadProcedure` appears.
- **Audit sweep** of the rest of the admin UI (AdminWebhooks, AdminDepartments, AdminAlerts, AdminFeedback, GroupMappingsPanel, audit drawers, etc.) for *other* internal-only PII reads that should also be gated for guests. This PRD scopes to `partner.listAdmins` only; a separate audit pass should sweep siblings.
- **Empty-state hint** for guests indicating the section was intentionally hidden. Silent omission is correct UX — they shouldn't know the section exists.
- **Audit logging of denied guest attempts** on the server. Express request logs cover it; a dedicated `audit_log` row per FORBIDDEN would just create noise.
- **Changes to guest invitation, lifecycle, removal, or session-revocation flows.**
- **Any client-side caching purge** when a user's `isExternal` flag changes mid-session — the flag is set at SSO callback and doesn't mutate during a session, so this is moot.

## Further Notes

- This is a follow-on to the partner-SSO B2B guest spec (`docs/superpowers/plans/2026-04-16-partner-sso-b2b-guest.md`) and the visible-disable plan (`docs/superpowers/plans/2026-04-17-guest-admin-visible-disable.md`). The pattern up to now has been "guest may see but may not mutate" via `destructiveAdminProcedure` + `<ExternalGuestGuard>`. This PRD introduces the read-side counterpart: some reads expose internal-only PII and must be hidden, not merely disabled.
- The current WIP diff inlines the gate in the router body. The recommendation in this PRD is to refactor that to the new `internalAdminReadProcedure` middleware *before merge*, not as a follow-up — naming a pattern once at introduction is cheaper than naming it later after copy-paste.
- The DB hit cost added by `blockExternalUsers` on `listAdmins` calls is one row by primary key (`users.id`). Identical cost to what every destructive mutation already pays. Negligible.
- The companion file change in `client/src/components/admin/AdminTeam.tsx` already gates the query and render path correctly. The client side is closed; only the server inline-vs-middleware decision is open.
- The new server primitive's name is deliberately verbose (`internalAdminReadProcedure`, not `gatedReadProcedure` or `adminReadGuestBlocked`) to make grep findability and intent both obvious from the call site.
