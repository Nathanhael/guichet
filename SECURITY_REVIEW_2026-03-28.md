# Security Review: Server-Side Authentication, Authorization & Session Management

**Date**: 2026-03-28
**Reviewer**: Claude Opus 4.6 (Senior Code Reviewer)
**Scope**: auth routes, middleware, session management, MFA, SSO, lockout, tRPC middleware, config

---

## Executive Summary

The Tessera authentication stack is well-architected overall. It demonstrates mature security patterns: Argon2id hashing, atomic lockout increments, fail-closed Redis revocation, TOTP replay prevention with timing-safe comparison, and proper CSRF state management for SSO. However, several issues ranging from critical to minor were identified.

---

## CRITICAL Issues

### 1. MFA Challenge Token Bypass via Password Re-submission (auth.ts:354-393, 515-551)

**File**: `server/routes/auth.ts`, lines 354-393 and 515-551

When MFA is required, the server returns `{ mfaRequired: true, challengeToken }`. The client is expected to re-submit with the TOTP code. However, the login endpoint accepts **both** `password` and `totpCode` in a single request. An attacker who knows the password can simply include a TOTP code in the initial login request, skipping the challenge flow entirely.

**The actual vulnerability**: If Redis is unavailable when storing the challenge token (lines 363-366, 519-527), the server catches the error, logs it, but **still returns the challengeToken to the client**. The challenge token was generated with `crypto.randomUUID()` but never persisted. This means:
- The token is useless (cannot be redeemed)
- But the login flow continues normally since the user can just re-submit with email+password+totpCode

This is not itself a bypass since the TOTP is still verified, but the error handling is misleading. The real concern is the next item.

### 2. Race Condition in Lockout Check After Password Verification (auth.ts:336-340, 498-503)

**File**: `server/routes/auth.ts`, lines 336-340 and 498-503

After successful password verification, the code re-checks lockout:
```typescript
const lockoutAfterPw = checkLockout(user);
```

But `checkLockout` reads from the **stale `user` object** fetched at the start of the request, not from the database. If a concurrent request locked the account between the initial fetch and this check, the stale data would show `lockedUntil = null`, allowing authentication to proceed despite the account being locked.

**Fix**: Re-fetch the user's `lockedUntil` from the database, or remove this redundant check since `recordFailedLogin` already handles the atomic locking.

### 3. SSO Exchange Endpoint Has No Authentication (sso.ts:380-408)

**File**: `server/routes/sso.ts`, lines 380-408

The `/exchange` endpoint redeems an opaque token for the full user payload (id, name, memberships, roles). It requires no authentication -- any client that can guess or intercept the UUID can retrieve the payload.

**Mitigating factors**: The token is a `crypto.randomUUID()` (122-bit entropy), has a 60-second TTL, and is single-use. This makes brute-force impractical.

**Remaining risk**: If the UUID leaks via browser history, referrer headers, or logging, an attacker within the 60-second window can steal the session data. The JWT cookie is already set before the redirect (line 369), so the exchange only leaks profile data, not the auth token itself.

**Recommendation**: Bind the exchange token to the JWT cookie -- require the `tessera_token` cookie to be present and valid when calling `/exchange`.

---

## IMPORTANT Issues

### 4. In-Memory Rate Limiter Not Effective in Multi-Instance Deployments (auth.ts:28-67)

**File**: `server/routes/auth.ts`, lines 28-67

The `loginRateLimitMap` is an in-memory `Map`. In a horizontally scaled deployment (multiple server instances behind the load balancer), each instance maintains its own map. An attacker can distribute requests across instances, effectively multiplying the rate limit by the number of instances.

**Fix**: Move rate limiting to Redis (like the forgot-password rate limiter already does) or use a shared store.

### 5. User List Endpoint Exposes Internal Error Messages (user.ts:25-31)

**File**: `server/trpc/routers/user.ts`, lines 25-31

```typescript
throw new TRPCError({
  code: 'INTERNAL_SERVER_ERROR',
  message: err instanceof Error ? err.message : String(err)
});
```

Raw error messages from database queries are exposed to the client. This pattern appears in `list`, `demoList`, and `revokeSessions` mutations. Database error messages can leak schema details, table names, or constraint names.

**Fix**: Return a generic message and log the real error server-side.

### 6. No Rate Limiting on Password Reset Token Consumption (auth.ts:189-268)

**File**: `server/routes/auth.ts`, lines 189-268

The `reset-password` endpoint has no rate limiter. An attacker with a valid reset token could brute-force the MFA TOTP code (6-digit = 1M combinations). The account lockout mechanism partially mitigates this (5 attempts), but:
- Lockout only applies if the token is valid and MFA is required
- There is no IP-based rate limit on this endpoint

**Fix**: Apply `loginRateLimit` (or a Redis-based equivalent) to the reset-password endpoint.

### 7. Demo User List Leaks User IDs and Platform Operator Status (user.ts:33-55)

**File**: `server/trpc/routers/user.ts`, lines 33-55

The `demoList` procedure is a `publicProcedure` (no auth required). It returns `id`, `name`, `lang`, `is_platform_operator`, and `role` for all users. Even though it's gated by `DEMO_MODE`, if accidentally left enabled in production, it provides a complete user enumeration with privilege levels.

**Fix**: Add a strong warning in config validation if `DEMO_MODE=true`, and consider returning only `id` and `name`.

### 8. MFA Disable Does Not Require Re-authentication (mfa.ts:119-169)

**File**: `server/trpc/routers/mfa.ts`, lines 119-169

The `mfa.disable` mutation requires a TOTP code but not the user's password. If an attacker has access to an authenticated session (e.g., XSS stealing a non-HttpOnly cookie -- which is not the case here since tessera_token is HttpOnly), they could disable MFA using a current TOTP code if they also have access to the authenticator.

**Mitigating factor**: The attacker would need both the session and the TOTP device. Sessions are revoked after disable. This is a defense-in-depth recommendation, not an active vulnerability.

### 9. Password Reset Token Not Invalidated on New Request (auth.ts:108-165)

**File**: `server/routes/auth.ts`, lines 142-151

When a user requests a password reset, the old token is silently overwritten with a new one. This is correct behavior (only the latest token works). However, there is no explicit invalidation of the old token -- it's overwritten by the new `hashedToken`. If two requests are processed concurrently, a race condition could leave the first token valid.

**Mitigating factor**: The token column is a single value, so the last write wins. The 1-hour expiry limits the window. This is low risk.

---

## MINOR Issues

### 10. JWT Claims Are Trusted Without Database Validation (middleware/auth.ts, context.ts)

**File**: `server/middleware/auth.ts`, lines 38-55 and `server/trpc/context.ts`, lines 40-56

The `role`, `partnerId`, `departments`, and `isPlatformOperator` claims from the JWT are trusted directly without re-validating against the database. If a user's role is changed or membership is revoked, their existing JWT remains valid until expiry.

**Mitigating factor**: Session revocation (`revokeUserSessions`) is called on security-critical changes (password change, MFA disable). The 24h default JWT expiry limits the staleness window.

**Recommendation**: For high-security deployments, consider a shorter JWT expiry or periodic re-validation of critical claims.

### 11. Inconsistent Lockout Check in MFA Disable vs Enable (mfa.ts)

**File**: `server/trpc/routers/mfa.ts`

`mfa.disable` and `mfa.regenerateRecoveryCodes` check lockout before TOTP verification (good). However, `mfa.enable` does NOT check lockout -- an attacker brute-forcing the verification code during setup is not subject to lockout.

**Fix**: Add `checkLockout` and `recordFailedLogin` to the `mfa.enable` mutation's code verification.

### 12. SSO Callback Uses First CORS Origin as Redirect Target (sso.ts:110)

**File**: `server/routes/sso.ts`, line 110

```typescript
const clientOrigin = config.CORS_ORIGIN.split(',')[0];
```

If CORS_ORIGIN is misconfigured or contains unexpected entries, the redirect could go to an unintended origin. This is not exploitable via user input since the value comes from server config.

**Recommendation**: Add a dedicated `FRONTEND_URL` config (which already exists -- use it here instead of parsing CORS_ORIGIN).

### 13. Recovery Code Comparison Uses indexOf (Not Constant-Time) (auth.ts:215, 375)

**File**: `server/routes/auth.ts`, lines 215 and 375

```typescript
const recoveryIdx = recoveryCodes.indexOf(codeHash);
```

Recovery codes are SHA-256 hashed before comparison, and `indexOf` compares the hashes. Since the input is already hashed, timing differences reveal information about the hash, not the original code. The practical risk is negligible because:
- The attacker already knows the input (they submitted it)
- The hash is deterministic, so they can compute it themselves
- SHA-256 hashes are fixed-length, so early termination reveals little

**Recommendation**: For defense-in-depth, use `timingSafeEqual` on hash comparisons, matching the pattern already used for TOTP in `platformStepUp.ts`.

### 14. `canAccessPartnerContext` Always Returns True for Platform Operators (roles.ts:47-49)

**File**: `server/services/roles.ts`, lines 47-49

```typescript
export function canAccessPartnerContext(isPlatformOperator: boolean, partnerId?: string | null): boolean {
  return isPlatformOperator || !!partnerId;
}
```

This function is called in `enter-partner` with `canAccessPartnerContext(true, partner.id)` -- the first argument is hardcoded to `true`, making this check always pass. The function provides no actual authorization value in this context.

**Recommendation**: Either make this check meaningful (e.g., check against an allow-list) or remove the redundant call.

### 15. No Audit Log for Failed Login Attempts (auth.ts)

**File**: `server/routes/auth.ts`

Failed login attempts are logged via `logger.warn` but not written to the `audit_log` table. Only the lockout event is audit-logged (in `accountLockout.ts:63`). Individual failed attempts are invisible in the audit trail.

**Recommendation**: Write failed login attempts to the audit log for security monitoring and forensics.

---

## What Was Done Well

- **Argon2id** with proper parameters (19456 KiB memory, 2 iterations) -- excellent choice over bcrypt
- **Atomic lockout increment** via raw SQL prevents TOCTOU races on the counter itself
- **Fail-closed Redis revocation** -- when Redis is down, tokens are treated as revoked
- **TOTP replay prevention** with Redis-backed used-token tracking
- **Timing-safe TOTP comparison** via `crypto.timingSafeEqual`
- **SSO state tokens** stored in Redis with TTL and single-use deletion
- **Opaque SSO exchange tokens** instead of passing user data in URL fragments
- **SSO account linking protection** -- refuses to link SSO identity to accounts with passwords
- **Nonce verification** on SSO ID tokens to prevent replay attacks
- **JWKS signature verification** on Azure AD ID tokens
- **Session revocation on security events** (password change, MFA disable, password reset)
- **HttpOnly + SameSite=Lax cookies** for JWT transport
- **Zod validation** on all config with minimum JWT_SECRET length enforcement
- **Password strength validation** with context-aware checks and common password blocking
- **Password history** preventing reuse of last 5 passwords
- **Cookie domain configuration** for subdomain deployments

---

## Recommended Priority Order

1. **[CRITICAL #2]** Fix stale lockout check after password verification
2. **[IMPORTANT #4]** Move login rate limiter to Redis
3. **[IMPORTANT #6]** Add rate limiting to reset-password endpoint
4. **[IMPORTANT #5]** Stop leaking raw error messages in tRPC handlers
5. **[CRITICAL #3]** Bind SSO exchange to authenticated session
6. **[IMPORTANT #7]** Restrict demoList output fields
7. **[MINOR #11]** Add lockout check to mfa.enable
8. **[MINOR #13]** Use timingSafeEqual for recovery code hash comparison
9. **[MINOR #15]** Audit-log failed login attempts
10. **[MINOR #12]** Use FRONTEND_URL for SSO redirect instead of parsing CORS_ORIGIN
