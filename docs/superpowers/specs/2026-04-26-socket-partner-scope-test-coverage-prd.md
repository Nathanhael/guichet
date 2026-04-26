# Socket Partner-Scope Guard — Cross-Tenant Test Coverage (Cluster #2 Follow-up)

**Date:** 2026-04-26
**Status:** Drafted
**Project:** Guichet
**Related:**
- `docs/superpowers/specs/2026-04-26-deepen-ticketLifecycle-prd.md` — the PRD whose "Out of Scope" section named this cluster
- `D:\Projects_Coding\wiki\wiki\decisions\guichet-ticketlifecycle-deepening.md` — the decision page that will get a follow-up footer

---

## Problem Statement

The ticketLifecycle deepening (PRs #33–#39 + #40, merged 2026-04-26) was scoped to seven ticket-state transitions and explicitly listed "socket partner-scope guard cleanup" as cluster #2 — out of scope for the deepening but still owed.

A pre-flight audit for cluster #2 found that the migration is already complete. Every ticket-touching socket event in the five target handler files (`message.ts`, `collision.ts`, `rating.ts`, `preview.ts`, `disconnect.ts`) already routes through the canonical `requirePartnerScope` / `requirePartnerScopeWith` helpers in `server/socket/partnerScope.ts`. Zero hand-rolled `if (ticket.partnerId !== socket.data.partnerId)` checks remain anywhere outside the helper itself.

What does **not** exist is integration coverage proving the guard is actually wired up. `server/__integration__/isolation.test.ts` covers exactly four socket events: `support:join`, `message:send`, `ticket:close`, `ticket:labels:update`. The remaining ten ticket-touching events have no cross-tenant rejection test. A future refactor that silently drops a guard line — or moves the partner-scope check after the side effect — would ship without anything failing.

The harm here is concrete: a regression on `message:loadMore` leaks every message body in a cross-tenant ticket; a regression on `message:edit / delete / react` lets a caller mutate another partner's chat history; a regression on `rating:submit` writes a CSAT row for a ticket the caller never owned.

## Solution

Lock in the standardization with cross-tenant rejection tests for the ten ticket-touching socket events that currently have a guard but no integration test. Each test mocks the relevant `findTicket*` query to return a ticket belonging to a different partner, dispatches the event, and asserts both that the handler emits the canonical `Not authorized` error **and** that the harmful side-effect mock was never called.

No production code changes. The PR is a single file diff against `server/__integration__/isolation.test.ts` plus two new mock blocks in its `beforeEach` setup.

## User Stories

1. As a platform engineer reviewing a future socket-handler refactor, I want a failing test if a partner-scope guard is dropped from `message:edit`, so that I catch the regression before merge instead of in production.

2. As a platform engineer reviewing a future socket-handler refactor, I want a failing test if a partner-scope guard is dropped from `message:delete`, so that a caller cannot soft-delete messages on a ticket they don't own.

3. As a platform engineer reviewing a future socket-handler refactor, I want a failing test if a partner-scope guard is dropped from `message:react`, so that a caller cannot manipulate reactions on a ticket they don't own.

4. As a platform engineer reviewing a future socket-handler refactor, I want a failing test if a partner-scope guard is dropped from `message:read`, so that read receipts cannot be forged on cross-tenant tickets.

5. As a platform engineer reviewing a future socket-handler refactor, I want a failing test if a partner-scope guard is dropped from `message:delivered`, so that delivery receipts cannot be forged on cross-tenant tickets.

6. As a platform engineer reviewing a future socket-handler refactor, I want a failing test if a partner-scope guard is dropped from `message:loadMore`, so that the paginated message body endpoint cannot be used to enumerate another partner's ticket history.

7. As a platform engineer reviewing a future socket-handler refactor, I want a failing test if a partner-scope guard is dropped from `ticket:viewing`, so that a caller cannot inject their identity into another partner's collision-detection viewer set in Redis.

8. As a platform engineer reviewing a future socket-handler refactor, I want a failing test if a partner-scope guard is dropped from `ticket:left`, so that the same Redis viewer set cannot be tampered with from outside the tenant.

9. As a platform engineer reviewing a future socket-handler refactor, I want a failing test if a partner-scope guard is dropped from `rating:submit`, so that a caller cannot insert a CSAT row scoped to another partner's ticket.

10. As a platform engineer reviewing a future socket-handler refactor, I want a failing test if a partner-scope guard is dropped from `ticket:preview:join`, so that a caller cannot join the preview room for a ticket in another tenant.

11. As a future-self auditing the codebase six months from now, I want the wiki decision page on the ticketLifecycle deepening to record that cluster #2 was a no-op in production code, so that I do not re-open the same audit and waste a session re-discovering it.

12. As a reviewer reading the PR, I want the PR body to clearly state that the audit found the standardization already complete, so that the test-only diff doesn't look like an accidental scope reduction.

13. As an oncall engineer triaging a future cross-tenant CVE report, I want the integration test suite to exercise the partner-scope path on every ticket-touching socket event, so that I can rule out the socket transport in seconds rather than hand-tracing each handler.

## Implementation Decisions

**Test file home.** New tests live in `server/__integration__/isolation.test.ts` alongside the existing four socket-handler isolation tests. The other isolation file (`tenantIsolation.test.ts`) covers tRPC/REST routes and is out of scope.

**Test pattern.** Copy-paste the existing four tests' shape rather than parameterizing. Per-handler payload variance (`rating:submit` needs `agentId` and `comment`, `message:edit` needs `messageId` and `text`, `message:react` needs `emoji`) and per-handler mock-return-shape variance (`findTicketOwner` returns a different shape than `findTicketForMessage` than `findTicketPartner`) make a parameterized table uglier than the duplication.

**Assertion depth.** Two assertions per test: (1) the handler emits `error` with a message matching `/Not authorized/`, (2) the relevant write/broadcast mock was never called. The first asserts the helper ran; the second asserts the handler short-circuited correctly. For mutating events (`message:edit / delete / react`, `rating:submit`, `message:read / delivered`, `ticket:viewing`) this means asserting on `updateMessageText`, `softDeleteMessage`, `updateMessageReactions`, `insertRating`, `markRead`, `markDelivered`, and the Redis pipeline respectively.

**Mock setup.** Add two new `vi.mock` blocks at the top of the file: one for `services/messageQueries.js` (covering `markDelivered`, `markRead`, `updateMessageText`, `softDeleteMessage`, `updateMessageReactions`, `findTicketMessagesPaginated`, `findMessageForEdit`, `findMessageForDelete`, `findMessageForReact`), one for `utils/redis.js` (so the collision side-effect-not-called assertion can observe that `pubClient.multi()` was never built). Reset all new mocks in the existing `beforeEach`.

**Events covered.** All ten ticket-touching socket events that currently have a guard but no integration test:

| Handler | Events | Helper variant | Side-effect mock to assert NOT called |
|---|---|---|---|
| `message.ts` | `loadMore` | `requirePartnerScope` | `findTicketMessagesPaginated` |
| `message.ts` | `delivered` | `requirePartnerScope` | `markDelivered` |
| `message.ts` | `read` | `requirePartnerScope` | `markRead` |
| `message.ts` | `edit` | `requirePartnerScope` | `updateMessageText` |
| `message.ts` | `delete` | `requirePartnerScope` | `softDeleteMessage` |
| `message.ts` | `react` | `requirePartnerScope` | `updateMessageReactions` |
| `collision.ts` | `viewing` | `requirePartnerScope` | Redis `pubClient.multi` |
| `collision.ts` | `left` | `requirePartnerScope` | Redis `pubClient.hDel` |
| `rating.ts` | `submit` | `requirePartnerScopeWith(findTicketOwner)` | `insertRating` |
| `preview.ts` | `preview:join` | `requirePartnerScope` | `socket.join(Rooms.ticketPreview(...))` |

**Events explicitly NOT tested.**
- `ticket:preview:leave` — no DB lookup, no broadcast, only calls `socket.leave(room)`. Adding a guard would be a round-trip with no purpose; adding a test would assert nothing.
- The `disconnect` event — operates on `socket.rooms` the socket is already in. No ticket-scoped DB lookups. Cleanup paths in `disconnect.ts` are already covered by `disconnect.test.ts`.

**No new tracking issue.** PR is opened directly. The audit's surprise finding (cluster #2 premise was stale) is documented in the PR body itself, in a wiki log line, and in a "Follow-up audit" footer on the existing `wiki/decisions/guichet-ticketlifecycle-deepening.md` page.

**No production code changes.** The five target handler files already use the helpers. Confirming this is part of the audit and is recorded in the wiki.

## Testing Decisions

**Definition of a good test in this PRD.** Each test asserts on the externally observable contract — the socket emit and the absence of the harmful side effect. No test asserts on internal helper invocation counts, on log lines, or on mock-call counts that don't correspond to a real-world side effect. The principle: a future refactor that swaps `requirePartnerScope` for an equivalent guard helper should not break any of these tests; only a refactor that actually drops the guard or reorders it after the side effect should.

**Modules tested.** The five socket handler files (`message.ts`, `collision.ts`, `rating.ts`, `preview.ts`) via the integration harness in `isolation.test.ts`. Tests run against the real handler code with mocked Drizzle queries and a stubbed lifecycle (`disconnect.ts` is not exercised because it has no ticket-scoped DB lookups).

**Prior art.** Four existing tests in `isolation.test.ts` cover `support:join`, `message:send`, `ticket:close`, `ticket:labels:update`. The new tests follow the same shape: build a mock socket with `partnerId: 'partner-A'`, run the connection handler to register the socket-side `on()` listeners, retrieve the handler from the `socket.on` mock, mock the relevant `findTicket*` query to return a ticket with `partnerId: 'partner-B'`, dispatch a payload, assert.

**Verify-can-fail rigor.** For two representative new tests — one using the `requirePartnerScope` variant (e.g., `message:edit`) and one using the `requirePartnerScopeWith` variant (e.g., `rating:submit`) — temporarily comment out the guard line in the handler, re-run, confirm the test fails. Restore the handler and re-run to confirm green. This proves the test pattern catches the regression it claims to catch; the remaining eight are copy-paste of the same pattern and inherit the proof.

**Verification before push.** `scripts/ci.ps1 -Skip e2e`. Pure-test PR — typecheck and server tests are the only steps that matter. E2E is overkill (no behavior changes, no UI). Expected: 930 server tests passing (920 baseline + 10 new).

## Out of Scope

- Refactoring socket handlers. The audit found nothing to refactor; all five target files already use the canonical helpers.
- Adding a partner-scope guard to `ticket:preview:leave`. It only calls `socket.leave(room)`; no DB lookup, no broadcast, no leak surface.
- Tests against `disconnect.ts`. No ticket-scoped DB lookups happen in the disconnect path.
- Splitting `isolation.test.ts` into per-handler files. The existing four tests live in one file; consistency over premature reorganization.
- Refactoring the existing four tests into a parameterized `it.each()` table. Same consistency reasoning — and the per-handler payload variance would make the table ugly.
- Tests against tRPC partner-scope (already covered by `tenantIsolation.test.ts`).
- New helper extraction for the test boilerplate (e.g., `expectCrossTenantReject(...)`). Considered and rejected during planning — copy-paste matches the existing pattern and the per-handler variance reduces the abstraction's payoff.

## Further Notes

**Audit finding documented in three places.** PR body, wiki log line, and a "Follow-up audit (2026-04-26)" footer on `wiki/decisions/guichet-ticketlifecycle-deepening.md`. The footer is the most important — it closes the loop on the deepening's "out of scope" callout so a future auditor doesn't re-open the same investigation.

**PR title.** `test(isolation): finish socket cross-tenant coverage (cluster #2 follow-up)`. Connects this PR to the deepening's open thread.

**Why the audit happened at all.** The deepening's "Out of scope" section listed cluster #2 as the next obvious follow-up. The expected scope was "standardize three patterns down to one." Reality: the patterns already converged during the deepening (likely as part of PR 5 `3826e23` "migrate close + create — biggest pre-flight surface"). This PRD is the receipt that someone actually checked.
