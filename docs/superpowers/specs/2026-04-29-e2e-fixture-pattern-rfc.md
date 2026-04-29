# RFC: E2E Fixture Pattern — Eliminate Runtime-Predicate Skips

**Author:** Bart
**Date:** 2026-04-29
**Status:** Draft → Open for review
**Bundle:** D (E2E hardening)

## Problem

`scripts/ci.ps1` reports the e2e suite as PASS today on a 105/30/0 split — 105 passed, 30 skipped, 0 failed. Roughly 135 of those 30+ test cases use runtime-predicate guards in spec bodies that mask fixture drift as green CI:

```ts
test.skip(!loginOk, 'Demo login failed — user may not be seeded');
test.skip(!hasTicket, 'Kevin\'s ticket not visible in queue');
test.skip(!canTransfer, 'Transfer button not visible');
test.skip(true, 'No tickets in queue — seed database with tickets for this partner');
```

When the predicate flips false (DB seed empty, demo login race, ticket auto-claimed by an earlier spec) the test bails as SKIP, not FAIL. CI stays green. Coverage drops without anyone noticing.

The pattern is documented at `wiki/patterns/e2e-skip-as-silent-failure.md` and observed concretely in the 2026-04-28 drift triage (`wiki/learnings/guichet-e2e-drift-triage-2026-04-28.md`). Today's example: `status-and-transfer.spec.ts:235` and `:310` skip even when run in isolation with `--workers=1` because earlier tests in the same describe consume the seed ticket. Two specs that "passed" before Bundle C now skip post-Bundle-C with zero E2E or src changes that could have caused it. Pure fixture-state drift.

Counts on disk (verified `2026-04-29`):

| Pattern | Count |
|---|---|
| `test.skip(!<predicate>, ...)` | ~115 |
| `test.skip(true, ...)` (inline-fixture) | ~20 |
| `test.skip(!process.env.X, ...)` (legitimate env-gate) | 1 |
| **Total non-legitimate** | **~135** |

26 spec files affected. Highest-density: `ai-features.spec.ts` (31), `status-and-transfer.spec.ts` (19), `view-modes.spec.ts` (16), `support-flow.spec.ts` (11), `agent-flow.spec.ts` (9), `collision-detection.spec.ts` (9), `queue-lang-awareness.spec.ts` (8).

## Goal

After this work:

- Every test that has a runtime-predicate skip today either passes deterministically OR is removed if it was redundant.
- Skip count drops to <5; all remaining skips are explicit env-flag opt-ins (`E2E_INCLUDE_SLA_LIFECYCLE`, `E2E_CHAT_DEMO`).
- A CI grep guard in `scripts/ci.ps1` blocks any new non-env-gated predicate skip from landing.
- New wiki decision page documents the chosen fixture pattern so future specs follow it.

## Design alternatives considered

### Option a — tRPC fixture per test (pure)

Each test creates its own ticket via `trpc.ticket.create.mutate()` in `beforeEach`, claims/closes/transfers it inline, no shared queue dependency.

**Pro:** Reuses production APIs. No new endpoints. Mirrors how a real customer would create state.

**Con:** Cannot reach server-side state that lacks a customer-facing API. Agent presence, `agent_status_log` rows, business-hours overrides, partner-config flips have no production endpoint that an external customer would hit. A presence test cannot stage "agent X is online" via prod APIs alone.

### Option b — Reset endpoint

A single `POST /api/v1/test-fixtures/reset` wipes and reseeds DB state, gated by `assertNotProduction()`.

**Pro:** Total control. Deterministic.

**Con:** New attack surface concentrated in one heavy endpoint. Heavyweight per-test (full DB wipe). Suite-level lock contention. Doesn't compose with parallel workers.

### Option c — `describe.serial` isolation only

Mark queue-coupled specs as serial; let the rest parallelize.

**Pro:** Zero new code.

**Con:** Doesn't address predicate skips at all — only intra-spec ordering races. The 30-skip number stays unchanged.

### Option d — Hybrid (chosen)

tRPC procedures for what production APIs can express; targeted reset-style procedures for what they can't. Both pathways live under one `trpc.testFixtures.*` router with a shared production-guard.

**Pro:** Right tool per concern. Production-API parity for ticket-shape tests; explicit reset for state without a customer API. One router to audit, one mount point, one boundary test.

**Con:** Two pathways to maintain. Mitigated by housing both under one router.

## Proposed interface

A new tRPC router at `server/trpc/routers/testFixtures.ts`. Module-load-time `assertNotProduction()` panic. Every procedure re-checks `NODE_ENV !== 'production'`. Mounted into the main router only when not production.

### Procedures

```ts
// Create + return a ticket id, optionally pre-assigned to a support user.
// Used by every spec that needs "an open ticket exists in this partner's queue".
testFixtures.createTicket: input(z.object({
  partnerId: z.string(),
  agentEmail: z.string().email().optional(),       // Default: agent_julie@guichet.test
  status: z.enum(['open', 'pending', 'closed']).default('open'),
  assignToSupportEmail: z.string().email().optional(),
  body: z.string().default('E2E fixture'),
  departmentId: z.string().optional(),
})).output(z.object({ ticketId: z.number() }))

// Idempotent cleanup of any artifacts a test created. Safe with stale ids.
testFixtures.cleanup: input(z.object({
  ticketIds: z.array(z.number()).optional(),
  userIds: z.array(z.string()).optional(),    // Resets presence/status_log only; does NOT delete users.
})).output(z.void())

// Reset agent presence + recent status_log for given user.
// Used by status-and-transfer specs to stage known-state before the test asserts on it.
testFixtures.resetAgentStatus: input(z.object({
  userId: z.string(),
  status: z.enum(['online', 'away']).default('online'),
})).output(z.void())

// Convenience: get a ticket id satisfying a predicate, or create one. Used to migrate
// "find first ticket in queue" specs without rewriting the assertion shape.
testFixtures.ensureTicketInQueue: input(z.object({
  partnerId: z.string(),
  departmentId: z.string().optional(),
})).output(z.object({ ticketId: z.number() }))
```

### Production-safety contract

Three layers:

1. **Module-load assert.** `server/trpc/routers/testFixtures.ts` imports `assertNotProduction` from `server/utils/assertNotProduction.ts` and calls it at file top. The server fails to start in production if the file is imported.
2. **Conditional mount.** `server/trpc/router.ts` only mounts `testFixtures` when `NODE_ENV !== 'production'`. The router key does not exist on the production tRPC client.
3. **Per-procedure recheck.** Each procedure asserts `NODE_ENV !== 'production'` inside its resolver. Defense in depth against a future operator misconfiguring `NODE_ENV` after server start.

A boundary test at `server/__tests__/testFixtures.boundary.test.ts` simulates `NODE_ENV=production` and asserts the file throws on import.

### Test-side helper

A thin Playwright wrapper at `testing/e2e/helpers/fixtures.ts`:

```ts
// Inherits the calling spec's demo-login cookie via page.request.
export async function createTicketFixture(
  page: Page,
  opts: { partnerId: string; agentEmail?: string; ... }
): Promise<number>;

export async function cleanupTicketFixture(page: Page, ticketIds: number[]): Promise<void>;

// Playwright fixture extension that auto-registers cleanup in afterEach.
// Tests use `test.extend({ ticketFixture: ... })` to make forgetting cleanup impossible.
export const test = base.extend<{ ticketFixture: TicketFixtureAPI }>(...);
```

The helper hits the tRPC HTTP endpoint via `page.request.post()` so it inherits the spec's existing auth cookie. No new auth machinery.

## Migration sequence

### Slice 1 — fixture API + proof migration

- New router + module-load guard + boundary test.
- New `testing/e2e/helpers/fixtures.ts` wrapper.
- One spec migrated end-to-end: `status-and-transfer.spec.ts` (highest-density skip cluster, both predicate and inline forms).
- Update `server/scripts/check-trpc-tenant-isolation.mjs` to allowlist the new router (it cross-tenants by design).
- CHANGELOG entry.
- **Expected drop:** ~19 skips (status-and-transfer's runtime + inline skips).

### Slice 2 — remaining migrations

- Migrate every spec listed in scope: ai-features, view-modes, support-flow, agent-flow, collision-detection, queue-lang-awareness, invite-audit-flow, split-view, support-view, chat-enhancements, platform-view, admin-* family, dashboard-* family.
- Inline fixture skips (`test.skip(true, ...)`) deleted in favor of fixture creates.
- Demo-login predicates (`test.skip(!loginOk, ...)`) converted to `throw new Error(...)` per the wiki pattern's "fixture must exist" rule.
- One commit per migrated spec; `scripts/ci.ps1` between to detect regressions early.
- CHANGELOG entry.
- **Expected drop:** to <5 skips total.

### Slice 3 — tighten + guard

- CI grep guard in `scripts/ci.ps1`:
  ```powershell
  $offenders = Select-String -Path testing/e2e/*.spec.ts -Pattern 'test\.skip\((?!process\.env|true,\s*''[^'']*ENV)'
  if ($offenders) { throw "Banned predicate skip introduced: $offenders" }
  ```
  Whitelist: `test.skip(!process.env.X, ...)` only.
- Update wiki pattern page (`wiki/patterns/e2e-skip-as-silent-failure.md`) to call out the resolution.
- File `wiki/decisions/guichet-e2e-fixture-pattern.md`.
- CHANGELOG entry.

## Auth strategy

Reuse `POST /api/v1/auth/dev-login`. It is already gated by `if (process.env.NODE_ENV === 'production') return res.sendStatus(404)`. No new token-mint endpoint is introduced.

## Open questions for PRD

1. **Per-test partner vs shared E2E partner.** A shared partner reduces fixture creation cost but raises cross-test pollution risk. Recommend: shared partner (`acme` for most specs, `betacorp` for cross-tenant tests), with per-test ticket-level isolation. Worker-parallel cross-test pollution is mitigated because each test creates a unique ticket ID; no test asserts "exactly N tickets in queue".

2. **Cleanup discipline.** Tests that create tickets must `afterEach` cleanup. A test that forgets to clean up pollutes the queue for the next worker. Recommend: cleanup is enforced by the helper — `createTicketFixture` registers the id with a Playwright fixture-scoped cleanup callback, so forgetting cleanup is impossible by construction.

3. **Helper auth coupling.** The fixture helper uses `page.request.post()` to inherit the spec's existing demo-login cookie. If a spec hasn't logged in before calling the fixture helper, the fixture creation 401s. Recommend: treat as feature — fixtures require an authenticated session, mirroring production's no-anon-creates contract.

## Out of scope

- ESLint plugin enforcing the no-predicate-skip rule. CI grep guard in slice 3 is enough until proven otherwise.
- Storybook / visual regression infrastructure. Unrelated.
- Migrating any specs' selector logic — chip-label drift is a separate failure mode (already addressed in 2026-04-28 triage). Slice 2 only touches the skip predicates.
- Worker-level parallelism tuning. Playwright's default workers stay; the new fixture pattern works with them as long as cleanup is honored.

## See also

- `wiki/patterns/e2e-skip-as-silent-failure.md` — pattern definition.
- `wiki/learnings/guichet-e2e-drift-triage-2026-04-28.md` — concrete drift example.
- `server/routes/auth/devLogin.ts` — production-gate precedent.
- `server/scripts/check-trpc-tenant-isolation.mjs` — allowlist file the new router needs.
