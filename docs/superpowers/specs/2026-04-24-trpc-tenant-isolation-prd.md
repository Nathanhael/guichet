# PRD — tRPC Tenant-Isolation Hardening

## Problem Statement

Engineers working on Guichet's tRPC API cannot tell, by looking at a route, whether it is safe against cross-tenant data access. Two conventions are mixed across the router folder:

- Some endpoints derive `partnerId` from the JWT context (safe, server-trusted).
- Others accept `partnerId` as a client-supplied input and authorize it with hand-written checks (`!== ctx.user.partnerId`, `assertMembership(...)`, if-else branches on `isPlatformOperator`).

A second, subtler class: endpoints that accept an object ID (`ticketId`, `messageId`) and load by ID first, then check the loaded row's `partnerId` afterward. Every new route re-writes that check. One forgotten check = silent cross-tenant leak.

From the engineer's perspective: writing a new tenant-scoped endpoint correctly requires remembering an unwritten checklist. From the reviewer's perspective: catching a forgotten check requires reading every route in full. From the security auditor's perspective: there is no single place to grep for "where do we cross tenants?"

## Solution

Make server-trusted partner scoping (from JWT) the default everywhere, and concentrate the two legitimate cross-tenant mechanisms into:

1. **A single helper module** (`server/services/membership.ts`) exporting `assertMembership` (for multi-partner users browsing their own memberships before "entering" one) and `loadTicketForUser` (for routes that take a ticket ID and need to verify tenant ownership in one call).
2. **An allowlist** of exactly two locations where `partnerId` may appear as an input field: `server/trpc/routers/support.ts` (multi-partner user pre-entry browsing) and `server/trpc/routers/platform/**` (platform-operator cross-tenant operations, gated by `platformProcedure`).
3. **A CI grep guard** that fails the build if `partnerId` input appears anywhere else.
4. **Policy alignment with Socket.io**: platform operators cannot cross tenants through the normal API surface — they must "enter" a partner (minting a new JWT) or use a dedicated `platform.*` endpoint.

This lets engineers read a route top-to-bottom and know its tenant story from the procedure type and a one-liner helper call, reduces cross-tenant checks from ten lines of copy-paste to one import, and gives reviewers a grep target for future drift.

## User Stories

1. As a backend engineer, I want `partnerId` to come from the JWT by default, so that I cannot accidentally trust a client-supplied value.
2. As a backend engineer, I want a single shared helper to verify "user X belongs to partner Y," so that I do not re-implement membership checks in every router.
3. As a backend engineer, I want a single shared helper to load a ticket with tenant verification, so that I do not write load-then-check blocks by hand.
4. As a backend engineer, I want CI to fail if I accidentally add a `partnerId` input field outside the allowlist, so that I get fast feedback instead of a production leak.
5. As a code reviewer, I want to search for `input.partnerId` in the router folder and see only two files, so that my audit surface is finite and finite.
6. As a code reviewer, I want every tenant-scoped ID lookup to go through one helper function, so that I can verify tenant enforcement by inspecting one call site, not ten.
7. As a security auditor, I want documentation in `CLAUDE.md` that states the tenant-isolation invariant plainly, so that new contributors find the rule before writing code.
8. As a platform operator, I want to "enter" a partner in order to act on its data, so that my cross-tenant actions are captured in the audit log at the boundary.
9. As a platform operator, I want dedicated cross-tenant listing endpoints for platform dashboards that do not require "entering," so that I can monitor across partners from the platform view.
10. As a multi-partner support user, I want to browse per-partner data before picking a partner, so that the partner switcher can display live information from all my memberships.
11. As a multi-partner support user, I want my cross-membership queries to reject partners I do not belong to, so that the switcher cannot be manipulated to view partners I was never granted.
12. As an API consumer, I want `presence.getOnlineStatus` to derive the partner from my session rather than accept it as input, so that the interface is simpler and the result always matches my active partner.
13. As an API consumer, I want `ticket.list` to behave identically for all in-tenant roles (agent, support, admin), so that clients do not branch on role to decide whether to pass `partnerId`.
14. As a platform admin UI developer, I want a clearly named `platform.listPartnerTickets` endpoint for cross-partner ticket views, so that I do not repurpose the tenant-scoped endpoint.
15. As a WebSocket handler maintainer, I want the REST layer to use the same tenant-isolation semantics as `server/socket/partnerScope.ts`, so that the two surfaces stay in sync and a port from one to the other is mechanical.
16. As a test author, I want to write a unit test for tenant enforcement once (against the helpers) and not in every route, so that tests stay fast and central.
17. As a future contributor adding a ticket-scoped endpoint, I want the correct pattern to be the shortest path (one helper call), so that the safe choice is also the easy choice.
18. As a future contributor, I want to see a grep-enforced rule in CI output, so that I do not need to read `CLAUDE.md` cover-to-cover to avoid a regression.
19. As an on-call engineer, I want cross-tenant actions routed through either `platform.*` or `enter-partner`, so that audit-log queries filtered by `action ~ 'partner.enter'` capture every boundary crossing.
20. As a project maintainer, I want the number of places Pattern B lives to shrink from "unknown" to "exactly two files," so that future refactors can begin from a known baseline.

## Implementation Decisions

### Modules built

- **`server/services/membership.ts`** (new, deep module). Exports two functions:
  - `assertMembership(userId, partnerId, isPlatformOperator)` — replicates the current private implementation inside `support.ts`. Returns void on success; throws `TRPCError { code: 'FORBIDDEN' }` when the user has no membership row. Platform operators always pass.
  - `loadTicketForUser(ticketId, ctx)` — loads the ticket row; throws `NOT_FOUND` if missing, `FORBIDDEN` if `ticket.partnerId !== ctx.user.partnerId`. **No platform-operator bypass.** Operators must have already entered the partner (JWT carries the target `partnerId`) or use a dedicated `platform.*` endpoint.

  Rationale for one file: both helpers answer the same question ("does this user get this data?"), share the same DB imports, and scale from 2 to 3–4 related helpers without creating a `services/access/` subdirectory.

- **`scripts/check-trpc-tenant-isolation.mjs`** (new). CI grep guard. Scans `server/trpc/routers/` and fails with a non-zero exit if `partnerId:\s*z\.` appears in an `.input(` block inside any file other than the allowlist (`support.ts`, `platform/**`). Wired into `scripts/ci.ps1` after typecheck, before tests.

### Modules modified

- **`server/trpc/routers/support.ts`** — remove the private `assertMembership` function; import from `services/membership.ts`.
- **`server/trpc/routers/message.ts`** — replace the load-then-check block in `list` with `loadTicketForUser`.
- **`server/trpc/routers/sla.ts`** — same treatment in `getForTicket`.
- **`server/trpc/routers/presence.ts`** — drop `partnerId` from the input schema of `getOnlineStatus`; switch the procedure to `partnerScopedProcedure`; use `ctx.user.partnerId`. Client call site updated accordingly.
- **`server/trpc/routers/ticket.ts`** — `list`: drop the `partnerId: z.string().optional()` input field and the platform-operator branch. Stays on `partnerScopedProcedure`.
- **`server/trpc/routers/platform/partners.ts`** (or a sibling under `platform/`) — add `platform.listPartnerTickets` if any current platform UI consumes the operator branch of `ticket.list`. If no consumer is found during execution, this step is dropped and only the deletion stands.
- **`scripts/ci.ps1`** — add a new step invoking `check-trpc-tenant-isolation.mjs`.
- **`CLAUDE.md`** — document the two-allowlist-file rule under the "Multi-Tenancy" key conventions section.

### Architectural decisions

- Tenant-enforcement semantics between REST (tRPC) and WebSocket (Socket.io) are aligned. Both require JWT-carried `partnerId` for normal routes; neither provides an operator bypass in the shared check. Cross-tenant operations are explicit: `enter-partner` mints a new JWT, and `platform.*` endpoints exist for views that must stay cross-partner.
- `loadTicketForUser` intentionally omits operator bypass. The cost (operators must "enter" a partner to work inside it) is paid in exchange for a simpler helper signature and a bright line between normal and cross-tenant flows.
- The helper returns the full ticket row rather than just `partnerId` so callers do not re-query. This is a minor deepening of the module — the caller gets both the tenant check and the row in one call.

### Contracts

- `presence.getOnlineStatus` input type changes from `{ userId, partnerId }` to `{ userId }`. This is a breaking change for any external consumer of the tRPC client; all in-repo call sites are updated in the same change.
- `ticket.list` input type loses the `partnerId` optional field. In-repo callers have never sent it from non-platform UIs, so the only required update is in `PlatformView`-adjacent callers (if any).

### Out of allowlist

- Pattern B (`partnerId` in input) is permitted in `server/trpc/routers/support.ts` and under `server/trpc/routers/platform/**`. Everywhere else is caught by the CI guard.

## Testing Decisions

A good test here asserts an externally-visible behavior that a failing tenant check would change: calling the helper or route from the wrong tenant must produce a typed error; calling it from the correct tenant must succeed; platform operators follow the rules that apply to them.

Tests are **behavior-level, not implementation-level**: we do not assert that a specific SQL WHERE clause was built, we assert that a cross-tenant call returns FORBIDDEN.

### Modules tested

- **`server/services/membership.ts`** (unit).
  - `assertMembership`: throws FORBIDDEN when no membership row exists; returns void when a row exists; skips the DB check entirely for platform operators.
  - `loadTicketForUser`: throws NOT_FOUND when the ticket does not exist; throws FORBIDDEN when the ticket exists in another partner; returns the ticket row when the partner matches; applies the same FORBIDDEN rule to platform operators when their JWT partner does not match (no bypass).

- **`server/trpc/routers/message.ts`** — `list` (behavior).
  - Caller in partner A requesting a ticket owned by partner B receives FORBIDDEN.
  - Caller in partner A requesting their own ticket receives the message list.

- **`server/trpc/routers/sla.ts`** — `getForTicket` (behavior). Same two cases as above.

### Not tested

- The CI grep guard script. Too simple to merit tests; if it misfires, CI will be wrong in an obvious way on the first PR.

### Prior art

- `server/trpc/routers/__tests__/` contains several behavior-level tests for tRPC routes (e.g. `partnerAudit.test.ts`, `verifyAuditChainBroken.test.ts`) that exercise happy and forbidden paths. New tests follow the same factory/mock-builder pattern in `server/test/` helpers.
- `server/socket/partnerScope.ts` is the parallel in the socket layer; its shape informs the helper's ergonomics (single call, returns the row or throws).

## Out of Scope

- Behavior-level "cross-tenant leak" tests for every tenant-scoped endpoint in the codebase. Opportunistic going forward; not a prerequisite for this PRD.
- Replacing existing `partnerScopedProcedure` usages. They already follow Pattern A and need no change.
- Changes to Socket.io handlers — already correct; this PRD brings REST up to the same bar.
- JWT shape changes (e.g. adding `isExternal` to the JWT payload). Orthogonal; tracked under the B2B guest plan.
- A behavior-level audit of `roleProcedure` vs `partnerRoleProcedure` use. In-scope would dilute the focus on Pattern A/B and the `partnerId` input surface.

## Further Notes

- The plan document this PRD derives from: `docs/superpowers/plans/2026-04-24-trpc-tenant-isolation-hardening.md`.
- Execution order is safe-first: extract the helpers with no behavior change, add the CI guard last. Each step is independently revertable.
- The rule "operators must enter a partner to cross tenants" has an existing audit story: `enter-partner` is already logged. No new audit wiring is needed.
- The CI guard is implemented as a JavaScript file under `scripts/` (matching project convention) rather than a PowerShell inline block in `ci.ps1`. Keeps the guard testable if it ever grows.
