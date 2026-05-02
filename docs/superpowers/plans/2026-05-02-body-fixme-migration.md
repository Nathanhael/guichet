# Body-Fixme Migration — Post-#117 Follow-up

**Date:** 2026-05-02
**Status:** Plan; not yet executing
**Predecessor:** [#117 partner-isolation fixture](../../decisions/superpowers) → wiki `decisions/guichet-117-partner-isolation`
**Successor of:** Bundle D (`decisions/guichet-e2e-fixture-pattern`)

## Context

#117 closed all 8 of PR #116's `test.fixme(...)` markers (the top-level kind, where the test is wrapped in `test.fixme('...', async ...)`). Ten **body-level** `test.fixme()` calls remain in the suite — different syntax, different cause classes, kept out of #117 scope because they're not the "shared seed cross-test pollution" problem the partner-isolation fixture addresses.

This plan inventories the ten, categorizes by cause class, and proposes the migration shape.

## Inventory

| File | Line | Test | Cause class |
|---|---|---|---|
| `agent-flow.spec.ts` | 118 | "support joins and exchanges messages with agent" | Multi-context + zustand `supportOpenTickets` empty on fresh page → julie's ticket appears in lucas's collapsed "Claimed by others" section |
| `agent-flow.spec.ts` | 184 | "closing ticket shows rating modal and returns to form" | Same as 118 |
| `ai-features.spec.ts` | 583 | "two users viewing same ticket see collision banner" | Multi-context (lucas + sophie) + shared seed pollution |
| `ai-features.spec.ts` | 643 | "leaving a ticket removes collision banner for others" | Same as 583 |
| `collision-detection.spec.ts` | 192 | "switching tickets updates collision state" | 60s timeout exceeded — 2 fixture creates × 2 contexts × multiple `waitForTimeout(3000)` calls; needs poll-until-state design, not isolation |
| `support-flow.spec.ts` | 74 | "tab persists across page refresh" | Cross-test claimed-tickets state lingers in lucas's session even between tests |
| `support-flow.spec.ts` | 118 | "support closes ticket — tab removed" | Same as 74 |
| `support-flow.spec.ts` | 191 | "transfer ticket to different department" | Cross-test pollution + multi-context + socket-propagation timing brittleness |
| `view-modes.spec.ts` | 241 (body) | "switching back to Normal from Focus restores the layout" | UI selector drift: `.border-border-heavy` / `[class*="border-heavy"]` doesn't match the soft-product redesign's dropdown wrapper |
| `view-modes.spec.ts` | 383 (body) | "split view shows multiple chat panels when 2+ tabs are open" | Needs 2+ joinable tickets; the migrated `Split View` beforeEach seeds only 1 (the other tests in the describe only need 1) |

## Categorization

### Group A — partner-isolation directly applies (5 tests)

**Tests:** `ai-features:583`, `ai-features:643`, `support-flow:74`, `support-flow:118`, `support-flow:191`.

**Why it works:** Each test's failure mode is dominated by *cross-test claim/close pollution* on the shared seed Acme tenant — exactly what `partnerFixture` was built for. A fresh partner per test eliminates the leftover-claimed state and gives the test deterministic queue/ticket data.

**Migration shape:**

```ts
test('two users viewing same ticket see collision banner', async ({ browser, partnerFixture }) => {
  const { userId: lucasUid } = await partnerFixture.createUser({ role: 'support', departments: ['general'] });
  const { userId: sophieUid } = await partnerFixture.createUser({ role: 'support', departments: ['general'] });
  const ticketId = await partnerFixture.createTicket();

  // Page 1: fixture's bootstrap page → loginAs lucas
  await partnerFixture.loginAs(lucasUid, { waitFor: 'networkidle' });

  // Page 2: separate context, login as sophie via the shared loginAsDemo
  // helper (no need to extend partnerFixture API — both users exist on the
  // fresh partner, both are loginable via /dev-login).
  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  try {
    const res2 = await loginAsDemo(page2, sophieUid, { waitFor: 'networkidle' });
    if (!res2.ok) throw new Error(`sophie loginAs failed: ${res2.status}`);

    // ...both pages open ticketId, assert collision banner...
  } finally {
    await ctx2.close();
  }
});
```

**No partnerFixture API extension needed.** The fixture's `createUser` already mints loginable users; the existing `loginAsDemo` helper handles the second-context auth. The pattern is "fresh partner + multiple users, login each context separately."

**Slice A1:** `ai-features.spec.ts` (2 tests). Smaller. Same partner, 2 support users, 1 ticket.
**Slice A2:** `support-flow.spec.ts` (3 tests). One uses 1 ticket + 1 user; one uses 1 ticket + 1 user; one uses 1 ticket + 2 users + multi-dept transfer. The `closeKevinTickets()` raw-psql workaround can be deleted (fresh partner means no kevin pollution to clean).

### Group B — partner-isolation helps but underlying app issue remains (2 tests)

**Tests:** `agent-flow:118`, `agent-flow:184`.

**Why it's not just isolation:** The fixme comment names the actual blocker — *"lucas's `supportOpenTickets` zustand state is empty on a fresh page even though server-side `supportId=lucas`"*. A fresh fixture user has no historical claims, so the inconsistency between server-side `supportId` and client-side zustand wouldn't manifest on a fresh user. Migration *should* unblock these tests as a side effect.

**But:** if the underlying zustand-restoration bug is real, it'll bite production users on a fresh page reload too. Worth verifying as part of this slice — if migration unblocks the test BUT the real bug still exists in prod, file a follow-up issue. If migration unblocks it AND the underlying flow is now demonstrably correct (e.g. agent's ticket appears in support's "My Chats" not "Claimed by others"), close the matter as fixture-only.

**Slice B:** `agent-flow.spec.ts` (2 tests). 1 partner, 1 agent user (julie-equivalent), 1 support user (lucas-equivalent), 1 ticket where the agent posts first. After migration, run + observe whether the agent's ticket lands in support's "My Chats" or "Claimed by others" section. Document the finding inline in the test or in a follow-up issue.

### Group C — different cause classes, not partner-isolation extension (3 tests)

**Tests + fixes:**

- **`collision-detection:192` ("switching tickets updates collision state")** — design issue, not state issue. The test exceeds its 60s budget because of 5+ `waitForTimeout(3000)` calls combined with 2-context teardown. Fix: replace the fixed sleeps with `expect.poll(() => banner.isVisible(), { timeout: 10000 })` so the test exits as soon as the banner state stabilizes. Migration to `partnerFixture` is orthogonal — would help marginally with the queue-state race but the timeout is the dominant problem. **Worth doing, but as a refactor PR, not as part of body-fixme migration.**

- **`view-modes:241` ("switching back to Normal from Focus restores the layout")** — UI selector drift. The soft-product redesign moved the dropdown out of `.border-border-heavy` containers. Fix: identify the new wrapper class via DevTools, update the two `dropdown1`/`dropdown2` locators. Could batch with a wider `frontend/` selector audit if other tests have the same drift. **Mechanical fix, no fixture work.**

- **`view-modes:383` ("split view shows multiple chat panels when 2+ tabs are open")** — needs 2+ joinable tickets. The migrated `Split View` describe's beforeEach seeds 1 (matching the other tests in the describe). Two clean options:
  - Per-test extra ticket: drop the body-`fixme` and have this specific test call `partnerFixture.createTicket()` once more before joining.
  - Variant beforeEach: extract a `seedTwoTickets` helper or use `test.describe.serial` to share state.
  
  Per-test extra ticket is simpler. **Mechanical, ~5 lines.**

These three are independent tasks. Each could be its own PR. They are *not* "partner-isolation pattern extension" — including them in the same migration PR would mix scope.

## Proposed slices

| Slice | Scope | Cost | Risk |
|---|---|---|---|
| A1 | `ai-features.spec.ts` ×2 — multi-context + fresh partner | small (2 tests, mechanical) | low |
| A2 | `support-flow.spec.ts` ×3 — multi-context + fresh partner; delete `closeKevinTickets` workaround | medium (3 tests, multi-dept transfer is fiddly) | low–medium |
| B | `agent-flow.spec.ts` ×2 — fresh partner + agent role + observe zustand-restoration behavior | medium (2 tests + investigative element) | medium — may surface a real app bug needing separate work |
| C1 | `collision-detection:192` poll-until-state refactor | small (1 test) | low |
| C2 | `view-modes:241` selector fix | small (1 test) | low — pure UI selector update |
| C3 | `view-modes:383` 2-ticket variant | small (1 test) | low |

**Recommended order:** A1 → A2 → B → C1/C2/C3 (any order).

A1 first — smallest, fastest to validate that the multi-context migration shape works. If it lands cleanly, A2 and B follow the same pattern.

Group C tests are independent of the migration pattern; they could be picked up at any point by anyone, including in parallel with A/B.

## Open questions

1. **Group B underlying bug** — does the zustand `supportOpenTickets`-on-fresh-page issue manifest in production with a real user, or is it purely a test-fixture artifact (because the test creates a session that didn't go through SupportView's mount + socket reconnect)? Answer affects whether B's "side effect" closure is acceptable.

2. **`partnerFixture` second-context auth** — current fixture has no helper for "log this OTHER context's page in as a fixture user." The plan above proposes calling `loginAsDemo(otherPage, fixtureUserId)` directly. If A1 reveals this is awkward (e.g., specs end up duplicating the auth boilerplate across tests), consider exposing `partnerFixture.loginPage(page, userId, opts?)` as a thin wrapper.

3. **OSS mirror impact** — the fixture infra is server-side test code; should it be stripped from the OSS public release like other internal-tooling? Check `scripts/strip-internal-tooling.ps1` (or wherever) before A1 ships.

## Out of scope

- New top-level `test.fixme(...)` discoveries. If A/B/C surface new flakes, they get their own escape-hatch markers + a follow-up entry in this plan, not in-place fixes.
- `agent-flow`'s zustand-restoration deep-dive (defer to a real follow-up issue if Group B confirms it's a prod bug).
- Any rewrite of how `loginAsDemo` seeds sessionStorage — the existing single-`page.evaluate` design is correct (see `helpers/auth.ts` header comment).
