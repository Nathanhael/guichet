# Critical Security Fixes — Phase 1

**Date:** 2026-03-28
**Branch:** `fix/critical-security`
**Scope:** 8 critical findings from codebase review

## Strategy

Fix + test together. Each fix gets a test proving the vulnerability is closed. Single branch, one PR.

## Fixes

### 1. SSRF via AI `baseUrl`

**File:** `server/services/ai/factory.ts`
**Problem:** `aiConfig.baseUrl` from partners table passed directly to `fetch()` with no validation.
**Fix:** Add `validateBaseUrl()` function that:
- Parses URL, rejects non-`https://` schemes (allow `http://` only when `NODE_ENV=development`)
- Resolves hostname, rejects RFC-1918 ranges (10.x, 172.16-31.x, 192.168.x), loopback (127.x, ::1), link-local (169.254.x), and metadata endpoints
- Call before `buildProvider()` construction
**Test:** Unit test with private IP URLs, metadata URLs, valid URLs.

### 2. GDPR purge guard blocks permanently after day 1

**File:** `server/services/gdpr.ts`
**Problem:** Guard checks `ticketsArchived === 0` which is also true when tickets were already archived in a previous run.
**Fix:** Replace the guard query to check for unarchived closed tickets:
```sql
SELECT COUNT(*) FROM tickets t
WHERE t.created_at < $1 AND t.status = 'closed'
AND NOT EXISTS (SELECT 1 FROM archived_tickets a WHERE a.id = t.id)
```
Only skip purge if this count is 0 (meaning there are genuinely no tickets to process).
**Test:** Test that purge proceeds on day 2 when tickets were archived on day 1.

### 3. `sql.raw()` in lockout query

**File:** `server/services/accountLockout.ts`
**Problem:** `sql.raw(String(LOCKOUT_MINUTES))` in interval expression.
**Fix:** Replace with parameterized interval:
```sql
(NOW() + (${LOCKOUT_MINUTES} * INTERVAL '1 minute'))::text
```
**Test:** Verify lockout expiry is correctly calculated (existing tests should cover; add one if not).

### 4. Duplicate ratings race condition

**Files:** `server/db/schema.ts`, `server/socket/handlers.ts`
**Problem:** Check-then-insert without unique constraint allows concurrent duplicate inserts.
**Fix:**
- Add unique index on `ratings.ticket_id` in schema
- Generate migration
- Change handler to use `INSERT ... ON CONFLICT (ticket_id) DO NOTHING` and check affected rows
**Test:** Verify second insert for same ticket is silently ignored.

### 5. Internal error messages leaked to callers

**Files:** `server/trpc/routers/feedback.ts`, `server/trpc/routers/rating.ts`
**Problem:** `errMsg(err)` forwards raw error messages including DB internals to client.
**Fix:** For `INTERNAL_SERVER_ERROR` codes, log full error server-side, return generic `'An unexpected error occurred'` to client. Keep specific messages for `BAD_REQUEST`/`NOT_FOUND`/`FORBIDDEN` codes.
**Test:** Trigger a constraint violation and verify client receives generic message.

### 6. Unbounded `user.list` query

**File:** `server/trpc/routers/user.ts`
**Problem:** No LIMIT on platform user list. Dumps entire users table.
**Fix:** Add `limit` and `offset` input params (default limit 100, max 500). Add `LIMIT $1 OFFSET $2` to query. Return `{ users, total }` for pagination UI.
**Test:** Verify limit is enforced.

### 7. Demo credentials in production bundle

**File:** `client/src/views/LoginView.tsx`
**Problem:** `DEMO_PASSWORD` and `HARDCODED_DEMO_USERS` array baked into production JS bundle.
**Fix:**
- Move demo user list behind a tRPC query (`user.demoList` already exists) — only return data when `DEMO_MODE=true`
- Remove hardcoded password and user list from client code
- Client fetches demo users from server only when demo mode is active (check via existing config endpoint or new `config.isDemoMode` field)
- Demo login sends email to server, server handles the password internally when `DEMO_MODE=true`
**Test:** Verify demo data not present in production build output.

### 8. Raw TOTP token in Redis key

**File:** `server/services/platformStepUp.ts`
**Problem:** Redis key `totp:used:{userId}:{token}` embeds plaintext 6-digit code.
**Fix:** Hash token before key construction:
```ts
const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
const key = `totp:used:${userId}:${hashedToken}`;
```
Apply to both `markTokenUsed` and `isTokenUsed` functions.
**Test:** Verify replay detection still works with hashed keys.

## Execution Order

1. #3 (sql.raw) — smallest, isolated, builds confidence
2. #8 (TOTP key) — small, isolated
3. #5 (error leak) — small, two files
4. #4 (ratings race) — schema change + handler
5. #6 (user.list) — query change + pagination
6. #1 (SSRF) — new validation function
7. #2 (GDPR guard) — logic rewrite
8. #7 (demo creds) — touches client + server, most complex

## Out of Scope

- Phase 2 fixes (10 high-impact items)
- Phase 3 fixes (remaining mediums + nitpicks)
- Architectural changes (JWT refresh tokens, etc.)
