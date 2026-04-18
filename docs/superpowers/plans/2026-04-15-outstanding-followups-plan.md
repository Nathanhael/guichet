# Outstanding Follow-Ups — Plan

**Date:** 2026-04-15
**Context:** Session that shipped the Tessera → Guichet rebrand + SSO locale sync + Rolldown build fix surfaced several things worth addressing separately. This plan sequences them by impact and lays out the work for each.

**Status as of 2026-04-18:**

| P | State | Evidence |
|---|---|---|
| P1 E2E fixture conflict | ✅ Shipped | `0fea728`, `549e014`, `4f9c86d`, `992dc01`, `37798a2` — two-round E2E restoration; fixture isolation in place |
| P2 push-and-idle coverage | ✅ Shipped | `c07eb90` — spec tightened; silent `test.skip` paths replaced with strict assertions, 6 tests pass in 7.4s |
| P3 npm audit sweep | ✅ Shipped | Resolved during v4.2.0 security cycle |
| P4 SSO locale residuals | ✅ Closed | Both open questions resolved in `docs/superpowers/specs/2026-04-15-sso-locale-sync-design.md` on 2026-04-18 |
| P5 ssoAttributeMap UI | ⏸️ Deferred | Customer-triggered; no partner has requested yet |
| P6 Ops tasks | ⏸️ Out of code scope | Deploy-time ops, not a code change |
| P7 Long-tail cleanup | ✅ Partial | P7c (merged branch prune) done 2026-04-18 — 19 branches deleted. P7a/P7b were already filed. |

Only P2 is a genuine open runtime gap. Rest is cosmetic / out-of-scope / customer-gated.

---

## Priority 1 — fix the E2E test fixture conflict (blocking CI health) — ✅ SHIPPED

### Problem

`testing/e2e/chat-enhancements.spec.ts` has 5 tests failing reliably. Root causes:

1. **Seed collision.** `seedOpenTicket()` logs in as `agent_julie` and tries to create a new ticket. Julie now has `ticket_dsc_julie` (pending) from the updated seed, so the server-side 1-ticket-per-agent guard rejects the `ticket:new` event silently.
2. **Queue layout shift.** Lucas's two assigned pending tickets (`ticket_dsc_julie` → support_lucas, `ticket_fot_kevin` → support_lucas) end up under the **"Other Agents"** collapsible section (because `supportOpenTickets` is empty on a fresh login — he hasn't actively joined them yet). The section is collapsed by default, so `openFirstTicket` finds no visible `li[data-ticket-row]`.

### Options

- **(A) Dedicated fixture user.** Add a test-only support user (e.g. `support_qa`) whose seed includes *no* pre-assigned tickets. E2E tests login as `support_qa`, see a clean queue, and `seedOpenTicket` inserts the test's own fixture. **~30 min.** Low risk. Keeps production-like data in Lucas/Sophie for visual QA + CI demos, isolates test data from dev fixtures.
- **(B) Expand "Other Agents" in the helper.** `openFirstTicket` clicks the `Other Agents` header before searching for `data-ticket-row`. **~10 min.** Addresses symptom, not cause — still fragile if seed adds more supportId-bearing tickets to Lucas.
- **(C) Scope the helper to the unassigned section.** Use `li[data-ticket-row][data-ticket-variant="queue"]` (requires adding a `data-ticket-variant` attribute to `QueueTicketRow` too). **~20 min.** Deterministic regardless of layout.

**Recommendation:** (A) + (C). Dedicated fixture user + explicit variant attribute on the row. A+C together make the test self-contained and robust.

### Steps

1. Add `support_qa` + `agent_qa` users to `server/seed.ts` PARTNER_USERS (no tickets).
2. Add `data-ticket-variant="queue|mine|other"` attribute on `QueueTicketRow`.
3. Update `chat-enhancements.spec.ts` helpers:
   - `loginAsDemo(page, 'support_qa')`
   - `seedOpenTicket()` logs in as `agent_qa` (who has no pre-seeded tickets)
   - `openFirstTicket` uses `li[data-ticket-row][data-ticket-variant="queue"]`
4. Run `npx playwright test chat-enhancements --reporter=line` — expect all 5 to pass.

---

## Priority 2 — `push-and-idle.spec.ts` coverage restoration — ✅ SHIPPED (`c07eb90`)

Currently skips rather than fails when the bell doesn't render. Root question: does the bell *actually* render for agents in E2E?

### Steps

1. Instrument the `beforeEach` with a `console.log(window.getComputedStyle(...))` probe to record whether the bell is hidden vs. missing from the DOM.
2. Based on findings:
   - **If the bell is missing because `user.role !== 'agent'`:** patch `loginAsDemo` to wait for `user.role` hydration (subscribe to Zustand, or add an explicit `await` on `trpc.auth.me`).
   - **If the bell is missing because `'serviceWorker' in navigator === false`:** add a Playwright browserContext option to enable SW support for this spec.
   - **If it's a `VAPID_PUBLIC_KEY` env issue:** document the env requirement and set it in `playwright.config.ts`.
3. Remove the `test.skip` branches once the real cause is fixed. Re-assert strict visibility.

**~1 hour,** mostly debugging.

---

## Priority 3 — `npm audit fix` sweep — ✅ SHIPPED (v4.2.0)

7 server vulnerabilities (5 moderate, 2 high) + 1 high-severity client flagged during `npm install` today.

### Steps

1. `docker compose exec server npm audit --json > audit-server.json`
2. `docker compose exec client npm audit --json > audit-client.json`
3. Review — group by "safe auto-fix" (`npm audit fix`) vs. "needs major-version bump" (`npm audit fix --force`).
4. Apply safe fixes, commit separately.
5. For each major bump, check changelog + run full CI before committing.
6. If any vulnerability is transitive in a dep you can't easily upgrade, add a note to `SECURITY.md` with the acceptable-risk rationale.

**~1-2 hours** depending on how many major bumps are involved.

---

## Priority 4 — SSO locale sync residual open questions

From `docs/superpowers/specs/2026-04-15-sso-locale-sync-design.md` — two items flagged as "decide later":

### 4a. Audit log verbosity
Current behavior: `user.locale.sso_sync` is logged **only when `users.lang` actually changes** (the `if (nextLang)` guard in `sso.ts`). Design spec's recommended policy.
**Action:** mark this decision as final in the design doc and close the open question. **~5 min.**

### 4b. Rate limiting on `setLocale`
Current behavior: none.
**Analysis:** manual UI click → no automated abuse vector → no rate limit needed. Confirm and close.
**Action:** update the design doc with "no rate limit — user-gated action" rationale. **~5 min.**

---

## Priority 5 — Admin UI for `ssoAttributeMap`

Schema + backend already ship. UI deferred pending first non-Entra tenant request.

### Trigger condition
A partner onboarding onto an IdP that uses a non-default claim name (Okta custom attr, custom SAML OID, etc.).

### Steps (when triggered)
1. Add `ssoAttributeMap` to the Platform → Partner Config tab as a JSON textarea.
2. Zod schema: `{ locale?: string, firstName?: string, lastName?: string }` — validate on submit.
3. Helper text listing supported keys + an example.
4. Mutation: extend `trpc.platform.partners.update` to accept the new field.
5. E2E: admin edits map, logs in via SSO with custom claim, locale syncs correctly.

**~2 hours** when needed. Defer until a real request.

---

## Priority 6 — Ops tasks for production deployment

These are not code — they run on your infrastructure when you deploy the rebrand + SSO locale sync.

### 6a. Postgres DB rename (if preserving data)

```sql
-- Run on each environment's Postgres. Requires zero active connections.
ALTER DATABASE tessera RENAME TO guichet;
```

Alternatively: `pg_dump` → new DB → import. Slower but non-blocking.

### 6b. Docker volume cleanup

On each host:
```bash
docker volume ls | grep tessera_   # identify orphans
docker volume rm <each>             # if data already migrated
```

### 6c. Active session invalidation

Cookie name changed from `tessera_token` to `guichet_token`. Expected behavior: all logged-in users must re-authenticate. No code action needed — browsers will discard the old cookie when the server stops setting it.

### 6d. GitHub repo rename (already done today)

`Nathanhael/tessera` → `Nathanhael/guichet` was renamed via GitHub UI. Any external links pointing at the old repo will auto-redirect for up to a year (GitHub default).

---

## Priority 7 — Long-tail cleanup

### 7a. Wiki pending for Drizzle refactor

Already filed as log-only today (`wiki commit 81220a4`). Done.

### 7b. "First SSO login overwrites manual locale" caveat

Already documented in `CHANGELOG.md` under `[Unreleased]` migration notes. Done.

### 7c. Local branch cleanup

```bash
git branch --merged main | grep -v '^\*\|main' | xargs -r git branch -d
```

Removes any feature branches already merged. Run manually when comfortable.

---

## Recommended sequencing

| Week | Priority | Why |
|---|---|---|
| This week | 1 | Restore CI health — flaky tests erode trust fast |
| This week | 3 | High-severity vulnerabilities should not linger |
| Next week | 2 | Restores real test coverage after we close the audit |
| When triggered | 5 | Customer-driven |
| Anytime | 4, 7 | 5-minute closes; do in odd moments |
| Deploy day | 6 | Ops checklist — run when shipping |

Total active work: **~4-6 hours** spread across a week. None blocking.
