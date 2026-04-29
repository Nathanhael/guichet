# PRD: E2E Fixture Pattern — Bundle D

**Companion to RFC [#82](https://github.com/Nathanhael/guichet/issues/82).** RFC #82 defines the technical interface; this PRD captures the user-facing requirements, scope, and acceptance criteria.

**Author:** Bart
**Date:** 2026-04-29
**Status:** Draft → Open for review

## Problem statement

Engineers writing or reviewing Guichet E2E specs face a class of silent failure that is invisible in `scripts/ci.ps1` output: runtime-predicate skips (`test.skip(!loginOk, ...)`, `test.skip(!hasTicket, ...)`, `test.skip(true, ...)`). Today the e2e step reports 105 passed / 30 skipped / 0 failed. The 30-skipped figure is treated as PASS by CI; ~135 individual `test.skip(...)` calls across 26 spec files mask fixture drift as green.

When the seed ticket Kevin gets auto-claimed by an earlier spec, when demo-login races on a cold container, when an admin spec runs after a support spec drained the queue — the test bails as SKIP and CI is green. Real coverage drops without an alert.

For an engineer reviewing a PR, the result is a CI green light that doesn't actually verify the migrated code path. For a security reviewer, the result is rules that drift between transports without anyone noticing — same disease as the runtime "silent catch" pattern, but in the test layer.

## Solution

Consolidate test-state setup behind a deep `trpc.testFixtures.*` router that production-gates at three layers (module-load assert, conditional mount, per-procedure recheck) and a thin Playwright helper that auto-registers cleanup. Specs migrate from "best-effort observation of seeded state" to "explicit creation + assertion + cleanup".

A new spec authoring a ticket-shape test obtains a ticket id in one line via `await ticketFixture.create(...)`. Cleanup runs automatically in `afterEach` via Playwright fixture extension. Demo-login failures become hard errors that fail CI, not skips. The `30 → <5` skip-count change is enforced by a grep guard in slice 3.

The migration is staged across three pull requests so the new API and the old skip-pattern coexist during the transition; no single PR rewrites every spec.

## User stories

1. As an E2E author writing a new spec, I want to create an open ticket in one line so I do not depend on whatever the seed script seeded for that partner.

2. As an E2E author migrating an existing spec, I want to delete `test.skip(!loginOk, ...)` and trust that demo-login failure produces a hard test error, so that fixture drift fails CI instead of silently skipping.

3. As an E2E author for status/presence tests, I want to stage agent X as "online" before the assertion runs, so that test ordering does not affect the outcome.

4. As an E2E author who creates a ticket in `beforeEach`, I want it cleaned up automatically in `afterEach`, so that I cannot pollute the queue by forgetting cleanup.

5. As an oncall engineer running CI, I want skip count to be a hard failure signal — any new `test.skip(...)` in a PR that is not env-gated breaks CI.

6. As a security reviewer, I want fixture endpoints to be unreachable in production: deny-by-default at the router-mount layer, and a server boundary test asserts the router file throws on import in prod.

7. As a security reviewer, I want fixture creation to require an authenticated demo-login session, so that no anon caller can manufacture state even in non-prod.

8. As a maintainer reviewing a slice 2 PR, I want one commit per migrated spec with a clear message, so that bisecting a regression points at one spec at a time.

9. As a new contributor onboarding to E2E, I want a single fixture module to read, so I learn one mental model rather than tracing through seed scripts and test-internal `beforeEach` predicates.

10. As a developer adding a new fixture (e.g., business-hours override), I want to add a procedure to `testFixtures.ts` and a wrapper to the Playwright helper, so the production-gate pattern is reused automatically.

11. As a test author, I want existing legitimate env-gated skips (`E2E_INCLUDE_SLA_LIFECYCLE`, `E2E_CHAT_DEMO`) to stay, so that explicit opt-in remains a first-class option for slow / demo-only tests.

12. As an oncall engineer reading the audit trail of test-fixture activity, I want fixture-created tickets to NOT appear in `audit_log`, so that real audit signal isn't drowned in test noise. (Or alternatively: fixtures emit a clearly-labeled `audit.test_fixture` action that is filtered out of platform/audit views by default.)

## Implementation decisions

**Hybrid pathway, single router.** Both ticket-shape fixtures and reset-style fixtures live under `trpc.testFixtures.*`. Subroutes within: `createTicket`, `ensureTicketInQueue`, `cleanup`, `resetAgentStatus`. Adding a new fixture means adding a new procedure, not creating a new pathway. The router has its own context (no partner-scope assumed; many fixtures cross-tenant by design).

**Production-safety: three layers.** Module-load `assertNotProduction()` panics on import. `server/trpc/router.ts` conditionally mounts `testFixtures` only when `NODE_ENV !== 'production'`. Each procedure re-asserts inside the resolver. Boundary test asserts the file panics on import in prod.

**Test-side fixture is Playwright-native.** The helper at `testing/e2e/helpers/fixtures.ts` exposes a `test` export (extended Playwright `test`) that registers a `ticketFixture` per-test slot. The slot is teardown-aware: any tickets created via the slot's `create()` method are cleaned up automatically in `afterEach`. Forgetting cleanup is impossible by construction.

**Auth: dev-login only.** The fixture helper uses `page.request.post()` to inherit the spec's demo-login cookie. No new auth surface. Specs continue to call the existing `loginAsDemo` helper at the top of `beforeEach`. If a spec calls a fixture before logging in, the fixture creation 401s — treated as a feature (fixtures require an authenticated session, mirroring production's no-anon-creates contract).

**Migration is per-spec, not big-bang.** Slice 2 migrates one spec at a time and runs `scripts/ci.ps1` between each to detect regressions early. The slice is one PR but multiple commits — one per migrated spec.

**Slice 3 hard-bans the pattern via CI grep.** Final slice adds a regex guard to `scripts/ci.ps1` and updates the wiki pattern page. After this lands, any PR introducing a new `test.skip(!somePredicate, ...)` (not env-gated) fails CI.

**Existing legitimate skips stay.** `E2E_INCLUDE_SLA_LIFECYCLE` (sla-flow.spec.ts), `E2E_CHAT_DEMO` (chat-demo.spec.ts) are explicit env-flag opt-ins. The grep guard's whitelist accepts the `process.env.X` form.

**Audit log: fixtures emit a labeled action.** Fixture-created tickets emit `audit.test_fixture.ticket_created` rather than the normal `ticket.created`. Platform audit view filters these by default to keep the audit-log readable; an explicit toggle reveals them. This honors story #12 without breaking the audit-chain hash.

**Shared E2E partner.** Most specs use the existing `acme` partner; cross-tenant specs use `betacorp`. Per-test partner isolation is rejected as too heavy. Ticket-level isolation (each test creates unique ticket ids; no test asserts "exactly N tickets in queue") is sufficient.

**Cleanup is automatic, idempotent, and stale-safe.** The Playwright fixture's teardown calls `testFixtures.cleanup` with the recorded ticket ids. Cleanup is idempotent (calling twice is fine) and stale-safe (calling with a non-existent id is a no-op, not an error). Specs that need to assert post-close state can mark the ticket "do not auto-cleanup" via an opt-out flag.

## Testing decisions

**Test philosophy.** Tests assert observable behavior at the new module's boundary, not at internal helper signatures. Fixture procedures are tested via their tRPC-call surface; the Playwright helper is exercised via real spec migrations rather than parallel unit tests.

**New tests added.**

- `server/__tests__/testFixtures.boundary.test.ts` — assert the router file throws on import when `NODE_ENV=production`.
- `server/__tests__/testFixtures.auth.test.ts` — assert each fixture procedure rejects unauthenticated requests.
- `server/__tests__/testFixtures.createTicket.test.ts` — happy path + invalid partner id + invalid agent email.
- `server/__tests__/testFixtures.cleanup.test.ts` — idempotency (calling twice with same id is fine) + stale-safety (calling with non-existent id is fine).
- `server/__tests__/testFixtures.resetAgentStatus.test.ts` — status/Redis state matches expected.

**E2E migration validation.**

- After every spec migration in slice 2, run that spec individually with `--workers=1` and assert pass.
- After slice 2 lands, run full `scripts/ci.ps1` and assert skip count <5.
- Slice 3's grep guard exists to catch regressions in future PRs.

**Tests deleted.** No existing tests are deleted. The `test.skip(...)` calls being eliminated are not tests; they are absence-of-tests. Each migrated spec's behavioral assertions stay intact (the body that comes after the skip).

## Acceptance criteria

- [ ] Skip count: 30 → <5 (env-flag opt-ins only).
- [ ] Pass count rises by at least 20.
- [ ] No new fixture endpoint reachable in production (boundary test).
- [ ] `scripts/ci.ps1` passes after each slice.
- [ ] Wiki decision page filed at `wiki/decisions/guichet-e2e-fixture-pattern.md`.
- [ ] Wiki pattern page updated to call out the resolution.
- [ ] CHANGELOG entries per slice.
- [ ] Slice plans on disk before each slice's coding.
- [ ] CI grep guard active by end of slice 3.

## Out of scope

- ESLint rule for the no-predicate-skip pattern. CI grep guard suffices.
- Migrating selector logic in any spec. Slice 2 only touches the skip predicates and the surrounding `beforeEach` / `afterEach`.
- Worker-level parallelism tuning.
- Auth bypass tokens or new mint endpoints. Reuse dev-login.
- Per-test ephemeral partners. Shared partner with ticket-level isolation is enough.
- Migrating `chat-demo.spec.ts` (intentionally env-gated for a recording demo) or `sla-flow.spec.ts` env-gated branches (intentionally heavyweight).
- A unified test-fixture API for client-side unit tests. Scope is E2E only.

## Further notes

The RFC at issue #82 contains the technical interface signatures and the side-by-side comparison of design alternatives that produced these decisions. This PRD focuses on user-facing requirements and scope; readers comparing the two should treat the RFC as the contract for the module's internal API and this PRD as the contract for what shipped behavior must look like to engineers and reviewers.

The implementation plans (forthcoming, separate documents at `docs/superpowers/plans/`) break the three slices into ordered tasks with acceptance criteria per slice.

Implementation decisions about hybrid pathway, production-safety layers, auth reuse, shared partner, and audit-log handling were resolved through the brainstorming pass against RFC alternatives; the resolutions are reflected above.
