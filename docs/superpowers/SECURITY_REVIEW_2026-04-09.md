# Guichet Security Review — 2026-04-09

Comprehensive code and security review across 5 domains: auth/sessions, input validation/injection, multi-tenancy/authorization, socket/real-time, and database/config/infrastructure.

---

## Critical Findings

### CRIT-1: SSRF via HTTP Redirect in Link Preview

**File**: `server/services/linkPreview.ts:198`
**Severity**: Critical | **Confidence**: 85

`fetchOgData` uses `redirect: 'follow'`, but `isSafeUrl` only validates the *original* URL's resolved IPs. A 301 redirect to `http://169.254.169.254/latest/meta-data/` bypasses all SSRF checks. By contrast, `webhookDispatch.ts` correctly uses `redirect: 'error'`.

**Exploitation**: Attacker sends a message with a URL that 301-redirects to an internal metadata endpoint. Server follows the redirect, fetches internal content, caches it in Redis, and returns it.

**Fix**: Change line 198 to `redirect: 'error'`.

---

### CRIT-2: IPv6 DNS Rebinding Bypass in AI URL Validation

**File**: `server/services/ai/validateUrl.ts:69-80`
**Severity**: Critical | **Confidence**: 85

`validateResolvedAiUrl` only calls `resolve4()` — never `resolve6()`. A domain with only a AAAA record pointing to `::1` passes all checks. Additionally, `validateAiBaseUrl` catches `::1` but not `[::1]` (bracket notation accepted by `new URL()`). The `isPrivateIp` helper only handles IPv4.

**Exploitation**: Malicious partner configures an AI base URL whose DNS returns only `::1` via AAAA. Server connects to localhost, potentially reaching internal services.

**Fix**: Add `resolve6()` check, extend `isPrivateIp` with IPv6 ranges, reject `[::1]` in static check. See `linkPreview.ts:isSafeUrl` for correct dual-stack implementation.

---

### CRIT-3: SSO Callback Never Issues Refresh Token

**File**: `server/routes/sso.ts:477`
**Severity**: Critical (functional) | **Confidence**: 90

The SSO callback sets the access token cookie but never calls `createRefreshToken` + `setRefreshCookie`. SSO users get logged out every 15 minutes (access token expiry) because `useTokenRefresh` hits `/refresh` with no `guichet_refresh` cookie.

**Fix**: Add refresh token issuance after `setAuthCookie`, mirroring the local login flow.

---

### CRIT-4: No SSL Enforcement on Database Connections

**File**: `server/db/postgres.ts:17-23`
**Severity**: Critical | **Confidence**: 95

The `Pool` constructor has no `ssl` option. All queries (password hashes, MFA secrets, PII) travel unencrypted. No production hardening check exists for database SSL.

**Fix**: Add `ssl` config option and a production check in `config.ts`.

---

## High Findings

### HIGH-1: `og:image` URL Not Validated Before Client Rendering

**File**: `server/services/linkPreview.ts:143-171`
**Severity**: High | **Confidence**: 82

`og:image` URLs from external pages are cached in Redis and rendered as `<img src>` in staff browsers without server-side validation. A malicious page serving `<meta property="og:image" content="http://192.168.1.1/admin/screenshot.png">` causes staff browsers to make requests to internal hosts.

**Fix**: Strip non-HTTPS image URLs before caching, or validate against private IP ranges.

---

### HIGH-2: `ticket:left` Missing Partner Scope Check (Cross-Tenant Info Leak)

**File**: `server/socket/handlers/collision.ts:132-139`
**Severity**: High | **Confidence**: 88

`ticket:viewing` calls `requirePartnerScope`; `ticket:left` does not. An authenticated user from Partner A can trigger `broadcastViewers` for a ticket in Partner B, leaking viewer presence information cross-tenant.

**Fix**: Add `requirePartnerScope` before `removeViewer`/`broadcastViewers`.

---

### HIGH-3: Push Unsubscribe Does Not Verify Ownership

**File**: `server/services/pushNotification.ts:49-55`
**Severity**: High | **Confidence**: 85

`unsubscribe` deletes by `endpoint` only — `userId` is not included in the WHERE clause. Any authenticated user who knows another user's push endpoint can silently disable their notifications.

**Fix**: Add `eq(pushSubscriptions.userId, userId)` to the WHERE clause.

---

### HIGH-4: `rawSearch` ILIKE Operand Inversion

**File**: `server/trpc/routers/partner/members.ts:49`
**Severity**: High | **Confidence**: 90

User's raw search string is the LHS of an ILIKE expression: `rawSearch ILIKE CONCAT(role, 's')`. This inverts the intended logic — searching `%` matches every role, leaking all member data regardless of the search intent.

**Fix**: Swap operands: `role::text ILIKE CONCAT(rawSearch, 's')`.

---

### HIGH-5: Webhook Secrets Stored in Plaintext

**File**: `server/db/schema.ts:378`
**Severity**: High | **Confidence**: 83

HMAC signing secrets are plaintext in the database. The codebase already has `encryption.ts` for field-level encryption (used for AI API keys). Webhook secrets should use the same pattern.

**Fix**: Encrypt using existing `encrypt`/`decrypt` from `encryption.ts`.

---

### HIGH-6: Hardcoded All-Zeros Encryption Key in Dev Compose

**File**: `docker-compose.yml:38`
**Severity**: High | **Confidence**: 87

`AI_KEY_ENCRYPTION_SECRET=0000...0000` is committed to source control. Dev data encrypted with this key is trivially reversible. Risk of accidental use with production DB.

**Fix**: Move to `.env` file (gitignored), add `.env.example` with placeholder.

---

## Medium Findings

### MED-1: TOTP `markTotpTokenUsed` Silently Swallows Errors

**File**: `server/services/platformStepUp.ts:136-146`
**Severity**: Medium | **Confidence**: 80

If Redis write fails between `isTotpTokenUsed` (read) and `markTotpTokenUsed` (write), the TOTP code is consumed but never marked — enabling replay within the 90s window. The catch block suppresses all errors with no logging.

**Fix**: Log at `warn` level so monitoring can detect Redis write failures.

---

### MED-2: DEMO_MODE Lockout Bypass for Non-Operator Users

**File**: `server/routes/auth/login.ts:178-181`
**Severity**: Medium | **Confidence**: 82

In DEMO_MODE, non-operator users authenticate via `/login` but `recordFailedLogin` skips lockout for non-operators. Only IP-level rate limiting (20/15min) applies — no account-level lockout.

**Fix**: Extend lockout to all users in DEMO_MODE, or document as accepted risk.

---

### MED-3: GDPR Purge Does Not Cover `push_subscriptions`

**File**: `server/services/gdpr.ts:138-176`
**Severity**: Medium | **Confidence**: 92

Push subscriptions contain device-specific PII (`endpoint`, `keys`) but are never purged by the GDPR process. Data residue persists indefinitely.

**Fix**: Add purge step for stale push subscriptions in `runDailyPurge`.

---

### MED-4: `adminProcedure` Used Instead of `partnerAdminProcedure` in Rating Router

**File**: `server/trpc/routers/rating.ts:68, 122`
**Severity**: Medium | **Confidence**: 85

`getStaffRatings` and `getAnalytics` use `adminProcedure` with manual `partnerId` null checks instead of `partnerAdminProcedure` which guarantees non-null `partnerId` by type. Fragile pattern that could leak if guards are removed.

**Fix**: Switch to `partnerAdminProcedure`.

---

### MED-5: In-Memory Rate Limit Fallback Per-Process in Multi-Replica

**File**: `server/routes/auth/rateLimit.ts:20-43`
**Severity**: Medium | **Confidence**: 85

When Redis is down, in-memory rate limiting is per-process. In a 3-replica deployment, attackers get 3x the brute-force window (60 attempts/15min instead of 20).

**Fix**: Document limitation, or return `503` when Redis is unavailable for auth endpoints.

---

### MED-6: DB Pool Size Params Not Validated (NaN Risk)

**File**: `server/db/postgres.ts:19-20`
**Severity**: Medium | **Confidence**: 88

`DB_POOL_MAX`/`DB_POOL_MIN` use `parseInt` without NaN guard and aren't in the Zod config schema. Invalid values could create unbounded connection pools.

**Fix**: Add to Zod schema with `z.coerce.number().int().positive()`.

---

### MED-7: Dev Redis Port Bound to All Interfaces

**File**: `docker-compose.yml:72`
**Severity**: Medium | **Confidence**: 81

Redis binds `0.0.0.0:6379` while Postgres correctly binds `127.0.0.1:5432`.

**Fix**: Change to `127.0.0.1:6379:6379`.

---

### MED-8: Archive Chain Verify Error Indistinguishable from Tamper

**File**: `server/services/archive.ts:174-177`
**Severity**: Medium | **Confidence**: 82

DB errors during `verifyAuditChain` return `{ valid: false, checked: 0 }`. The caller in `gdpr.ts` logs "AUDIT CHAIN INTEGRITY VIOLATION" for transient DB errors, making it impossible to distinguish from real tampering.

**Fix**: Return a distinct error type when `checked === 0`.

---

### MED-9: Missing `NOT NULL` Constraints on Several FK Columns

**Files**: `server/db/schema.ts` — `ratings.partnerId:171`, `kbArticles.slug:361`, `aiPromptTemplates.partnerId:408`, `agentStatusLog.status:488`
**Severity**: Medium | **Confidence**: 80

Multiple columns that should be non-nullable are nullable, defeating unique indexes (slug) or allowing orphaned records invisible to partner-scoped queries.

---

### MED-10: No Global Express Error Handler

**File**: `server/app.ts`
**Severity**: Medium | **Confidence**: 82

No `(err, req, res, next)` handler is registered. Express REST routes that throw unhandled async errors may leak stack traces in production.

**Fix**: Add a global error handler returning `500: Internal server error`.

---

## Low Findings

| ID | File | Issue |
|----|------|-------|
| LOW-1 | `server/services/platformStepUp.ts:126` | Recovery code path has no Redis-backed replay guard (DB deletion is the only guard) |
| LOW-2 | `server/socket/handlers/collision.ts:132` | `ticket:left` missing `isSupport` role check (asymmetric with `ticket:viewing`) |
| LOW-3 | `server/socket/handlers/types.ts:36-40` | `supportLeaveSchema` accepts `supportId`/`supportName` from client (ignored but confusing) |
| LOW-4 | `server/config.ts:17` | JWT_SECRET entropy not validated (64 chars of zeros passes) |
| LOW-5 | `server/Dockerfile.prod:4,13,19` | Unpinned `npm@latest` in all build stages |
| LOW-6 | `server/app.ts:63` | No-origin requests bypass CORS entirely (by design, but undocumented risk) |
| LOW-7 | `server/db/schema.ts:45` | `users.email` nullable — multiple null-email users permitted |

---

## Areas That Passed Review (No Issues)

- **SQL injection**: All Drizzle `sql` tagged templates use parameterized bindings correctly. `toTsQuery` strips non-alphanumeric chars. `escapeLikePattern` used correctly.
- **XSS prevention**: DOMPurify with explicit allowlist in `markdown.ts`. `rel="noopener noreferrer"` enforced via hook.
- **Multi-tenancy isolation**: All 19 tRPC routers filter by `partnerId`. No cross-tenant data leakage paths confirmed.
- **Socket identity**: `socket.data.userId` always server-set. `requireIdentified()` on all handlers. `requirePartnerScope` on mutation events.
- **File uploads**: MIME validation via magic bytes, UUID rename, rate limited, size capped. No path traversal.
- **Webhook dispatch**: DNS pinning, `redirect: 'error'`, HMAC-SHA256, 10s timeout.
- **Encryption**: AES-256-GCM with random 96-bit IVs, auth tag verification. Correct implementation.
- **Refresh token rotation**: Family-based reuse detection, atomic revocation, crash-safety documented.
- **Client logout**: Clears sessionStorage, SW caches, nulls auth state. No sensitive data leaks.
- **Password hashing**: Argon2id throughout. No bcrypt. Common password blocking, history check.

---

## Priority Action Items

### Immediate (deploy blockers)
1. Fix link preview SSRF redirect-follow (CRIT-1) — one-line fix
2. Add IPv6 DNS resolution to AI URL validation (CRIT-2)
3. Issue refresh tokens in SSO callback (CRIT-3)

### Short-term (next sprint)
4. Add DB SSL enforcement (CRIT-4)
5. Fix `ticket:left` partner scope check (HIGH-2)
6. Fix push unsubscribe ownership (HIGH-3)
7. Fix ILIKE operand inversion in members search (HIGH-4)
8. Encrypt webhook secrets at rest (HIGH-5)
9. Move dev encryption key to .env (HIGH-6)
10. Validate og:image URLs server-side (HIGH-1)

### Medium-term (backlog)
11. Add GDPR purge for push_subscriptions (MED-3)
12. Switch rating router to partnerAdminProcedure (MED-4)
13. Add global Express error handler (MED-10)
14. Fix DB pool NaN risk (MED-6)
15. Add NOT NULL constraints (MED-9)
16. Log TOTP mark-used failures (MED-1)
17. Bind dev Redis to localhost (MED-7)
