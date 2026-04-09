# Auth/Security Layer Code Review — 2026-04-08

Scope: Refresh token rotation, session revocation, account lockout, JWT middleware, MFA, SSO, encryption.

## Critical (Confidence ≥ 90)

### 1. Refresh token race condition — concurrent tabs trigger spurious family revocation
**Files:** `server/services/refreshToken.ts:32-54`, `server/routes/auth.ts:666`

`rotateRefreshToken` reads token state outside a transaction, then conditionally updates inside one. Two tabs calling `POST /refresh` simultaneously can both pass the `isNull(revokedAt)` check; the second finds the token revoked, triggers reuse detection, and revokes the entire family — logging the user out everywhere.

**Fix:** Replace the read-then-update with a single atomic `UPDATE ... WHERE tokenHash = $1 AND revokedAt IS NULL RETURNING *`. Eliminates the race and the separate reuse-detection query.

---

### 2. MFA secrets stored in plaintext
**Files:** `server/trpc/routers/mfa.ts:69`, `server/db/schema.ts:60`, `server/trpc/routers/platformSecurity.ts`

Both `mfaSecret` and `platformTotpSecret` are plain `text` columns. The codebase already has an AES-256-GCM `encrypt()`/`decrypt()` service in `encryption.ts` — it's just never applied here. A database compromise yields raw TOTP secrets, defeating MFA entirely.

**Fix:** `encrypt(secret)` before writing, `decrypt(user.mfaSecret)` before TOTP verification. Apply to both columns.

---

### 3. Admin-forced MFA disable doesn't revoke target user's sessions
**File:** `server/trpc/routers/platform.ts:869-898`

`disableUserMfa` clears MFA fields but never calls `revokeUserSessions(targetUserId)`. The self-service `mfa.disable` path does. An attacker with a stolen session remains active after an admin force-disables their MFA.

**Fix:** Add `await revokeUserSessions(targetUserId)` after the DB update.

---

### 4. Login timing attack — user enumeration via Argon2 timing
**Files:** `server/routes/auth.ts:341-346`, `server/routes/auth.ts:479-484`

"User not found" returns 401 immediately (~1ms). Wrong password returns after Argon2 (~200ms). Timing difference reveals which emails belong to platform operators.

**Fix:** Always run a dummy `verifyPassword(DUMMY_HASH, password)` before returning for nonexistent users.

---

## Important (Confidence 80–89)

### 5. No rate limiting on `/refresh` endpoint
**File:** `server/routes/auth.ts:666`

Login and reset-password have rate limiters. `/refresh` has none. Defense-in-depth gap.

---

### 6. Lockout re-triggers immediately after natural expiry
**File:** `server/services/accountLockout.ts:18-33`

After 15-min lockout expires, the counter is still ≥5. The very next failed attempt re-locks immediately — zero grace attempts.

**Fix:** Reset `failedLoginAttempts` when `lockedUntil` has passed, either in `checkLockout` or in the SQL of `recordFailedLogin`.

---

### 7. Lockout notification email sent on EVERY post-lockout attempt
**File:** `server/services/accountLockout.ts:62-86`

Condition `if (isLocked)` fires when `newCount >= MAX_ATTEMPTS`. Attempts 6, 7, 8… keep sending emails and audit entries. Notification spam vector.

**Fix:** `if (newCount === MAX_ATTEMPTS)` instead of `>= MAX_ATTEMPTS`.

---

### 8. `verifyPassword` argument order inconsistency
**Files:** `server/trpc/routers/user.ts:181` vs `server/trpc/routers/mfa.ts:175`

One passes `(hash, candidate)`, the other `(candidate, hash)`. One of them is wrong. Could cause password change or MFA disable to always reject/accept.

**Fix:** Verify against the wrapper signature in `server/utils/passwords.ts` and fix the inverted call site.

---

### 9. DEMO_MODE lockout bug
**File:** `server/routes/auth.ts:487-502`

In DEMO_MODE, non-operator users can attempt local login. `recordFailedLogin` at line 502 doesn't pass `user.isPlatformOperator`, defaulting to `true` — locking accounts not subject to lockout.

---

### 10. `isRevoked` boundary: tokens issued at revocation second are killed
**File:** `server/services/sessionRevocation.ts:110`

`iat <= revokedAfter` revokes tokens issued in the same second as the revocation call. Any code that issues a new token then calls `revokeUserSessions` in the same second invalidates the fresh token.

**Fix:** `iat < revokedAfter` (strict less-than).

---

### 11. `changePassword` doesn't clear access token cookie
**File:** `server/trpc/routers/user.ts:205-224`

Returns `{ success: true }` while the client still holds a revoked JWT cookie. Next request gets 401 — confusing UX.

**Fix:** Call `clearAuthCookie(ctx.res)` after `revokeUserSessions`.

---

### 12. `changePassword` doesn't reset lockout counter
**File:** `server/trpc/routers/user.ts:201-212`

A user whose account was locked changes password, but `failedLoginAttempts`/`lockedUntil` remain. The lock persists through credential rotation.

---

### 13. Encryption key naming is misleading
**File:** `server/services/encryption.ts:17`

`AI_KEY_ENCRYPTION_SECRET` is used for all field-level encryption. If used for MFA secrets (fix for #2), operators may rotate it only for AI changes.

**Fix:** Rename to `FIELD_ENCRYPTION_SECRET` or introduce a second key.

---

### 14. Socket revocation allows one extra event
**File:** `server/socket/handlers.ts:256-277`

Documented as intentional. Periodic check is fire-and-forget — the triggering event completes even if revocation is detected. Mutation events (`message:send`, `ticket:close`) can execute once after revocation.

---

### 15. `cleanupExpiredTokens` grace period double-counts
**File:** `server/services/refreshToken.ts:102-113`

Tokens retained for `2 * REFRESH_TOKEN_EXPIRY + graceDays` from creation instead of `REFRESH_TOKEN_EXPIRY + graceDays`. Table grows larger than intended.

---

## Verified Clean

| Area | Status |
|------|--------|
| Token hash storage (SHA-256) | ✅ Correct |
| Cookie settings (HttpOnly, Secure, path) | ✅ Correct |
| JWT algorithm pinned to HS256 | ✅ Correct |
| JWT secret enforced min 64 chars | ✅ Correct |
| Socket identity from JWT only | ✅ Correct |
| enter-partner restricted to operators | ✅ Correct |
| Refresh token family revocation logic | ✅ Correct (non-concurrent) |
| Session revocation check on every request | ✅ Correct (Redis-backed) |
| Fail-closed on Redis unavailability | ✅ Correct |
| TOTP replay prevention (Redis TTL) | ✅ Correct |
| Recovery codes consumed in login flow | ✅ Correct |
| SSO JWKS signature verification | ✅ Correct |
| Role escalation prevention | ✅ Correct |
| Argon2id throughout (no bcrypt) | ✅ Correct |
| Partner multi-tenancy on lockout | ✅ N/A (global users table) |
| AES-256-GCM in encryption service | ✅ Correct |
