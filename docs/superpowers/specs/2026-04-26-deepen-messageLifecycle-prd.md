# PRD: Deepen `messageLifecycle` — one orchestration module for 4 message-mutation verbs

> Implementation acceptance contract for the refactor proposed in [Nathanhael/guichet#49](https://github.com/Nathanhael/guichet/issues/49).

## Problem Statement

I am a Guichet maintainer. Every time I touch how a chat message is created, edited, deleted, or reacted to, I have to reason through a 498-line socket handler that hand-orchestrates the same prologue (partner-scope guard, sender denormalization, role check) and the same epilogue (broadcast, preview-room invalidation, AI summary cache bust) around four very different middles. The hot path — `message:send` — is a single ~200-line block that runs content guards, inserts the row, stamps the SLA first-staff-response, resolves a reply snippet, races an AI translation prewarm against a 250ms budget, fans out the broadcast (with a whisper-only edge case that hand-iterates `io.sockets.sockets`), invalidates the AI summary cache, and kicks off background link unfurling. That orchestration reaches directly into `getRedisClients()`, `runAiAction()`, and `unfurlLinks()` from the handler, which means there is no point at which a boundary test can deterministically exercise the hot path without standing up Redis, an HTTP server for OG fetches, and an AI provider. Today's handler test suite either mocks those modules with `vi.mock` (brittle) or skips the interactions entirely. Bugs hide in the seams between shallow services (`messageQueries`, `guards`, `linkPreview`, `ai/runAction`), not inside any one of them. As the message handler is the most-trafficked socket event in the system, the lack of deterministic boundary coverage is a quiet but persistent reliability risk.

## Solution

I want one deep module — `services/messageLifecycle` — that owns every message-mutation verb (`send`, `edit`, `delete`, `react`) currently dispatched from `socket/handlers/message.ts`. Callers (the socket handler today, a hypothetical future `trpc.message.*` mutation tomorrow) build a typed `Actor` and call one of four verbs; the module returns either `Result<Ok>` carrying a transport-neutral list of post-commit effects, or `Result<MessageLifecycleError>` carrying a discriminated rejection code. The module mirrors the just-shipped `ticketLifecycle` deepening shape (factory + Actor + Result + Effect DSL + PGLite tests) with one consequential difference: there is no audit invariant for messages, and therefore no `db.transaction(...)` wrapper. The lifecycle's value is the orchestration consolidation, the type-safe rejection codes, and — crucially — port-mediated cross-boundary dependencies (link preview, AI translation, repetition guard) so that boundary tests can run deterministically against PGLite without external infra. `delivered` and `read` are intentionally out of scope; they have no domain logic and would be mimicry without value.

## User Stories

1. As a Guichet maintainer, I want one module to call for every message-mutation verb, so that I don't reinvent the prologue and epilogue at every handler.
2. As a Guichet maintainer, I want lifecycle verbs to take a typed `Actor`, so that I cannot accidentally pass a partial socket payload as identity.
3. As a Guichet maintainer, I want lifecycle verbs to return a `Result<Ok | MessageLifecycleError>` discriminated union, so that the type system forces me to handle every rejection code.
4. As a Guichet maintainer, I want post-commit side effects returned as a transport-neutral effect array, so that the lifecycle module never imports the Socket.io server.
5. As a Guichet maintainer, I want the lifecycle to reuse the existing `applyEffects` dispatcher in `ticketLifecycle`, so that there is one effect dispatcher in the codebase, not two.
6. As a Guichet maintainer, I want the existing `Actor`, `Result`, and `Effect` types reused from `ticketLifecycle`, so that the codebase has one identity / result / effect model rather than two parallel ones.
7. As a Guichet maintainer, I want a separate `MessageLifecycleError` discriminated union, so that exhaustive-switch checks remain domain-scoped and ticket call sites are not polluted with message-specific codes.
8. As a Guichet maintainer, I want the factory wiring to match the existing `createTicketLifecycle` precedent, so that the codebase has one DI pattern, not two.
9. As a Guichet maintainer, I want `HandlerContext` to expose `messageLifecycle` as a flat sibling to `lifecycle`, so that existing ticket-handler call sites are unchanged and we do not pay a rename tax outside this refactor.
10. As a Guichet maintainer, I want cross-boundary dependencies (HTTP link unfurling, AI translation, Redis repetition guard) injected as ports, so that boundary tests do not require Redis, HTTP servers, or an AI provider.
11. As a Guichet maintainer, I want the storage dependency to use the existing `getStorage()` interface and NOT a fourth port, so that I do not introduce a parallel pattern for the same concern.
12. As a Guichet maintainer, I want the lifecycle to NOT open a `db.transaction(...)`, so that I do not ship a degenerate transaction wrapper around single-statement writes.
13. As a Guichet maintainer, I want the SLA first-staff-response stamp to run inside the lifecycle synchronously in a try/catch, so that the conditional `slaResolved` effect can be returned in the array but a stamp failure never blocks customer messaging.
14. As a Guichet maintainer, I want pre-existing observable behavior preserved exactly, so that the refactor is reviewable as a 1:1 mapping against the legacy handler.
15. As a Guichet maintainer, I want the dual `error` + `message:rejected` emit on guard rejection preserved, so that older clients without the structured-event handler keep working.
16. As a Guichet maintainer, I want non-support whisper attempts silently clamped to public (with a warn log), so that a misbehaving frontend cannot break customer messaging.
17. As a Guichet maintainer, I want the 250ms AI translation prewarm budget preserved, so that a slow provider never delays message delivery.
18. As a Guichet maintainer, I want the local-node whisper fan-out via socket iteration preserved, so that Redis-adapter `RemoteSocket` stub limitations do not leak whispers to end-users.
19. As a Guichet maintainer, I want the absorbed mutation helpers in `messageQueries.ts` deleted after migration, so that there are no exported helpers callers can use to skip the lifecycle.
20. As a Guichet maintainer, I want read-side helpers (per-message authz reads, paginated reads, reply-snippet resolvers, avatar batch resolvers) to stay shared in `messageQueries.ts`, so that tRPC routers and other handlers continue to work unchanged.
21. As a Guichet maintainer, I want `delivered` and `read` socket events left as direct query calls in the handler, so that the refactor's blast radius stays inside genuine domain-orchestration verbs.
22. As a Guichet maintainer, I want `ticket:new`'s first-message insert to stay inside `ticketLifecycle.create`, so that the refactor does not force `messageLifecycle` to expose a transaction-aware public API.
23. As a Guichet maintainer, I want the pre-existing first-message content-guard bypass in `ticketLifecycle.create` tracked as a separate task, so that I do not bundle a behavior fix into a refactor.
24. As a Guichet maintainer, I want NO audit-log invariant added for per-message mutations, so that I do not introduce a multi-write atomicity requirement the domain does not have.
25. As a Guichet maintainer, I want production adapters for the three ports to wrap today's concrete services, so that the migration is a wiring change rather than a behavior change.
26. As a Guichet maintainer, I want test stubs for the three ports (in-memory link preview, canned translations, always-ok and always-block guards, recording storage) co-located inside the lifecycle directory, so that they are not prematurely shared.
27. As a Guichet maintainer, I want the existing PGLite substrate reused as the test environment, so that I do not add a second test substrate.
28. As a Guichet maintainer, I want seed helpers inline per test file matching the existing `ticketLifecycle` test convention, so that I do not pay an adjacent-cleanup tax outside the refactor's scope.
29. As a Guichet maintainer, I want each verb's boundary tests to assert on the public `MessageLifecycle` interface only, so that internal helpers can be refactored without breaking tests.
30. As a Guichet maintainer, I want every lifecycle test to assert tenant isolation (an actor from partner A cannot mutate a message in partner B's ticket), so that the multi-tenancy mandate is enforced at the boundary.
31. As a Guichet maintainer, I want effect ordering in `send` (broadcast, then conditional `slaResolved`, then preview invalidation, then summary cache bust, then background link unfurl) asserted by tests, so that broadcast order is no longer implicit in handler line order.
32. As a Guichet maintainer, I want guard-pipeline tests covering both sync (fail-closed) and Redis (fail-open) paths via the repetition-guard port stub, so that the fail-open property is exercisable without Redis infra.
33. As a Guichet maintainer, I want translation-prewarm tests covering both the canned-success and timeout-null paths, so that the "broadcast still goes out on AI failure" invariant is verified.
34. As a Guichet maintainer, I want the migration delivered as 4 small PRs in dependency order with no feature flag, so that each PR is independently reviewable and revertable.
35. As a Guichet maintainer, I want PR 1 (scaffolding + `react` verb) to be the first migration slot, so that we exercise the full lifecycle pipeline against the lowest-blast-radius verb.
36. As a Guichet maintainer, I want PR 2 to migrate `edit` and `delete` together, so that own-message authorization patterns land paired and reviewers see both at once.
37. As a Guichet maintainer, I want PR 3 to migrate `send` only after `react`, `edit`, and `delete` are in production, so that the most-trafficked event lands on a known-good substrate.
38. As a Guichet maintainer, I want PR 4 to delete the absorbed mutation helpers and the corresponding test slices, so that the encapsulation is final and cannot be circumvented.
39. As a Guichet maintainer, I want a 5-minute grep before PR 3 to confirm no production code path depends on the absorbed mutation helpers outside the migrated handler, so that the cleanup PR's deletes are safe.
40. As a Guichet maintainer, I want the `Effect` union extension to live in the existing `ticketLifecycle` types module and be reused via import, so that there is one `Effect` type and one `applyEffects` dispatcher in the codebase even though two lifecycle modules consume them.
41. As a Guichet maintainer, I want the acknowledged ownership smell (ticketLifecycle types owning message-named effect variants) documented in the module header, so that the next refactor knows when to promote shared types to a future `services/lifecycle/` directory.
42. As a Guichet maintainer, I want the lifecycle to validate reaction emoji values against the existing `REACTION_EMOJIS` constant, so that the validation rule has one source of truth.
43. As a Guichet maintainer, I want soft-deleted messages' attachment blob cleanup to remain fire-and-forget after the DB update commits, so that a storage outage cannot orphan the DB row.
44. As a support agent, I want sending, editing, deleting, and reacting to chat messages to behave exactly as today, so that my workflow does not change.
45. As a support agent, I want my whisper messages to remain staff-only, so that customers do not accidentally see internal staff notes.
46. As a support agent, I want the SLA first-response indicator to clear when I send my first message in a ticket, so that breach status is reflected in the UI as today.
47. As an end user, I want my message rejections (length, repetition, content guards) to surface the same structured rejection event the legacy handler emitted, so that my optimistic UI keeps working.
48. As an end user, I want sending an attachment-only message to remain allowed (skipping text guards), so that file uploads work as today.
49. As an end user, I want messages with embedded URLs to keep producing link-preview cards a moment after send, so that the rich-preview UX is unchanged.
50. As a future Guichet maintainer adding a `trpc.message.*` mutation surface, I want to reuse the same factory by building a `trpcActor` from tRPC context, so that I do not duplicate orchestration in another transport surface.
51. As an oncall engineer, I want a Redis content-guard failure to never block a message that the synchronous guards already passed (fail-open), so that a Redis outage does not spike message-rejection rates.
52. As an oncall engineer, I want an AI-provider outage during translation prewarm to never block message delivery (250ms budget plus null-on-error), so that an AI-side incident does not degrade the chat path.

## Implementation Decisions

- **One deep module** — `server/services/messageLifecycle/` owns every chat-message mutation that produces a broadcast or runs the content-guard pipeline. Public surface exports the factory, the `MessageLifecycle` interface, the `MessageLifecycleError` union, and the args/ok shapes for the four verbs.
- **Verb scope**: `send`, `edit`, `delete`, `react`. `delivered` and `read` are explicit non-goals and stay as direct query calls in the handler.
- **DI matches `ticketLifecycle`** — factory takes `{ db, ports }` and returns the `MessageLifecycle` interface. Wired at boot in the server bootstrap, threaded into `HandlerContext` as `messageLifecycle` (a flat sibling to the existing `lifecycle: TicketLifecycle`).
- **Ports for cross-boundary deps** — three explicit interfaces: a link-preview port (HTTP OG fetcher), an AI translation port (translate + summary-cache invalidation), and a repetition-guard port (Redis-backed today, fail-open semantics). Storage is NOT a port — the existing `getStorage()` interface is reused unchanged.
- **Result discriminated union, no exceptions for domain errors** — `{ ok: true; data; effects } | { ok: false; code: ... }`. Exhaustive `switch` enforced by TypeScript at every call site. Infrastructure errors still throw.
- **Effect union extended in place** — the existing `Effect` union and `applyEffects` dispatcher in `ticketLifecycle` gain new variants for whisper-only emit, conditional SLA-resolved emit, AI summary cache bust, and background link unfurling. The acknowledged ownership smell (ticketLifecycle types module owning message-named variants) is documented in the module header; a future promotion to a shared `services/lifecycle/` directory is deferred until a third lifecycle module exists.
- **Separate `MessageLifecycleError` union** — domain rejection codes do not overlap with ticket codes, so exhaustive-switch surfaces stay scoped to their own domain.
- **No `db.transaction(...)` wrapper** — single-statement writes are atomic; the SLA stamp runs synchronously inside the lifecycle in a try/catch and emits a conditional effect. This is an intentional divergence from `ticketLifecycle` and is documented in the module header.
- **`Actor` is the identity contract** — reused from `ticketLifecycle`. Built by transport-specific helpers (the existing `socketActor(socket)` and a future `trpcActor(ctx)`). The lifecycle never inspects raw socket / tRPC context.
- **Strict behavior preservation** — sender denormalization with platform-operator membership fallback, content-guard pipeline ordering (sync fail-closed → Redis fail-open), 250ms AI prewarm budget, whisper-clamp warn semantics, dual `error` + `message:rejected` emit on guard rejection, fire-and-forget storage blob cleanup after soft-delete, local-node whisper fan-out — all preserved 1:1.
- **Per-PR sequence, no feature flag** — PR 1 (scaffolding + ports + adapters + Effect extension + HandlerContext wiring + `react` verb) → PR 2 (`edit` + `delete`) → PR 3 (`send`) → PR 4 (cleanup deletes). Each PR independently revertable.
- **Out-of-scope behavior fixes are spawned, not bundled** — the discovered first-message guard bypass in `ticketLifecycle.create` is tracked as a separate task; it must not ride along with this refactor.

## Testing Decisions

- **What makes a good test for this module:** assertions are made against the public `MessageLifecycle` interface only — never against internal helpers in the per-verb implementation files. A test that mocks the database and asserts "the insert helper was called with X" is forbidden; a test that runs the lifecycle against PGLite with port stubs and queries the resulting message rows + effect array is correct. We are testing observable behavior (DB rows, returned effects, rejection codes), not implementation choices.
- **Substrate: PGLite via the existing `createTestDb()` setup.** Real SQL, real single-statement atomicity, no Docker dependency for `npm test`. Substrate is already proven by the `ticketLifecycle` deepening; no spike PR is needed.
- **Port stubs are co-located, not shared.** Stubs for in-memory link preview, canned translations, always-ok / always-block repetition guard, and recording storage live inside the lifecycle directory's test folder. Premature sharing is rejected; if a third module needs them, extract then.
- **Seed helpers inline per test file.** Matches the `ticketLifecycle` test convention. Extracting them to a shared seed module is adjacent cleanup and is deferred.
- **Per-verb assertion shapes (priority-ordered):**
  1. **Tenant isolation.** Actor from partner A cannot mutate a message in partner B's ticket; returns the cross-tenant rejection code with no DB writes and no effects.
  2. **Authorization rejection.** `edit` and `delete` reject non-owner non-staff actors; `edit`/`delete`/`react` reject system messages and tombstones; non-support `send` with `whisper:true` is silently clamped (returns `ok:true` with `isWhisper:false`, plus a warn log).
  3. **Guard pipeline.** Sync guard rejection codes (length, caps, injection) propagate as `GUARD_REJECTED`; the Redis fail-open path verifies that a thrown error from the repetition-guard port still permits the send.
  4. **Edit window expiry.** A message older than the configured window returns `EDIT_WINDOW_EXPIRED` from `edit`.
  5. **Soft-delete blob cleanup.** Deleting a message with a `mediaUrl` and attachments calls the storage interface for each `/uploads/...` path; blob deletion is verified via the recording-storage stub.
  6. **Reaction toggle math.** Adding then removing a user's reaction returns to baseline; toggling the last user out of an emoji clears the key.
  7. **Effect ordering.** A successful `send` returns the effect array in a documented order (broadcast, conditional SLA-resolved, preview invalidation, summary cache bust, link-unfurl background) and a successful whisper `send` returns the whisper-emit effect in place of the public broadcast.
  8. **Translation prewarm.** A canned translation port returns translations attached to the broadcast payload; a stub returning null (timeout) results in a broadcast without the translations field but still succeeds.
- **Target count: ~25–30 boundary tests across 4 verbs.** Weighted heavy on `send` because guard interactions, prewarm races, and whisper authorization concentrate there.
- **Tests deleted in PR 4:**
  - The slices of the existing message-handler test suite that mock query helpers and guards for the four migrated verbs — replaced by lifecycle boundary tests.
  - The slices of the existing message-queries test suite that test the absorbed mutation helpers (those helpers themselves get deleted).
  - Read-helper tests stay (paginated reads, reply-snippet resolvers, avatar batch resolvers) because the underlying functions stay.
- **Prior art for boundary-style tests:** the seven `ticketLifecycle` per-verb test files. Same structure, same PGLite setup, same "test the public interface, not the helpers" discipline.

## Out of Scope

- **`delivered` and `read` socket events.** Pure idempotent timestamp writes with no domain logic; staying as direct query calls in the handler.
- **`ticket:new` first-message insert.** Continues to live inside `ticketLifecycle.create` via the existing private inserter. Routing it through `messageLifecycle` would force a transaction-aware public API on the new module.
- **The first-message content-guard bypass in `ticketLifecycle.create`.** Real bug, but pre-existing and out of scope; tracked as a separate spawned task. If that fix lands first, it should reuse the new `RepetitionGuardPort` and content-guard helpers; otherwise the refactor leaves the bypass intact.
- **Per-message audit-log invariant.** Explicit non-goal. Messages are not audited today and we are not adding an audit invariant in this refactor.
- **`db.transaction(...)` wrappers.** Single-statement writes are atomic; nothing to wrap. Adding a degenerate transaction for symmetry with `ticketLifecycle` is rejected.
- **Wire protocol changes.** Dual `error` + `message:rejected` emit on guard rejection is preserved exactly. Older clients without the structured-event handler must keep working.
- **`HandlerContext` namespace promotion.** The flat `ctx.messageLifecycle` sibling stays; renaming to `ctx.lifecycle.message` / `ctx.lifecycle.ticket` is deferred until a third lifecycle module appears.
- **Building the `trpc.message.*` mutation surface.** The factory is designed so a future tRPC procedure can reuse the lifecycle trivially, but the actual tRPC migration is not part of this work.
- **Extracting shared seed helpers to a common test directory.** Adjacent cleanup; defer.
- **Promoting shared lifecycle types (`Actor`, `Result`, `Effect`, `applyEffects`) to a `services/lifecycle/` shared directory.** Defer until a third lifecycle module exists.
- **Any change to JWT, cookie, refresh-token, or session-revocation machinery.** This refactor is strictly transport-tier orchestration and DB writes; auth boundaries are unchanged.
- **Performance optimizations** (e.g. caching the per-partner `aiFeatures` lookup in an LRU). Out of scope; flag separately if production data demands.

## Further Notes

- This PRD is the implementation acceptance contract. The architectural rationale (the cluster analysis, the dependency-category framework, the deep-vs-shallow tradeoffs, the alternative interface designs that were considered and rejected) lives in [Nathanhael/guichet#49](https://github.com/Nathanhael/guichet/issues/49).
- PR sequence (cumulative 4 PRs): PR 1 (scaffolding + ports + adapters + `Effect` extension + `HandlerContext` wiring + `react`) → PR 2 (`edit` + `delete`) → PR 3 (`send`) → PR 4 (cleanup deletes).
- This refactor is **behavior-neutral** — there are no intentional behavior changes. Every observable property (broadcast payload, emit order, rejection codes, whisper fan-out, SLA stamping semantics, storage cleanup timing, AI prewarm budget) is preserved 1:1. Reviewers should be able to grep the legacy handler and assert each branch maps directly to the new module.
- This refactor pairs with [Nathanhael/guichet#24](https://github.com/Nathanhael/guichet/issues/24) (the just-shipped `ticketLifecycle` deepening, PRD at `docs/superpowers/specs/2026-04-26-deepen-ticketLifecycle-prd.md`). Most architectural decisions are inherited from that precedent; the divergences (no audit invariant, no transaction wrapper, three explicit ports, four verbs not seven) are called out in the Implementation Decisions section above.
- After PR 4, the absorbed mutation helpers no longer exist as exported functions; future callers cannot accidentally bypass the lifecycle. The `messageQueries.ts` file shrinks to read-side helpers shared by tRPC routers and other handlers.
- The single highest-signal test added by this work is the deterministic prewarm-timeout / repetition-fail-open / link-unfurl-stub combination — properties that are impossible to exercise reliably today against the production handler because they require real Redis, real HTTP, and a real AI provider.
