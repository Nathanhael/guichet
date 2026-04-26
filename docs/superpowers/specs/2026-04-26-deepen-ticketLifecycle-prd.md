# PRD: Deepen `ticketLifecycle` — one transactional module for 7 ticket-state transitions

> Implementation acceptance contract for the refactor proposed in [Nathanhael/guichet#24](https://github.com/Nathanhael/guichet/issues/24).

## Problem Statement

I am a Guichet maintainer. Every time I touch ticket state, I have to reason across three transport surfaces (socket handlers, a boot-time reclaim service, a hypothetical future tRPC mutation) that each hand-roll the same orchestration with subtly different semantics. Two of the seven lifecycle paths (`support:leave` and crash-time reclaim) silently skip the audit-log write that the rest of the system treats as the security source-of-truth, and our chain-verify subsystem detects tampering but not omission. When I add a new lifecycle event or change one, I have to remember to update the mutation, the audit writer, the system-message inserter, and the post-commit broadcasts in the right order — and the tests I'd lean on can't verify transactional rollback because they're built on hand-rolled Drizzle mocks. Bugs hide in the seams between shallow services, not inside any single one. As compliance scrutiny on the audit log increases, the silent gaps become a real liability and not just a code-quality smell.

## Solution

I want one deep module — `services/ticketLifecycle` — that owns every state transition of a ticket row that's observable to a client or recorded in `audit_log`. Callers (socket handlers today, tRPC tomorrow) build a typed `Actor` and call one of seven verbs; the module returns either a `Result<Ok>` carrying a transport-neutral list of post-commit effects, or a `Result<LifecycleError>` carrying a discriminated rejection code. The module wraps the mutation, audit row, and any system/whisper messages in a single Postgres transaction — no in-flight observability of partial state, no silent audit gap. A small `Effect` DSL describes what should happen after commit (socket emits, queue rebroadcasts, summarize-on-close), so the lifecycle stays transport-neutral and the same factory can back a future tRPC procedure without duplicating orchestration. The boundary-tests run against a real Postgres (PGLite) so transactional rollback is verifiable for the first time.

## User Stories

1. As a Guichet maintainer, I want one module to call for every ticket state transition, so that I don't have to remember which of three transport surfaces owns which operation.
2. As a Guichet maintainer, I want lifecycle verbs to take a typed `Actor`, so that I can't accidentally pass a partial socket payload as identity.
3. As a Guichet maintainer, I want lifecycle verbs to return a `Result<Ok | LifecycleError>` discriminated union, so that the type system forces me to handle every rejection code.
4. As a Guichet maintainer, I want the lifecycle module to wrap mutation, audit, and message inserts in one Postgres transaction, so that partial states (mutated ticket without audit row) are impossible.
5. As a Guichet maintainer, I want post-commit side effects (socket emits, queue rebroadcasts) returned as a transport-neutral effect array, so that lifecycle code never imports the Socket.io server.
6. As a Guichet maintainer, I want a small `applyEffects(io, effects)` dispatcher in the same module, so that callers don't reinvent effect-fanout logic per call site.
7. As a Guichet maintainer, I want the existing shallow services (`transferService`, `ticketAudit`, `systemMessage`) absorbed into the lifecycle module, so that there are no exported helpers callers can use to skip the lifecycle.
8. As a Guichet maintainer, I want the lifecycle slice of `ticketQueries.ts` (`createTicket`, `closeTicket`, `transferTicketToDepartment`, `returnTicketToQueue`) carved into private mutations, so that the module owns its writes top to bottom.
9. As a Guichet maintainer, I want read-side query helpers in `ticketQueries.ts` to stay shared, so that `partnerScope` guards and other handlers keep working unchanged.
10. As a Guichet maintainer, I want the factory wiring to match the existing `AiContext` DI precedent, so that the codebase has one DI pattern, not two.
11. As a platform operator, I want every lifecycle event (including `support:leave` and crash-time reclaim) to write an `audit_log` row, so that the WORM chain reflects the full security history without gaps.
12. As a compliance reviewer, I want the audit-row-per-lifecycle invariant enforced by the type system, so that adding a new lifecycle op cannot accidentally land without audit coverage.
13. As an oncall engineer, I want a DB failure on the audit insert to roll back the whole lifecycle event, so that I never get paged about a transferred ticket whose audit row never landed.
14. As an oncall engineer, I want an existing `AuditChainStaleness` / `AuditChainTamperDetected` / `TicketAuditEmitterSilenced` rule to keep working unchanged, so that the refactor doesn't move the audit observability goalposts.
15. As a support agent, I want every state change I trigger (claim, leave, transfer, close) to remain visible in the chat as a system or whisper message exactly as today, so that my workflow doesn't change.
16. As a support agent, I want department transfers to continue inserting an optional whisper note for context handoff, so that the new owner has continuity.
17. As an end user (B2B agent creating a ticket), I want ticket creation to remain gated by business hours and by the one-open-ticket-per-agent limit, so that nothing about my product experience changes.
18. As a Guichet maintainer, I want pre-flight gates (business hours, partner active, dept exists, dup-ticket detection, reopen detection, role authz) to live inside the lifecycle module, so that I don't have to re-implement them at the next transport surface.
19. As a Guichet maintainer, I want the role-authz check ("only support can transfer", "only agents can create", "agent can close own ticket") to live inside the lifecycle, so that domain rules don't leak into transport handlers.
20. As a future Guichet maintainer adding a tRPC ticket mutation, I want to reuse the same factory by building a `trpcActor` from tRPC context, so that I don't duplicate orchestration in another transport surface.
21. As a Guichet maintainer, I want the boot-time `reclaimAbandonedTickets` to become a thin wrapper that calls `lifecycle.reclaim()` per row, so that crash-recovery and live operation share one code path.
22. As a Guichet maintainer, I want a PGLite test substrate that runs Drizzle migrations at file boot, so that lifecycle tests run real SQL with real `BEGIN/COMMIT/ROLLBACK` without Docker.
23. As a Guichet maintainer, I want the new test suite to verify transactional rollback by injecting a DB failure during the audit write, so that the property "audit failure rolls back mutation" is exercised — that test does not exist anywhere in the codebase today.
24. As a Guichet maintainer, I want every lifecycle test to assert tenant isolation (actor from partner A cannot operate on a ticket from partner B), so that the multi-tenancy mandate is enforced at the boundary.
25. As a Guichet maintainer, I want the existing hand-rolled-Drizzle-mock tests for `transferService` and `ticketAudit` deleted in the cleanup PR, so that nobody mistakes them for live coverage.
26. As a Guichet maintainer, I want the test target for the lifecycle suite capped at ~30–35 cases (not every op × every assertion), so that we don't pad coverage with preflight checks that don't apply per op (e.g. `leave` has no business-hours gate).
27. As a Guichet maintainer, I want the test suite for unrelated services to keep its existing hand-rolled mocks, so that we don't pay a migration tax on tests outside the lifecycle's scope.
28. As a Guichet maintainer, I want the migration delivered as 7 small PRs in dependency order with no feature flag, so that each PR is independently reviewable and revertable.
29. As a Guichet maintainer, I want PR 0 to be a 30-minute PGLite spike that proves Drizzle migrations boot and a row inserts cleanly, so that we de-risk the substrate before any production code lands.
30. As a Guichet maintainer, I want PR 1 (scaffolding + `reclaim`) to be the first migration slot, so that we exercise the substrate against the lowest-blast-radius op (boot-time, no live socket clients).
31. As a Guichet maintainer, I want PR 2 to migrate `returnToQueue` and `leave` together, so that we close the silent audit gap on `leave` early in the sequence.
32. As a Guichet maintainer, I want PR 3 to migrate `assign` (`support:join`), so that after this PR `handlers/presence.ts` no longer touches lifecycle primitives at all.
33. As a Guichet maintainer, I want PR 4 to migrate `transfer` only after the substrate is proven by PRs 1–3, so that the most-complex orchestration (whisper + system message + dual-room emit + support-socket evict) lands on a known-good base.
34. As a Guichet maintainer, I want PR 5 to migrate `close` and `create` together, so that the largest pre-flight surface (business hours, partner active, 1-ticket limit, reopen detection) lands when the `LifecycleError` union is most-tested.
35. As a Guichet maintainer, I want PR 6 to delete `transferService.ts`, `ticketAudit.ts`, `systemMessage.ts`, the lifecycle slice of `ticketQueries.ts`, and the three redundant `*.test.ts` files, so that the encapsulation is final and cannot be circumvented.
36. As a Guichet maintainer, I want a 5-minute grep before PR 5 to confirm no production workflow depends on the old "audit failure is invisible to caller" behavior, so that the intentional behavior change has documented confidence.
37. As a Guichet maintainer, I want the `Effect` union to include only the post-commit side effects we actually emit today (socket emit, room evict, queue rebroadcast, summarize-on-close, notify-previewers), so that we don't over-design the DSL.
38. As a Guichet maintainer, I want effect ordering (audit before sysMsg, sysMsg before queue rebroadcast, room-evict after transfer emit) encoded in the returned effect array, so that ordering is no longer implicit in handler line order.
39. As a Guichet maintainer, I want sender-info denormalization (`isExternal`, `lang`, `role`) to live inside `messages.ts` private to the module, so that callers can't construct half-built whisper rows.
40. As a Guichet maintainer, I want lifecycle test files set up with `setupFiles: ['server/test/pglite-setup.ts']` only for the lifecycle suite, so that the rest of the test suite isn't slowed by PGLite boot.
41. As a Guichet maintainer, I want CSAT/feedback, alerts, and KB tests untouched, so that this refactor's blast radius stays inside the ticket-lifecycle modules.
42. As a Guichet maintainer, I want the existing chain-verify history table, ticket-audit drawer, and cross-partner activity rollup to pick up the new `ticket.left` / `ticket.reclaimed` audit rows automatically, so that no downstream UI needs changes.

## Implementation Decisions

- **One deep module** — `server/services/ticketLifecycle/` owns every ticket state transition that produces an audit row or socket emit. Public surface is `index.ts` exporting `createTicketLifecycle(deps)` and the `TicketLifecycle`, `Actor`, `Result`, `LifecycleError`, and `Effect` types.
- **DI matches `AiContext`** — factory takes `{ db }`, returns the `TicketLifecycle` interface. Wired at boot in `server/app.ts`, passed into `HandlerContext` and into the boot-time reclaim entry point.
- **Result discriminated union, no exceptions for domain errors** — `{ ok: true; data; effects } | { ok: false; code: ... }`. Exhaustive `switch` enforced by TypeScript at every call site. DB / infra errors still throw (transaction aborts, not caller's concern).
- **All-or-nothing PG transaction** — mutation, audit row, and any system/whisper messages run in one `db.transaction(...)`. The audit insert no longer uses fire-and-forget `void`; a failure rolls everything back. This is the intentional behavior change.
- **Effect DSL is post-commit only** — `Effect` is a union of `emit`, `evictSupportFromRoom`, `broadcastQueue`, `autoSummarizeOnClose`, `notifyPreviewers`. Lifecycle returns the array; transport-tier `applyEffects(io, effects)` dispatches. Lifecycle module never imports the Socket.io server.
- **Absorb the shallow services** — `transferService.ts`, `ticketAudit.ts`, `systemMessage.ts` move under `ticketLifecycle/` as private internals (`mutations.ts`, `audit.ts`, `messages.ts`). Their public exports stop existing in PR 6.
- **Carve the lifecycle slice of `ticketQueries.ts`** — `createTicket`, `closeTicket`, `transferTicketToDepartment`, `returnTicketToQueue` move into `mutations.ts`. Read-side helpers (`findTicketForClose`, `findTicketForTransfer`, `findTicketForJoin`, etc.) stay where they are because `partnerScope` guards and other handlers depend on them.
- **Pre-flight gates live inside the module** — business hours, partner active, 1-ticket-per-agent limit, dept-exists, reopen detection, and all role-authz checks. `preflight.ts` private to the module.
- **`Actor` is the identity contract** — `{ id, name, role, isSupport, isExternal, lang }`. Built by transport-specific helpers (`socketActor(socket)`, `trpcActor(ctx)`). The lifecycle never inspects raw socket / tRPC context.
- **Per-op PR sequence, no feature flag** — PR 0 (PGLite spike) → PR 1 (scaffolding + reclaim) → PR 2 (returnToQueue + leave) → PR 3 (assign) → PR 4 (transfer) → PR 5 (close + create) → PR 6 (cleanup + deletes). Each PR independently revertable.
- **Behavior change #1: audit becomes mandatory + transactional.** Documented as intentional. 5-min grep before PR 5 to confirm no production workflow depends on the old fire-and-forget semantics.
- **Behavior change #2: new audit rows for `leave` + `reclaim`.** Downstream consumers (audit drawers, chain verify, cross-partner rollup) pick them up automatically. No schema change.

## Testing Decisions

- **What makes a good test for this module:** assertions are made against the public `TicketLifecycle` interface only — never against internal helpers in `mutations.ts` / `audit.ts` / `messages.ts`. A test that mocks the DB and asserts "the audit writer was called with X" is forbidden; a test that runs the lifecycle against PGLite and queries `audit_log` afterwards is correct. We are testing observable behavior (DB rows, returned effects), not implementation choices.
- **Substrate: PGLite (`@electric-sql/pglite` + Drizzle adapter).** Real SQL, real `BEGIN/COMMIT/ROLLBACK`, ~100ms init per file. No Docker dependency for `npm test`. Only the new lifecycle suite uses PGLite — the existing service tests stay on hand-rolled mocks (no migration tax outside scope).
- **Per-op assertion shapes (priority-ordered):**
  1. **Transactional rollback** (highest signal — does not exist anywhere in the codebase today). Inject `db.insert` failure during the audit write; assert ticket row unchanged, no system message, no effects returned.
  2. **Tenant isolation.** Actor from partner A cannot operate on a ticket from partner B; returns `{ ok: false, code: 'NOT_FOUND' }`. No DB writes, no effects.
  3. **Audit invariant.** Every successful op writes exactly one `audit_log` row with `targetType='ticket'`, `targetId=ticketId`. Closes the silent gaps on `leave` and `reclaim`.
  4. **Authorization rejection.** Wrong actor role → `{ ok: false, code: 'NOT_AUTHORIZED' }`. No DB rows, no effects.
  5. **Happy path.** Valid actor + args → `{ ok: true, data, effects }` with the expected DB rows and effect sequence.
  6. **Pre-flight rejection** (only where applicable per op) — e.g. `BUSINESS_HOURS_CLOSED` for create, `TICKET_ALREADY_CLOSED` for close, `DEPARTMENT_NOT_FOUND` for transfer.
- **Target count: 30–35 boundary tests across 7 ops.** Not 42. We're not padding coverage with preflight assertions that don't apply per op.
- **PR 0 PGLite spike acceptance:** boot PGLite + run `drizzle-kit migrate` + insert a `tickets` row + read it back. If anything cracks, fall back to a docker-compose Postgres test container before any production code lands.
- **Tests deleted in PR 6:**
  - `server/services/transferService.test.ts` — replaced by `ticketLifecycle.transfer.test.ts`.
  - `server/services/ticketAudit.test.ts` — replaced by audit-invariant assertions in each lifecycle test file.
  - The lifecycle-relevant subset of `server/services/ticketQueries.test.ts` (read-side query tests stay).
- **Prior art for boundary-style tests:** `services/dashboard/*` deep services (pure transforms with thin Drizzle layers) and the `partnerScope` test suite. Both test observable behavior at module boundaries rather than internal helper calls. The existing `transferService.test.ts` and `ticketAudit.test.ts` are the *anti-pattern* we are moving away from.

## Out of Scope

- **Cluster #2 — cross-cutting socket partner-scope guard refactor.** A separate refactor that follows naturally once the lifecycle is deepened (at that point, `handlers/ticket.ts` and `handlers/presence.ts` shrink to thin shells and the guard pattern across the remaining 7 handler files becomes the visible cleanup). Tracked separately.
- **Cluster #4 non-lifecycle parts of `handlers/presence.ts`** — `status:set`, online/away tracking, idle handling, `useIdleStatus`. Those belong to the presence + status lifecycle cluster, not the ticket lifecycle.
- **Read-side queries in `services/ticketQueries.ts`** — `findTicketForClose/Transfer/Join/Participants/Message/Owner` and similar. They stay shared between `partnerScope` guards and other handlers; only the lifecycle-mutation slice is carved out.
- **Migrating existing tests outside the lifecycle suite to PGLite.** Out of scope; existing service tests keep their hand-rolled mocks. We pay no migration tax outside the new module.
- **Building a tRPC ticket mutation surface.** The factory is designed so a future tRPC procedure can reuse the lifecycle trivially, but the actual tRPC migration is not part of this work.
- **New downstream consumers of the new `ticket.left` / `ticket.reclaimed` audit rows.** The existing chain-verify history, ticket-audit drawer, and cross-partner activity rollup pick them up automatically. No new UI.
- **Any change to JWT / cookie / refresh-token machinery.** This refactor is strictly transport-tier orchestration and DB writes; auth boundaries are unchanged.
- **Any change to `audit_log` / `audit_archive` schema or chain-hash semantics.** The WORM chain machinery is untouched; the new rows just flow into the existing pipeline.

## Further Notes

- This PRD is the implementation acceptance contract. The architectural rationale (the Q1–Q11 grilling pass, the cluster analysis, the deep-vs-shallow tradeoffs) lives in [Nathanhael/guichet#24](https://github.com/Nathanhael/guichet/issues/24).
- PR sequence (cumulative 7 PRs): PR 0 (PGLite spike, ~30 min) → PR 1 (scaffolding + reclaim) → PR 2 (returnToQueue + leave) → PR 3 (assign) → PR 4 (transfer) → PR 5 (close + create) → PR 6 (cleanup + deletes).
- Two intentional behavior changes ship in PRs 1–6: audit becomes mandatory + transactional; `ticket.left` and `ticket.reclaimed` audit rows now exist. Both are documented as intentional in the relevant PR descriptions.
- The lifecycle suite's transactional-rollback test is the single highest-signal test added by this work — it exercises a property that has zero coverage in the codebase today.
- After PR 6, the audit-row-per-lifecycle invariant is enforced by the type system: there is no exported `auditTicketX` function for callers to skip the lifecycle. Adding a new lifecycle op cannot accidentally land without audit coverage.
- Existing alerts (`AuditChainTamperDetected`, `AuditChainVerifyServiceError`, `AuditChainStaleness`, `TicketAuditEmitterSilenced`) and metrics (`guichet_ticket_audit_events_total`, `guichet_audit_chain_broken_total`) require no changes — they observe the audit subsystem from outside.
- This work pairs naturally with cluster #2 (socket partner-scope guard cleanup); when this PRD lands, that cluster's scope becomes visible and tractable.
