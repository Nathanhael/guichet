# Guichet Full Code & Security Review — 2026-04-17

**Reviewer**: Claude Opus 4.7 (consolidation) with three parallel specialist agents
**Prior review**: [code-review-full.md](./code-review-full.md) (2026-04-09, +188 commits since)
**Companion reports** (full detail + evidence):
- [2026-04-17-security-review.md](./2026-04-17-security-review.md) — auth, SSO/B2B guest, tenancy, input validation
- [2026-04-17-code-quality-review.md](./2026-04-17-code-quality-review.md) — architecture, smells, tests, TypeScript rigor
- [2026-04-17-infra-review.md](./2026-04-17-infra-review.md) — migrations, config, Docker, deps, CI, observability

---

## Executive Summary

The codebase remains **fundamentally healthy**. Architecture is coherent, the B2B guest hardening shipped since the prior review is solid, SSRF defenses are layered, session revocation and refresh-token rotation are race-safe, and DOMPurify/markdown is correctly locked down. That said, the prior review's rating of "solid production-ready code with minor hardening opportunities" no longer fully holds — this pass surfaced **six HIGH-severity findings**, three of which are deployment/operability defects that would bite a real production deploy, and three of which are security or data-integrity regressions introduced by recent features.

**Severity tally across all three reports** (excluding strengths and info-level):

| Severity | Count | Categories |
|----------|-------|-----------|
| **HIGH** | 6 | auth bypass, deploy migration gap, CI/prod drift, horizontal-scale rate limit, storage orphans, archive atomicity |
| **MEDIUM** | 9 | stranded invites, link-preview amplification, stale flags, dead casts, secrets in env, no tests, etc. |
| **LOW** | 5 | log flood, TODO rot, `@ts-ignore`, key length, TOCTOU |
| **INFO** | 2 | SSO linking TOCTOU, reclaim audit |

**Zero CRITICAL findings.** No evidence of vulnerabilities that could be exploited by an unauthenticated attacker without operator error.

---

## Top-priority items — fix before next production deploy

These six HIGH findings are ordered by blast radius. Each has been spot-verified against current code.

### 1. Dev-login endpoint mounted unconditionally (auth bypass)
**File**: [server/routes/auth/index.ts:14](../../../server/routes/auth/index.ts), [server/routes/auth/devLogin.ts:32](../../../server/routes/auth/devLogin.ts)
The `/api/v1/auth/dev-login` route is registered on the Express router at every environment. The only production gate is a runtime check **inside the handler** for `config.NODE_ENV === 'production'`. Any environment where `NODE_ENV` is missing, misspelled, or set to anything else (`staging`, `test`, `demo`) exposes a no-auth login-as-any-user endpoint that mints a JWT + refresh cookie and bypasses MFA, lockout, and password verification. **Move the `registerDevLoginRoutes(router)` call behind an `if (config.NODE_ENV !== 'production')` guard so the route literal doesn't exist in prod.** Verified at `auth/index.ts:14` — currently unconditional.

### 2. Drizzle migration journal is 7 migrations stale
**File**: [server/drizzle/meta/_journal.json](../../../server/drizzle/meta/_journal.json)
The journal lists only idx 0–2. There are 10 migration SQL files (0000–0009 plus a duplicate 0006). A fresh deploy running the documented `npm run db:migrate` command will stop at 0002 and skip: FTS vector, SLA removal, **`users.is_external` (required by B2B guest)**, `messages.sender_is_external`, ratings-outlive-tickets FK rework, and the full auth_method add/drop lineage. The CI script at [scripts/ci.ps1:47](../../../scripts/ci.ps1) uses `drizzle-kit push --force` which bypasses the journal entirely — that's what masked this drift. **Rebuild the journal to include all 10 migrations, renumber the duplicate 0006, and flip CI to `drizzle-kit migrate` so future drift fails CI.**

### 3. CI uses `drizzle-kit push --force` — doesn't exercise the production migration path
**File**: [scripts/ci.ps1:47](../../../scripts/ci.ps1)
Same root cause as finding 2. `push` is a dev-only schema sync. Production runs `migrate`. Every passing CI run has lied about migration correctness for some months. Fix with finding 2.

### 4. Global HTTP rate limiters are in-memory — not horizontal-scale safe
**File**: [server/app.ts:135–158](../../../server/app.ts)
`authLimiter` (5 req/min), `trpcLimiter` (200 req/min), `uploadLimiter`, and `globalLimiter` all use `express-rate-limit`'s default in-memory store. AWS and Azure deployment guides both recommend multi-instance setups. With N instances, an attacker gets N× the allowed attempts. DB-level account lockout backstops login brute-force (5 attempts, 15-min lockout), but upload/trpc endpoints have no such backstop. **Wire at least `authLimiter` to `rate-limit-redis` using the existing Redis client.**

### 5. Message soft-delete orphans attachment blobs
**File**: [server/services/messageQueries.ts:223–229](../../../server/services/messageQueries.ts)
`softDeleteMessage()` nulls `mediaUrl` without calling `storage.delete()`. Blobs uploaded to S3 / Azure Blob Storage accumulate permanently after deletion and only get cleaned up during the scheduled GDPR purge at the 30-day retention cliff — and only for messages that were soft-deleted from the *original* mediaUrl path before purge. Users and staff deleting messages during normal use expect the binary to be gone; it isn't. **Add a fire-and-forget `storage.delete(filename)` call before the DB update nulls the URL.** Verified at line 227.

### 6. `snapshotTicketToArchive` message count is non-atomic
**File**: [server/services/archive.ts:187–211](../../../server/services/archive.ts)
Three sequential DB operations (select ticket, count messages, insert archive row) with no surrounding transaction. A message landing between the count and the insert (or a concurrent reopen/close race) produces incorrect `messageCount` in the archive. The batch `archiveTickets()` function *does* use a transaction — the on-close snapshot path regressed. **Wrap the three ops in `db.transaction()`.** Verified at lines 188–211.

---

## MEDIUM findings — plan to address this quarter

| # | Area | File | Summary |
|---|------|------|---------|
| M1 | Security | [server/trpc/routers/linkPreview.ts:26](../../../server/trpc/routers/linkPreview.ts) | `fetchForCompose` has no per-user rate limit → server-side request amplification (2s outbound per call, 200/min/IP shared) |
| M2 | Security | [server/trpc/routers/partner/members.ts:149](../../../server/trpc/routers/partner/members.ts) | `inviteExternalUser` creates DB row with no password/externalId and no mail — stranded orphan user if B2B invite never sent; claim-by-email risk |
| M3 | Code quality | [client/src/components/admin/AdminArchive.tsx:28](../../../client/src/components/admin/AdminArchive.tsx) | `as { items?: ... }` cast is dead code (listMembers returns flat array) — bypasses tRPC inference |
| M4 | Code quality | [server/services/statsQueries.ts](../../../server/services/statsQueries.ts) | 8 `as unknown as` casts on raw SQL results — column rename silently corrupts dashboard data |
| M5 | Code quality | server/services/ticketReclaim.ts | Zero test coverage on new crash-recovery service |
| M6 | Code quality | [server/services/storage.ts:181](../../../server/services/storage.ts) | S3 `CreateBucketCommand` error is swallowed by `.catch(() => {})` — misleads startup log |
| M7 | UX | [client/src/hooks/useKeyboardShortcuts.ts:195](../../../client/src/hooks/useKeyboardShortcuts.ts) | Global Escape handler fires through open modals (no `defaultPrevented` check) |
| M8 | Infra | [monitoring/prometheus.yml](../../../monitoring/prometheus.yml) + [server/app.ts:360](../../../server/app.ts) | Prometheus can't scrape `/metrics` from Docker bridge — `METRICS_TOKEN` required but not configured in either side. Observability silently broken. |
| M9 | Infra | [docker-compose.prod.yml:52](../../../docker-compose.prod.yml) | `FIELD_ENCRYPTION_SECRET` not wired to prod compose; `AI_KEY_ENCRYPTION_SECRET` uses `:-` silent default |
| M10 | Infra | [server/services/mail.ts](../../../server/services/mail.ts), [platform/system.ts](../../../server/trpc/routers/platform/system.ts) | SMTP creds stored as plaintext in `system_settings.value` JSONB; inconsistent with AI key encryption |
| M11 | Infra | [.env.example:115–116](../../../.env.example) | Real-looking VAPID private key committed in `.env.example` (commented, but should be placeholder) |

*(11 medium items — matches 9 original + 2 split. M5 was counted once.)*

---

## LOW findings — sweep when convenient

| # | File | Summary |
|---|------|---------|
| L1 | [client/src/hooks/useIsExternalAdmin.ts:14](../../../client/src/hooks/useIsExternalAdmin.ts) | `isExternal` flag sourced from Zustand — stale on server-side privilege change until re-login |
| L2 | [server/services/linkPreview.ts:27](../../../server/services/linkPreview.ts) | Redis cache key uses unbounded URL length |
| L3 | [server/services/mail.ts:1](../../../server/services/mail.ts) | `@ts-ignore` on nodemailer — `@types/nodemailer` is available |
| L4 | [client/src/views/LoginView.tsx:250](../../../client/src/views/LoginView.tsx) | Stale TODO comment — SSO endpoint is in production |
| L5 | [server/drizzle/0006_*.sql](../../../server/drizzle/) | Two migrations share `0006_` prefix — must resolve before fixing journal |
| L6 | [server/app.ts:163](../../../server/app.ts) | Every HTTP request logged at INFO — log flood duplicates Prometheus data |

---

## INFO / notes

- SSO email-to-externalId linking in [server/routes/sso.ts:251–275](../../../server/routes/sso.ts) has a narrow TOCTOU window between SELECT and UPDATE. Exploitation requires controlling both an SSO identity and a password-reset token in the same instant — practically impossible. Flagging for awareness only.
- `server/services/ticketReclaim.ts` reclaim logic reviewed for client-trust and race issues: **clean**. Runs on a server-side timer, uses atomic `UPDATE ... WHERE supportId = $expected` guard. (But still lacks unit tests — see M5.)

---

## Strengths observed (consolidated)

From the three specialist reviews:

- **Azure B2B guest feature is well-built.** `destructiveAdminProcedure` is applied to every destructive admin mutation (webhook CRUD + secret rotate/test, member add/update/remove/invite, department update). Source-level assertion tests exist. Guest detection matches Microsoft's `acct === 1 || !!claims.idp` signals. Multi-partner rejection fails closed with audit log. Nonce + Redis state tokens are correct CSRF protection.
- **SSRF defenses are layered.** `linkPreview.ts` and `webhookDispatch.ts` both use DNS pre-resolution checking all A/AAAA records, IPv6-mapped IPv4 normalization, and `redirect: 'error'`.
- **Session revocation fails closed.** `isRevoked()` returns `true` on Redis errors.
- **Refresh token rotation is race-safe.** Atomic `UPDATE ... RETURNING` prevents concurrent rotation; family revocation on replay.
- **Socket identity is fully server-side.** All handlers use `socket.data.userId`.
- **DOMPurify config is narrow.** `markdown.ts` allowlist + `afterSanitizeAttributes` hook forces `rel="noopener noreferrer"` on anchors.
- **Storage abstraction is clean.** `StorageBackend` interface with three compliant implementations; lazy-init with promise lock.
- **Tiptap race handling is correct.** `isProgrammaticUpdateRef` + try-catch on `view.dispatch` + `queueMicrotask` reset.
- **Rebrand is complete.** Zero stale "tessera" strings in source.
- **Prod hardening config is thorough.** 10 FATAL/WARN checks in `config.ts`.
- **Multi-stage Dockerfiles** are correct: non-root user, `npm ci --omit=dev`, Alpine upgrade on each build.
- **Backup, key rotation, baseline scripts** are genuinely usable in an incident.
- **Break-glass runbook** is a real procedure, not a placeholder.
- **Deployment docs** (AWS, Azure) are current, including Redis TLS, sticky-session, and IAM policy notes.
- **Bare `useStore()` anti-pattern** is enforced via a test in `client/src/__tests__/useStoreSelectors.test.ts`.
- **Secrets never logged.** Email masking is consistent; API keys decrypted in-memory only.

---

## Suggested action order

1. **This sprint (HIGH)**: Fix findings 1, 5, 6 (pure code changes, reviewable in one PR each). Plan findings 2, 3, 4 together (all migration/CI/rate-limit infra, co-located work).
2. **Next sprint (MEDIUM)**: Address M1 (link preview rate limit), M2 (invited user stranding), M8 (broken Prometheus scraping), and M11 (VAPID placeholder). M4 (statsQueries validation) is worth a focused session with snapshot tests since it's analytics-critical.
3. **Backlog (LOW + polish)**: L1–L6 sweep in a single "quality" PR. Ask for the nodemailer types and stale TODO alongside.

---

## Areas not covered / time-boxed (across all three reports)

- `server/trpc/routers/platform/` beyond `users.ts` — spot-checked
- `server/services/gdpr.ts` + `archive.ts` WORM hash chain integrity — not re-verified (prior review validated)
- `client/src/components/chat/ComposeArea.tsx`, `MessageContent.tsx` — only markdown + LinkPreviewCard fully read
- `server/services/ai/` SSRF (`validateUrl.ts`) — not re-reviewed (prior review validated DNS rebinding fix)
- Tiptap production bundle size impact — no build output available
- E2E Playwright specs for new features — suite not executed
- Individual Grafana dashboard panel queries
- `npm audit` live output — not executed (drizzle-kit esbuild-kit advisory already accepted per commit 6a7859c)

---

**Prepared**: 2026-04-17 by consolidating three parallel specialist reviews. All HIGH findings spot-verified against current source. Companion reports contain full evidence, code snippets, and recommended fixes.
