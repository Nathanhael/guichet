# Bundle D / Slice 2 — Migrate Remaining 25 Specs Implementation Plan

> **For agentic workers:** Apply the slice 1 pattern (proven on `status-and-transfer.spec.ts`) to every spec listed below. One commit per migrated spec; verify each individually before moving on.

**Goal:** Apply slice 1's fixture API end-to-end across the remaining 25 spec files. Drop skip count from the 19 fixed in slice 1 to <5 (only legitimate env-flag opt-ins remain). Pass count rises by ≥20.

**Architecture:** Slice 1 introduced the `testFixtures` tRPC router + `testing/e2e/helpers/fixtures.ts` Playwright `test.extend`. Slice 2 is mechanical migration — no new server code, no new helpers. Each spec file:

1. Replace `import { test, expect } from '@playwright/test'` with `import { test, expect } from './helpers/fixtures'` (only when the spec actually uses `ticketFixture`).
2. Replace `let loginOk = false; ... test.skip(!loginOk, ...)` with `throw new Error(...)` on login failure in `beforeEach` per the wiki pattern at `wiki/patterns/e2e-skip-as-silent-failure.md`.
3. For specs that need a ticket in queue: call `ticketFixture.create({ partnerId })` in `beforeEach`, then `page.reload()` so the queue refetches.
4. For inline `test.skip(true, '...')` (already-skipped tests with no fixture path): replace with `ticketFixture.create()` if the test asserts on a ticket; otherwise rewrite the assertion to handle the empty case OR remove the test if it duplicates other coverage.
5. Verify each spec individually: `npx playwright test <spec> --workers=1 --reporter=line`. Pass before committing.

**Tech Stack:** Same as slice 1 — Playwright 1.x, the new `ticketFixture` from slice 1, existing `loginAsDemo` helper.

**Parent issue:** [#83](https://github.com/Nathanhael/guichet/issues/83) (PRD), RFC [#82](https://github.com/Nathanhael/guichet/issues/82). Predecessor: PR #84 (slice 1).

---

## Pre-flight: Decisions Locked Before Coding

### D1. One commit per spec.
Mechanical separation — easier to bisect a regression and reviewers can scan diffs file-by-file.

### D2. Verify per-spec before committing.
After editing a spec, run `npx playwright test <spec> --workers=1 --reporter=line`. Don't batch.

### D3. Pre-existing drift is out of scope.
The 2026-04-28 triage documented genuine spec drift on main (chip-label drift, ProseMirror selectors, httpBatchLink mocks). If a spec fails for those reasons after migration, **do not fix the drift here** — file as a follow-up. Slice 2 only touches the skip predicates and surrounding `beforeEach`/`afterEach`.

### D4. Reseed before each migration.
Run `docker compose exec server npx tsx seed.ts` before EVERY new spec migration to start from clean state. The slice 1 work proved that pollution from earlier specs (lucas joining tickets) can break subsequent runs even with `--workers=1`. Reseeding guarantees deterministic baseline.

### D5. Ticket fixture creates one ticket per test.
Each test owns its own ticket. Auto-cleanup runs in `afterEach`. No shared state across tests in the same describe.

### D6. Multi-user specs (collision-detection, ai-features two-page tests) get fixtures via the first page's auth.
The Playwright fixture auth is page-scoped. For tests that open a second context, the first context's `ticketFixture.create()` provides a ticket id; the second context navigates to the same ticket by id (via URL, sessionStorage, or by waiting for it to appear in queue).

### D7. Existing legitimate env-gated skips stay.
- `chat-demo.spec.ts:105` — `test.skip(!process.env.E2E_CHAT_DEMO, ...)` — explicit recording demo opt-in.
- `sla-flow.spec.ts` — `E2E_INCLUDE_SLA_LIFECYCLE` branches per the 2026-04-28 triage decision.
- These are not predicate skips; they're the documented escape hatch and are NOT migrated.

### D8. After slice 2 ships, the remaining `test.skip` count must be ≤5.
All 5 remaining skips must be `test.skip(!process.env.X, ...)` form. Anything else is a regression and the slice doesn't ship.

---

## Spec inventory

Total: 26 spec files. 1 (`chat-demo.spec.ts`) is legitimately env-gated and NOT migrated. 24 to migrate.

### Group A — Login-predicate-only (no ticket fixture needed)

These specs only have `test.skip(!loginOk/!res.ok, ...)` patterns. Migration is the simple "throw on fail" pattern. Most specs in this group don't need to import the new `test` from `./helpers/fixtures` — they keep `import { test, expect } from '@playwright/test'`.

| Spec | Predicate skips | Notes |
|---|---|---|
| `admin-audit-target-type-filter.spec.ts` | 2 | Audit-log filter UI; admin login. |
| `admin-ticket-audit-drawer.spec.ts` | 5 | Drawer open/close. May need fixture for "ticket in queue" assertions. |
| `chat-flow.spec.ts` | 1 | Single login skip + multi-page setup. |
| `dashboard-actions.spec.ts` | 1 | admin_emma login only. |
| `dashboard-filters.spec.ts` | 1 | admin_emma login only. |
| `dashboard-onboarding.spec.ts` | 1 | admin_emma login only. |
| `guest-admin-visible-disable.spec.ts` | 4 | B2B guest gates; multiple logins. |
| `invite-audit-flow.spec.ts` | 7 | Pending invites; multiple logins. |
| `platform-audit-drawer.spec.ts` | 2 | platform_bart login. |
| `platform-chain-integrity.spec.ts` | 1 | platform_bart login. |
| `platform-chain-rate-limit.spec.ts` | 1 | platform_bart login. |
| `platform-view.spec.ts` | 3 | platform_bart login. |
| `queue-lang-awareness.spec.ts` | 8 | Mostly login + feature-flag predicates. The `queueLangAwareness not enabled` skip is legit env-gated. |
| `sla-flow.spec.ts` | 3 | login predicates. The `E2E_INCLUDE_SLA_LIFECYCLE` branch stays. |
| `support-shortcuts.spec.ts` | 1 | login + opened predicate. |

### Group B — Need ticket fixture (single-page)

These specs assert on tickets in queue. Migrate to use `ticketFixture.create()` in `beforeEach` + reload.

| Spec | Predicate skips | Inline skips | Notes |
|---|---|---|---|
| `admin-queue-archive.spec.ts` | 4 | 1 | Admin queue + close ticket. |
| `chat-enhancements.spec.ts` | 2 | 2 | Search FAB + label picker. Inline skips for "queue drained". |
| `split-view.spec.ts` | 4 | 0 | Two-pane view; one ticket needed. |
| `support-view.spec.ts` | 3 | 0 | Archive tab; one ticket optional. |
| `view-modes.spec.ts` | 9 | 7 | View dropdown; needs ≥2 tickets in queue. |
| `support-flow.spec.ts` | 11 | 0 | Multi-test ticket flow. |

### Group C — Need ticket fixture + multi-user

These create a ticket + log in two users in different contexts.

| Spec | Predicate skips | Notes |
|---|---|---|
| `agent-flow.spec.ts` | 9 | Agent creates ticket; support joins. May replace agent-side create with fixture. |
| `ai-features.spec.ts` | 31 | Many tests; some open tickets, some don't. Tightly coupled to "find first ticket". |
| `collision-detection.spec.ts` | 9 | Two users open same ticket. |

---

## Conventions

- **One commit per spec:** `refactor(testing): migrate <spec-name> to ticketFixture (-N skips)`
- **Per-spec verify command:** `npx playwright test testing/e2e/<spec> --workers=1 --reporter=line`
- **Reseed before each migration:** `docker compose exec server npx tsx seed.ts`
- **Branch:** `feat/bundle-d-slice-2-migrate-specs` (off slice 1 branch)
- **Targets:** PR targets `main` (slice 1's commits will be in main when slice 1 PR merges; slice 2's diff against main is just the spec migrations).

---

## Tasks

### Task 1: Group A migrations (light — login-only)

For each spec in Group A, the migration pattern is:

```ts
test.beforeEach(async ({ page }) => {
  const res = await loginAsDemo(page, '<user>');
  if (!res.ok) {
    throw new Error(
      `Fixture user '<user>' failed to log in (status ${res.status}). ` +
      'Check server/seed.ts — this is a test setup bug, not a skip condition.',
    );
  }
  await page.waitForLoadState('networkidle');
});
```

Then delete every `test.skip(!loginOk, ...)` / `test.skip(!res.ok, ...)` in the test bodies.

If the spec uses `let loginOk = false; ... loginOk = !!res.ok` pattern in `beforeEach`, replace the `let` + assignment with the throw-on-fail variant above.

Specs and order:

- [ ] `dashboard-actions.spec.ts` — 1 skip
- [ ] `dashboard-filters.spec.ts` — 1 skip
- [ ] `dashboard-onboarding.spec.ts` — 1 skip
- [ ] `chat-flow.spec.ts` — 1 skip
- [ ] `support-shortcuts.spec.ts` — 1 skip
- [ ] `platform-chain-integrity.spec.ts` — 1 skip
- [ ] `platform-chain-rate-limit.spec.ts` — 1 skip
- [ ] `admin-audit-target-type-filter.spec.ts` — 2 skips
- [ ] `platform-audit-drawer.spec.ts` — 2 skips
- [ ] `platform-view.spec.ts` — 3 skips
- [ ] `sla-flow.spec.ts` — 3 skips (preserve `E2E_INCLUDE_SLA_LIFECYCLE` branches)
- [ ] `guest-admin-visible-disable.spec.ts` — 4 skips
- [ ] `admin-ticket-audit-drawer.spec.ts` — 5 skips (some may need fixture)
- [ ] `invite-audit-flow.spec.ts` — 7 skips
- [ ] `queue-lang-awareness.spec.ts` — 8 skips (preserve env-flag branches)

After each: reseed, run the spec, commit.

### Task 2: Group B migrations (ticket fixture, single-page)

For each spec, switch the import to `import { test, expect } from './helpers/fixtures'` and use `ticketFixture` in `beforeEach`:

```ts
test.beforeEach(async ({ page, ticketFixture }) => {
  const res = await loginAsDemo(page, '<user>');
  if (!res.ok) throw new Error(...);
  const partnerId = await page.evaluate(() => sessionStorage.getItem('activePartnerId'));
  if (!partnerId) throw new Error('No active partner');
  await ticketFixture.create({ partnerId });
  await page.reload();
  await page.waitForLoadState('networkidle');
});
```

For tests that need ≥2 tickets (e.g., `view-modes`'s "fewer than 2 tickets" inline skips), call `ticketFixture.create()` twice.

Specs and order:

- [ ] `support-view.spec.ts` — 3 skips
- [ ] `chat-enhancements.spec.ts` — 4 (2 predicate + 2 inline) — search FAB + label picker
- [ ] `admin-queue-archive.spec.ts` — 5 (4 predicate + 1 inline)
- [ ] `split-view.spec.ts` — 4 skips
- [ ] `support-flow.spec.ts` — 11 skips
- [ ] `view-modes.spec.ts` — 16 (9 predicate + 7 inline)

### Task 3: Group C migrations (ticket fixture, multi-user)

Multi-user specs need careful attention to which page creates the fixture. Pattern:

```ts
test.beforeEach(async ({ ticketFixture }) => {
  // Always create fixture from the test-scope page (not page1/page2).
  // ticketFixture is page-scoped; use the test's main `page` for create,
  // and the spec opens additional contexts as needed.
});

test('two users see same ticket', async ({ browser, page, ticketFixture }) => {
  const res1 = await loginAsDemo(page, 'support_lucas');
  if (!res1.ok) throw new Error(...);
  const partnerId = await page.evaluate(() => sessionStorage.getItem('activePartnerId'));
  const ticketId = await ticketFixture.create({ partnerId });

  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  try {
    const res2 = await loginAsDemo(page2, 'support_oliver');
    if (!res2.ok) throw new Error(...);
    // page2 sees the same ticket via partner-scoped queue list
    ...
  } finally {
    await ctx2.close();
  }
});
```

Specs and order:

- [ ] `agent-flow.spec.ts` — 9 skips
- [ ] `collision-detection.spec.ts` — 9 skips
- [ ] `ai-features.spec.ts` — 31 skips (largest, save for last)

### Task 4: Final skip-count check + CHANGELOG

- [ ] Run `Grep "test\.skip\(!" testing/e2e/` and confirm only `process.env.X` matches remain.
- [ ] Run `Grep "test\.skip\(true" testing/e2e/` and confirm zero matches.
- [ ] Update CHANGELOG with slice 2 entry.
- [ ] Run `powershell -File scripts/ci.ps1 -Skip e2e` (e2e total runs in slice 3).
- [ ] Open PR.

---

## Self-Review Checklist

| Acceptance criterion | Task |
|---|---|
| Skip count drops to <5 (env-flag opt-ins only) | Task 4 |
| Pass count rises by ≥20 | Task 4 |
| Each migrated spec passes individually | Tasks 1-3 (per-spec) |
| One commit per migrated spec | (Convention) |
| No selector / behavioral changes (just skip-pattern migration) | (Convention — D3) |
| `chat-demo.spec.ts` not migrated (legit env-gated) | (D7) |
| `scripts/ci.ps1 -Skip e2e` passes | Task 4 |
| CHANGELOG entry | Task 4 |

---

## End

Slice 2 ships: 24 specs migrated, predicate-skip count → 0 (only env-flag opt-ins remain). Slice 3 (CI grep guard + wiki decision page + final CHANGELOG) lands after.
