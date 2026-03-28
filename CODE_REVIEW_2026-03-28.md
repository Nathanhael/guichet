# Tessera Full Codebase Review — 2026-03-28

5 parallel review agents examined: Security & Auth, Data Layer & Services, Socket & AI, Client & State, Infrastructure & Config. All issues scored >= 80 confidence (scale 0–100).

---

## CRITICAL (Confidence 90–95)

### 1. MFA brute-force: failed TOTP does not trigger account lockout
**File:** `server/routes/auth.ts` ~lines 282–295, 417–428
**Confidence:** 95

After a correct password, if the user submits a wrong TOTP code, the function returns 401 but **never calls `recordFailedLogin`**. An attacker with the correct password can brute-force the 6-digit TOTP (1M possibilities) without triggering the 5-attempt lockout. CLAUDE.md mandates "5-attempt lockout with 15-min window" — this is completely absent for MFA.

**Fix:** Call `recordFailedLogin(user.id)` on every failed TOTP verification and re-check lockout before the TOTP step.

---

### 2. Platform operator `ticket.list` returns ALL tenants' tickets — no partner_id filter
**File:** `server/trpc/routers/ticket.ts` ~lines 40–43, 114–117
**Confidence:** 95

When `ctx.user.isPlatformOperator` is true, no `partnerId` condition is added. The non-paginated path does a full table scan across all partners. A compromised platform operator token can bulk-exfiltrate every ticket. CLAUDE.md: "Every query must include partner_id filter."

**Fix:** Require a `partnerId` input parameter when `isPlatformOperator`, or gate via explicit `platformProcedure`.

---

### 3. `ticket:new` socket handler has no role check — any authenticated user can create tickets
**File:** `server/socket/handlers.ts` ~line 287
**Confidence:** 95

The handler checks identification but never validates the caller's role is `agent`. Any `support` or `admin` user can emit `ticket:new` and create tickets. Other mutation handlers (`ticket:close`, `support:join`) correctly gate on role.

**Fix:** Add `if (socket.data.role !== 'agent') return socket.emit('error', ...)`.

---

### 4. SSO callback hash payload written to Zustand store without any validation
**File:** `client/src/views/LoginView.tsx` ~lines 100–119
**Confidence:** 95

The SSO callback parses `window.location.hash`, JSON-parses it, and writes `payload.user` / `payload.memberships` directly into the store — no schema validation. An attacker who controls the URL hash can inject `isPlatformOperator: true`. The hash is client-controlled data.

**Fix:** Never trust the hash. After SSO, fetch `/api/v1/auth/me` and use only the server response. Or validate with Zod before storing.

---

### 5. Production health check uses wrong endpoint path
**File:** `docker-compose.prod.yml` ~line 46
**Confidence:** 95

Prod: `/api/health`. Dev/CI/k6: `/api/v1/health`. If the versioned path is correct, the prod health check always fails, causing dependent services to never start.

**Fix:** Align to `/api/v1/health`.

---

### 6. `canDelete` in MessageBubble uses imperative `useStore.getState()` — stale data
**File:** `client/src/components/MessageBubble.tsx` ~line 74
**Confidence:** 92

`useStore.getState().user?.role` reads state synchronously without subscribing. If the user's role changes (partner switch), `canDelete` silently uses stale data. The `user` value is already available from the subscribed `useStore()` call at line 19.

**Fix:** Replace with `user?.role !== 'agent'` from the existing destructured value.

---

### 7. GDPR purge deletes tickets that were never archived — data loss
**File:** `server/services/gdpr.ts` ~lines 96–101
**Confidence:** 92

`archiveTickets()` only archives `status = 'closed'` tickets. GDPR purge deletes ALL tickets older than cutoff regardless of status. Open/pending tickets older than retention are destroyed with no archive entry.

**Fix:** Archive all statuses before deletion, or only delete tickets that exist in `archived_tickets`.

---

### 8. `SupportJoinPayload` interface still declares `supportId` / `supportName` client fields
**File:** `server/socket/handlers.ts` ~lines 31–35
**Confidence:** 90

The handler correctly ignores them, but the typed interface accepts them. A future developer could easily destructure these client-supplied identity fields. CLAUDE.md: "never trust client-supplied identity fields."

**Fix:** Remove `supportId` and `supportName` from the interface.

---

### 9. Server dev container has no Dockerfile — `docker compose up` fails
**File:** `docker-compose.yml` ~line 20
**Confidence:** 90

`build: ./server` but only `Dockerfile.prod` exists. Docker expects `Dockerfile`. CLAUDE.md: "Docker is the only runtime."

**Fix:** Add `server/Dockerfile` for dev, or specify `dockerfile: Dockerfile.prod` in the build config.

---

## HIGH (Confidence 85–89)

### 10. WORM hash chain ordering is non-deterministic — chain verification breaks
**File:** `server/services/archive.ts` ~lines 54–57, 113–114
**Confidence:** 88

Write: orders by `desc(archivedAt)`. Verify: orders by `asc(archivedAt, createdAt)`. Multiple entries share the same `archivedAt` (same batch). Different ordering = recomputed hashes won't match stored values.

**Fix:** Add a monotonic sequence or use `id` as tiebreaker with consistent ordering in both paths.

---

### 11. Whisper messages included in AI summaries — internal notes exposed to customers
**File:** `server/services/ai/ticketMessages.ts` ~lines 40–58
**Confidence:** 88

`fetchTicketMessages` fetches all non-deleted messages without filtering `whisper = true`. Internal staff notes are included in summaries emitted via `ticket:summary:generated` to the entire room — including the end-user.

**Fix:** Add `eq(messagesTable.whisper, false)` to the where clause.

---

### 12. `credentials: 'include'` missing on forgot-password request
**File:** `client/src/views/LoginView.tsx` ~line 173
**Confidence:** 88

All other auth requests include it. CLAUDE.md mandates it on all requests.

**Fix:** Add `credentials: 'include'` to the fetch options.

---

### 13. Dev postgres volume mounts to wrong path — data doesn't persist
**File:** `docker-compose.yml` ~line 12
**Confidence:** 88

Dev: `/var/lib/postgresql` (wrong). Prod: `/var/lib/postgresql/data` (correct). PostgreSQL writes to `/data` subdirectory — the named volume contains only an empty parent.

**Fix:** Change to `/var/lib/postgresql/data`.

---

### 14. `TOTP` token reuse — no used-token store
**File:** `server/services/platformStepUp.ts` ~lines 91–105
**Confidence:** 88

A valid TOTP code can be submitted multiple times within its 90-second window. RFC 6238 requires accepted tokens be cached and rejected on reuse.

**Fix:** Store `userId:counter` in Redis with 90s TTL, reject if already seen.

---

### 15. `message.search` skips tenant isolation for platform operators
**File:** `server/trpc/routers/message.ts` ~lines 85–87
**Confidence:** 87

Platform operators have no `partnerId` in context, so the filter is skipped. A broad search returns messages from all tenants. Same pattern as issue #2.

**Fix:** Require explicit `partnerId` input for platform operators.

---

### 16. SQL injection pattern: raw `IN` clauses instead of Drizzle `inArray()`
**File:** `server/services/gdpr.ts` ~lines 51, 56; `server/trpc/routers/stats.ts` ~lines 205, 210, 479
**Confidence:** 85

Manual `$N` parameter indexing is fragile. If chained after other parameters, index numbering is wrong. The rest of the codebase uses Drizzle's `inArray()`.

**Fix:** Replace all raw-SQL `IN` clauses with `inArray()`.

---

### 17. `forgotPasswordThrottle` is in-process memory — bypassed in multi-instance deployments
**File:** `server/routes/auth.ts` ~lines 34–36
**Confidence:** 85

In-memory `Map` is per-process. With N server instances behind nginx, an attacker gets N × 3 attempts per window.

**Fix:** Replace with Redis counter using `INCR` + `EXPIRE`.

---

### 18. Rate limit increment-then-rollback allows momentary overshoot
**File:** `server/services/ai/rateLimit.ts` ~lines 54–62
**Confidence:** 85

Under concurrent load, the counter overshoots by 1 before decrement. Not atomic.

**Fix:** Use a Lua script for check-and-increment, or document the one-over behavior.

---

### 19. `stats.ts` partnerId asserted with `!` after null-allowing check
**File:** `server/trpc/routers/stats.ts` ~line 154
**Confidence:** 85

Platform operators pass the `isPlatformOperator` check but have `partnerId = null`. `partnerId!` is a TypeScript lie — all queries match nothing, returning empty stats silently.

**Fix:** Require `partnerId` as input for platform operators, or add a separate code path.

---

### 20. Socket `error` listener never cleaned up
**File:** `client/src/hooks/useSocket.ts` ~lines 82, 324–358
**Confidence:** 85

`s.on('error', ...)` is attached but `s.off('error')` is missing from the cleanup function.

**Fix:** Add `s.off('error')` to the cleanup block.

---

### 21. k6 load test silently passes when auth token is null
**File:** `testing/load/load.js` ~lines 36–39
**Confidence:** 85

When `data.token` is null, VU iterations exit early. No k6 metric is emitted, so `http_req_failed` stays at 0 and the test appears green.

**Fix:** Fail the k6 `setup()` if token is null: `throw new Error('Auth failed')`.

---

### 22. CI runs `npx`/`npm` directly on runner — CLAUDE.md violation
**File:** `.github/workflows/ci.yml` ~line 144
**Confidence:** 85

CLAUDE.md: "NEVER run `npm`, `node`, or `npx` directly on the host." CI jobs run `npx tsx`, `npm ci`, `npm run build` on the runner.

**Note:** Pragmatic for CI, but contradicts the documented mandate. Consider documenting this as an accepted exception.

---

## MODERATE (Confidence 80–84)

### 23. `PLATFORM_ADMIN_PASSWORD` minimum is 8 chars — policy requires 10
**File:** `server/config.ts` ~line 36
**Confidence:** 83

Bootstrap bypasses `validatePasswordStrength`. The most privileged account can have a weaker password than regular users.

---

### 24. `appFeedback` table has no `partnerId` column — no tenant isolation
**File:** `server/db/schema.ts` ~lines 160–168
**Confidence:** 83

Feedback from partner A could surface when the user switches to partner B.

---

### 25. `as any` casts for `editedAt`/`deletedAt` in socket handlers
**File:** `client/src/hooks/useSocket.ts` ~lines 182, 187
**Confidence:** 83

CLAUDE.md: "No `any` types." Fields missing from `Message` interface.

---

### 26. `mfa.disable` does not revoke existing sessions
**File:** `server/trpc/routers/mfa.ts` ~lines 119–153
**Confidence:** 82

Password changes revoke sessions. Disabling MFA (a security downgrade) does not.

---

### 27. `ticket.list` non-paginated path has no LIMIT
**File:** `server/trpc/routers/ticket.ts` ~lines 114–117
**Confidence:** 88 (grouped here as it compounds issue #2)

A partner with years of data returns unbounded rows. OOM risk.

---

### 28. `message:edit` has no max-length check
**File:** `server/socket/handlers.ts` ~line 668
**Confidence:** 82

Other handlers cap at 2000 chars. `message:edit` allows unbounded text.

---

### 29. `participants: any[]` on Ticket type
**File:** `client/src/types/index.ts` ~line 134
**Confidence:** 82

CLAUDE.md: "No `any` types."

---

### 30. Presence `identifyUser` TOCTOU race on connection count
**File:** `server/services/presence.ts` ~lines 83–100
**Confidence:** 82

Between `hSetNX` returning false and `hIncrBy`, the key TTL could expire, creating a malformed hash.

---

### 31. nginx config missing `X-Forwarded-For` / `X-Real-IP`
**File:** `testing/nginx.conf` ~lines 22, 32, 42
**Confidence:** 82

All requests appear to originate from the proxy IP. Per-IP rate limiting is ineffective.

---

### 32. `Dockerfile.prod` CMD path may be wrong
**File:** `server/Dockerfile.prod` ~line 28
**Confidence:** 82

`node dist/server/index.js` — the `server/` prefix depends on `rootDir` in tsconfig. Verify.

---

### 33. Optimistic message dedup matches on text content — fragile
**File:** `client/src/store/slices/messageSlice.ts` ~lines 42–48
**Confidence:** 81

Two identical messages in quick succession: server confirmation replaces the wrong pending message, leaving a ghost.

---

### 34. SSO callback raw Azure error exposed in redirect URL
**File:** `server/routes/sso.ts` ~line 114
**Confidence:** 80

Azure `error_description` can contain emails or internal tenant info. Map to generic error strings.

---

### 35. `monochromeMode` defaults to `true` — conflicts with server prefs
**File:** `client/src/store/slices/uiSlice.ts` ~lines 35, 108
**Confidence:** 80

New users get monochrome mode by default. `hydrateAccessibilityPrefs` fallback also defaults `true`, overriding server-stored `false`.

---

### 36. Prompt injection: `interpolate` only escapes `<user_content>` tags
**File:** `server/services/ai/prompts.ts` ~lines 114–122
**Confidence:** 80

User text containing other XML tags (`<system>`, `<instruction>`) is injected raw into prompts.

---

### 37. `borderRadius` in `ThemeConfig` contradicts brutalist mandate
**File:** `client/src/types/index.ts` ~lines 3–10
**Confidence:** 80

CLAUDE.md: "No border-radius." The field's existence invites violations.

---

### 38. `buildAuthResponse` drops `accessibilityPrefs` — field not in type
**File:** `server/services/authSession.ts` ~lines 67–101
**Confidence:** 80

SSO and local login pass `accessibilityPrefs` but the function type doesn't include it. Silently dropped — prefs lost on re-login.

---

### 39. Webhook `test` fires ALL partner webhooks, not just the target one
**File:** `server/trpc/routers/webhook.ts` ~lines 160–175
**Confidence:** 80

`fireWebhooks` dispatches to all active webhooks for the event, ignoring `input.id`.

---

### 40. `archiveTickets` not wrapped in a transaction — partial archive + GDPR purge = data loss
**File:** `server/services/archive.ts` ~lines 190–205
**Confidence:** 82

Crash mid-loop means some tickets archived, some not. GDPR purge deletes all, including unarchived.

---

### 41. `drizzle.config.ts` hardcoded fallback credentials
**File:** `server/drizzle.config.ts` ~line 8
**Confidence:** 80

Missing `DATABASE_URL` silently falls back to `postgres://user:password@localhost:5432/tessera` instead of failing fast.

---

### 42. Dev Redis exposed on host with no password
**File:** `docker-compose.yml` ~lines 64–73
**Confidence:** 80

Port 6379 published, no `--requirepass`. Any host process can read session tokens and presence data.

---

### 43. Playwright config has zero retries in CI
**File:** `playwright.config.ts` ~line 6
**Confidence:** 80

Any transient flake hard-fails the entire build. Standard: `retries: process.env.CI ? 2 : 0`.

---

## Summary

| Severity | Count | Top Concerns |
|----------|-------|-------------|
| **Critical** (90+) | 9 | MFA brute-force, tenant isolation (tickets + messages), SSO hash injection, GDPR data loss, prod health check |
| **High** (85–89) | 13 | WORM chain integrity, whisper leak in AI, TOTP reuse, raw SQL, in-memory rate limits |
| **Moderate** (80–84) | 21 | Missing `any` type fixes, session revocation gaps, schema gaps, infra misconfigs |
| **Total** | **43** | |

### Top 5 Priorities
1. **MFA brute-force bypass** — lockout absent for TOTP step
2. **Tenant isolation breaches** — `ticket.list` and `message.search` for platform operators
3. **SSO hash injection** — unvalidated client data written to auth store
4. **Whisper leak in AI summaries** — internal notes exposed to customers
5. **GDPR data loss** — unarchived tickets destroyed by purge
