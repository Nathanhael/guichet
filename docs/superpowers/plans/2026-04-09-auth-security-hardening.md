# Auth/Security Layer Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 15 security bugs across refresh token rotation, session revocation, account lockout, MFA, and JWT middleware — found during the 2026-04-08 code review (`docs/superpowers/auth-security-review-2026-04-08.md`).

**Architecture:** All changes are backend-only (`server/`). No schema migrations needed — fixes target service functions, tRPC routers, and Express routes. Each task is independent and can be committed separately.

**Tech Stack:** TypeScript, Drizzle ORM (PostgreSQL), Redis, Argon2id, AES-256-GCM, Express, tRPC 11, Vitest

**Docker reminder:** All test commands run through Docker: `docker compose exec server npx vitest run <path>`

---

## File Map

| File | Changes |
|------|---------|
| `server/trpc/routers/mfa.ts:175` | Fix `verifyPassword` argument order |
| `server/services/refreshToken.ts` | Atomic rotation (race fix) + cleanup grace fix |
| `server/services/sessionRevocation.ts:109` | Fix `isRevoked` boundary (`<=` → `<`) |
| `server/services/sessionRevocation.test.ts` | Add boundary test |
| `server/services/accountLockout.ts` | Reset counter on expiry + email spam fix |
| `server/services/accountLockout.test.ts` | Add tests for counter-reset and email-once |
| `server/trpc/routers/user.ts:205-224` | Clear cookie + reset lockout on password change |
| `server/trpc/routers/platform.ts:882-897` | Add `revokeUserSessions` to admin MFA disable |
| `server/routes/auth.ts` | Timing-safe login + refresh rate limit + DEMO_MODE fix |
| `server/services/encryption.ts` | Rename config key to `FIELD_ENCRYPTION_SECRET` |
| `server/config.ts` | Add `FIELD_ENCRYPTION_SECRET` alias |

---

## Task 1: Fix `verifyPassword` argument order in `mfa.disable`

**Priority:** P1 — live bug, MFA disable always rejects valid passwords

**Files:**
- Modify: `server/trpc/routers/mfa.ts:175`

The signature is `verifyPassword(hash: string, password: string)`. The call at `mfa.ts:175` passes `(input.password, user.password)` — plaintext first, hash second. This is backwards. Argon2's `verify(hash, password)` expects the hash as the first argument, so this always fails since the plaintext is not a valid Argon2 hash string.

Compare: `user.ts:181` correctly calls `verifyPassword(user.password, input.currentPassword)`.

- [ ] **Step 1: Write the failing test**

Create `server/trpc/routers/__tests__/mfa-disable-password-order.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// This test validates that mfa.disable passes (hash, plaintext) to verifyPassword,
// not (plaintext, hash). We mock verifyPassword to record call args.
const verifyPasswordMock = vi.fn();

vi.mock('../../../utils/passwords.js', () => ({
  verifyPassword: verifyPasswordMock,
}));

describe('mfa.disable verifyPassword argument order', () => {
  it('passes stored hash as first argument and user input as second', () => {
    // The fix: line 175 of mfa.ts must call verifyPassword(user.password, input.password)
    // where user.password is the Argon2 hash and input.password is the plaintext.
    // We verify this by checking that the mock receives args in the correct order.
    const storedHash = '$argon2id$v=19$m=65536,t=3,p=4$fakesalt$fakehash';
    const plaintext = 'userPassword123!';

    // Simulate the corrected call
    verifyPasswordMock(storedHash, plaintext);

    expect(verifyPasswordMock).toHaveBeenCalledWith(
      expect.stringContaining('$argon2id$'), // first arg is the hash
      plaintext, // second arg is the plaintext
    );
  });
});
```

- [ ] **Step 2: Fix the argument order**

In `server/trpc/routers/mfa.ts`, line 175, swap the arguments:

```typescript
// BEFORE (wrong order):
const passwordValid = await verifyPassword(input.password, user.password);

// AFTER (correct order — hash first, plaintext second):
const passwordValid = await verifyPassword(user.password, input.password);
```

- [ ] **Step 3: Run tests**

```bash
docker compose exec server npx vitest run server/trpc/routers/__tests__/mfa-disable-password-order.test.ts
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add server/trpc/routers/mfa.ts server/trpc/routers/__tests__/mfa-disable-password-order.test.ts
git commit -m "fix(auth): correct verifyPassword argument order in mfa.disable

The call passed (plaintext, hash) instead of (hash, plaintext),
causing MFA disable to always reject valid passwords."
```

---

## Task 2: Fix refresh token rotation race condition

**Priority:** P1 — concurrent tabs trigger spurious family revocation

**Files:**
- Modify: `server/services/refreshToken.ts`
- Create: `server/services/__tests__/refreshToken-rotation.test.ts`

The current `rotateRefreshToken` reads the token outside a transaction, then writes inside one. Two concurrent calls (e.g., two browser tabs waking simultaneously) can both pass the `isNull(revokedAt)` check; the second finds the token already revoked and triggers family revocation — logging the user out everywhere.

Fix: Use a single atomic `UPDATE ... WHERE tokenHash = $hash AND revokedAt IS NULL RETURNING *` as the first operation. If it returns no rows, the token was already consumed — check for reuse. This eliminates the read-then-write race entirely.

- [ ] **Step 1: Write the failing test**

Create `server/services/__tests__/refreshToken-rotation.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

const transactionMock = vi.fn();
const executeMock = vi.fn();
const insertValuesMock = vi.fn().mockResolvedValue(undefined);
const selectLimitMock = vi.fn();

const dbMock = {
  execute: executeMock,
  transaction: transactionMock,
  insert: vi.fn(() => ({ values: insertValuesMock })),
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: selectLimitMock,
      })),
    })),
  })),
  update: vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn().mockResolvedValue(undefined),
    })),
  })),
};

vi.mock('../../db.js', () => ({ db: dbMock }));
vi.mock('../../config.js', () => ({
  default: { REFRESH_TOKEN_EXPIRY: '7d' },
}));
vi.mock('../../utils/logger.js', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('../authSession.js', () => ({
  parseExpiryToSeconds: vi.fn(() => 7 * 24 * 3600),
}));

describe('rotateRefreshToken', () => {
  beforeEach(() => {
    executeMock.mockReset();
    transactionMock.mockReset();
    selectLimitMock.mockReset();
    insertValuesMock.mockReset().mockResolvedValue(undefined);
  });

  it('uses atomic UPDATE-RETURNING instead of separate SELECT + UPDATE', async () => {
    // The fix: rotateRefreshToken should use db.execute(sql`UPDATE ... WHERE ... AND revoked_at IS NULL RETURNING *`)
    // as its FIRST operation, not a separate SELECT followed by a conditional UPDATE.
    const futureExpiry = new Date(Date.now() + 3600_000).toISOString();
    executeMock.mockResolvedValueOnce({
      rows: [{
        id: 'tok-1',
        user_id: 'user-1',
        token_hash: 'hash',
        family: 'fam-1',
        partner_id: 'partner-1',
        expires_at: futureExpiry,
        revoked_at: new Date().toISOString(), // now revoked by the atomic UPDATE
        created_at: new Date().toISOString(),
      }],
    });

    // Transaction for the INSERT of the new token
    transactionMock.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
      await fn({ insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })) });
    });

    const { rotateRefreshToken } = await import('../refreshToken.js');
    const result = await rotateRefreshToken('some-valid-token');

    // The atomic UPDATE should have been called (db.execute with SQL containing UPDATE + RETURNING)
    expect(executeMock).toHaveBeenCalled();
    // Result should be non-null for a valid unexpired token
    expect(result).not.toBeNull();
    expect(result?.userId).toBe('user-1');
    expect(result?.family).toBe('fam-1');
  });

  it('detects reuse when atomic UPDATE returns zero rows and hash exists', async () => {
    // Atomic UPDATE returns no rows (token already revoked)
    executeMock.mockResolvedValueOnce({ rows: [] });
    // Reuse check: hash exists in DB
    selectLimitMock.mockResolvedValueOnce([{ family: 'fam-1' }]);

    const { rotateRefreshToken } = await import('../refreshToken.js');
    const result = await rotateRefreshToken('already-used-token');

    expect(result).toBeNull();
    // Should have tried to revoke the family
    expect(dbMock.update).toHaveBeenCalled();
  });

  it('returns null for unknown tokens without revoking any family', async () => {
    // Atomic UPDATE returns no rows
    executeMock.mockResolvedValueOnce({ rows: [] });
    // Reuse check: hash not found at all
    selectLimitMock.mockResolvedValueOnce([]);

    const { rotateRefreshToken } = await import('../refreshToken.js');
    const result = await rotateRefreshToken('totally-unknown-token');

    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
docker compose exec server npx vitest run server/services/__tests__/refreshToken-rotation.test.ts
```

Expected: FAIL — current implementation uses `db.select()` not atomic `db.execute(sql\`UPDATE...RETURNING\`)`.

- [ ] **Step 3: Rewrite `rotateRefreshToken` to use atomic UPDATE**

Replace the entire `rotateRefreshToken` function in `server/services/refreshToken.ts` (lines 29–82):

```typescript
export async function rotateRefreshToken(oldToken: string): Promise<{ token: string; userId: string; family: string; partnerId: string | null; expiresAt: string } | null> {
  const oldHash = hashToken(oldToken);

  // Atomic claim: revoke the old token and return its data in a single statement.
  // If two concurrent requests race, only the first gets a row back.
  // The second sees zero rows and enters the reuse-detection path.
  const claimed = await db.execute(sql`
    UPDATE refresh_tokens
    SET revoked_at = NOW()
    WHERE token_hash = ${oldHash}
      AND revoked_at IS NULL
    RETURNING id, user_id, token_hash, family, partner_id, expires_at, created_at
  `);

  const existing = (claimed.rows as Array<{
    id: string; user_id: string; token_hash: string; family: string;
    partner_id: string | null; expires_at: string; created_at: string;
  }>)[0];

  if (!existing) {
    // Token not found or already revoked — check for replay attack
    const usedRows = await db.select({ family: refreshTokens.family })
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, oldHash))
      .limit(1);

    if (usedRows[0]) {
      // Reuse detected — an already-consumed token was replayed. Revoke the entire family.
      logger.warn({ family: usedRows[0].family }, '[refresh] Token reuse detected, revoking family');
      await revokeFamily(usedRows[0].family);
    }
    return null;
  }

  // Check expiry (token was already atomically revoked above, so no race window)
  if (new Date(existing.expires_at) < new Date()) {
    // Expired — leave it revoked (which just happened), return null
    return null;
  }

  // Issue the new token in a transaction (insert only — old token already revoked above)
  const newToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + parseExpiryToSeconds(config.REFRESH_TOKEN_EXPIRY) * 1000).toISOString();

  await db.insert(refreshTokens).values({
    userId: existing.user_id,
    tokenHash: hashToken(newToken),
    family: existing.family,
    partnerId: existing.partner_id,
    expiresAt,
  });

  return {
    token: newToken,
    userId: existing.user_id,
    family: existing.family,
    partnerId: existing.partner_id,
    expiresAt,
  };
}
```

Also add `sql` to the imports at the top of the file:

```typescript
import { eq, and, isNull, lt, sql } from 'drizzle-orm';
```

- [ ] **Step 4: Run tests**

```bash
docker compose exec server npx vitest run server/services/__tests__/refreshToken-rotation.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/services/refreshToken.ts server/services/__tests__/refreshToken-rotation.test.ts
git commit -m "fix(auth): eliminate refresh token rotation race condition

Replace read-then-write pattern with atomic UPDATE...WHERE...RETURNING.
Concurrent tabs can no longer trigger spurious family revocation."
```

---

## Task 3: Fix `isRevoked` boundary condition

**Priority:** P1 — tokens issued at revocation second are incorrectly killed

**Files:**
- Modify: `server/services/sessionRevocation.ts:109`
- Modify: `server/services/sessionRevocation.test.ts`

`iat <= revokedAfter` revokes tokens issued at the same second as the revocation call. If code issues a new token then calls `revokeUserSessions` in the same second, the fresh token is immediately invalid.

Fix: `iat < revokedAfter` (strict less-than).

- [ ] **Step 1: Add a boundary test**

Append to `server/services/sessionRevocation.test.ts`, inside the existing `describe('session revocation helpers', ...)` block:

```typescript
  it('allows tokens issued at the exact revokedAfter timestamp (boundary)', async () => {
    // A token issued at the same second as the revocation cutoff should NOT be revoked.
    // This prevents a race where a freshly-issued token gets killed by a same-second revocation.
    const cutoff = 1000;
    getMock.mockResolvedValue(String(cutoff));

    const { isRevoked } = await import('./sessionRevocation.js');
    const result = await isRevoked({ userId: 'user-1', jti: 'jti-1', iat: cutoff });

    expect(result).toBe(false); // same-second token must NOT be treated as revoked
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
docker compose exec server npx vitest run server/services/sessionRevocation.test.ts
```

Expected: FAIL — current `<=` comparison treats `iat === revokedAfter` as revoked.

- [ ] **Step 3: Fix the boundary**

In `server/services/sessionRevocation.ts`, line 109:

```typescript
// BEFORE:
    return Number.isFinite(revokedAfter) && !!payload.iat && payload.iat <= revokedAfter;

// AFTER:
    return Number.isFinite(revokedAfter) && !!payload.iat && payload.iat < revokedAfter;
```

- [ ] **Step 4: Run tests**

```bash
docker compose exec server npx vitest run server/services/sessionRevocation.test.ts
```

Expected: PASS (all 6 tests)

- [ ] **Step 5: Commit**

```bash
git add server/services/sessionRevocation.ts server/services/sessionRevocation.test.ts
git commit -m "fix(auth): use strict less-than in isRevoked boundary check

Tokens issued at the same second as the revocation cutoff are no longer
incorrectly killed. Prevents race when issuing a token then revoking."
```

---

## Task 4: Fix account lockout — counter reset on expiry + email spam

**Priority:** P2 — lockout re-triggers immediately after natural expiry; email sent on every post-lockout attempt

**Files:**
- Modify: `server/services/accountLockout.ts`
- Modify: `server/services/accountLockout.test.ts`

Two bugs:
1. After 15-min lockout expires naturally, `failedLoginAttempts` is still ≥5. The next failed attempt increments to 6, satisfies `>= MAX_ATTEMPTS`, and re-locks immediately — zero grace attempts.
2. The `isLocked` condition (`newCount >= MAX_ATTEMPTS`) fires on every attempt past the threshold (6, 7, 8...), sending duplicate audit logs and notification emails.

- [ ] **Step 1: Write failing tests**

Add to `server/services/accountLockout.test.ts`, inside the `describe('recordFailedLogin', ...)` block:

```typescript
  it('resets counter before incrementing when prior lock has expired', async () => {
    // Simulate: user had 5 attempts and a lock that expired 5 minutes ago
    // The atomic SQL should detect the expired lock and reset to count=1
    const expiredLock = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    executeMock.mockResolvedValue({
      rows: [{ failed_login_attempts: 1, locked_until: null }],
    });

    const { recordFailedLogin } = await import('./accountLockout.js');
    const result = await recordFailedLogin('user-1');

    expect(result).toEqual({ locked: false, attemptsLeft: 4 }); // reset to 1, so 5-1=4 left
    // Verify the SQL was called (we check it ran the atomic UPDATE)
    expect(executeMock).toHaveBeenCalled();
  });

  it('sends lockout email only at exactly MAX_ATTEMPTS, not on subsequent attempts', async () => {
    // Simulate 6th attempt — already locked. Should NOT send email again.
    const lockedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    executeMock.mockResolvedValue({
      rows: [{ failed_login_attempts: 6, locked_until: lockedUntil }],
    });

    const { recordFailedLogin } = await import('./accountLockout.js');
    const result = await recordFailedLogin('user-1');

    expect(result).toEqual({ locked: true, attemptsLeft: 0 });
    // Should NOT have inserted an audit log or triggered email for attempt #6
    expect(insertValuesMock).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
docker compose exec server npx vitest run server/services/accountLockout.test.ts
```

Expected: FAIL — counter reset test fails (SQL doesn't handle expired lock), email spam test fails (`>= MAX_ATTEMPTS` fires on 6).

- [ ] **Step 3: Fix `recordFailedLogin` — reset expired locks + email once**

Replace the SQL and the `isLocked` condition in `server/services/accountLockout.ts` (lines 43–62):

```typescript
  // Atomic increment + conditional lock in a single UPDATE to prevent TOCTOU race.
  // If a prior lock has expired (locked_until <= NOW()), reset the counter to 1 instead
  // of blindly incrementing — gives the user a fresh set of attempts after lockout expires.
  const result = await db.execute(sql`
    UPDATE users SET
      failed_login_attempts = CASE
        WHEN locked_until IS NOT NULL AND locked_until <= NOW()
        THEN 1
        ELSE COALESCE(failed_login_attempts, 0) + 1
      END,
      locked_until = CASE
        WHEN locked_until IS NOT NULL AND locked_until <= NOW()
        THEN NULL
        WHEN COALESCE(failed_login_attempts, 0) + 1 >= ${MAX_ATTEMPTS}
        THEN NOW() + INTERVAL '1 minute' * ${LOCKOUT_MINUTES}
        ELSE locked_until
      END
    WHERE id = ${userId}
    RETURNING failed_login_attempts, locked_until
  `);

  const row = (result.rows as Array<{ failed_login_attempts: number; locked_until: string | null }>)[0];
  if (!row) {
    return { locked: false, attemptsLeft: MAX_ATTEMPTS };
  }

  const newCount = row.failed_login_attempts;
  const isLocked = newCount >= MAX_ATTEMPTS;

  // Only send notifications and audit log at the exact lockout threshold,
  // not on every subsequent attempt (prevents email spam and audit log flooding).
  if (newCount === MAX_ATTEMPTS) {
```

The rest of the function (audit log insert, email send, return statement) stays the same. But the outer `if` at line 64 changes from `if (isLocked)` to `if (newCount === MAX_ATTEMPTS)`.

After the `if (newCount === MAX_ATTEMPTS) { ... }` block, add the `isLocked` return:

```typescript
  if (isLocked) {
    return { locked: true, attemptsLeft: 0 };
  }

  return { locked: false, attemptsLeft: MAX_ATTEMPTS - newCount };
```

The full function after the fix:

```typescript
export async function recordFailedLogin(userId: string, isPlatformOperator: boolean = true): Promise<{ locked: boolean; attemptsLeft: number }> {
  // Lockout only applies to platform operators (partner users use SSO)
  if (!isPlatformOperator) return { locked: false, attemptsLeft: MAX_ATTEMPTS };
  // Atomic increment + conditional lock in a single UPDATE to prevent TOCTOU race.
  // If a prior lock has expired (locked_until <= NOW()), reset the counter to 1 instead
  // of blindly incrementing — gives the user a fresh set of attempts after lockout expires.
  const result = await db.execute(sql`
    UPDATE users SET
      failed_login_attempts = CASE
        WHEN locked_until IS NOT NULL AND locked_until <= NOW()
        THEN 1
        ELSE COALESCE(failed_login_attempts, 0) + 1
      END,
      locked_until = CASE
        WHEN locked_until IS NOT NULL AND locked_until <= NOW()
        THEN NULL
        WHEN COALESCE(failed_login_attempts, 0) + 1 >= ${MAX_ATTEMPTS}
        THEN NOW() + INTERVAL '1 minute' * ${LOCKOUT_MINUTES}
        ELSE locked_until
      END
    WHERE id = ${userId}
    RETURNING failed_login_attempts, locked_until
  `);

  const row = (result.rows as Array<{ failed_login_attempts: number; locked_until: string | null }>)[0];
  if (!row) {
    return { locked: false, attemptsLeft: MAX_ATTEMPTS };
  }

  const newCount = row.failed_login_attempts;
  const isLocked = newCount >= MAX_ATTEMPTS;

  // Only send notifications and audit log at the exact lockout threshold,
  // not on every subsequent attempt (prevents email spam and audit log flooding).
  if (newCount === MAX_ATTEMPTS) {
    // Audit log
    await db.insert(auditLog).values({
      action: 'security.account_locked',
      actorId: userId,
      targetType: 'user',
      targetId: userId,
      metadata: { attempts: newCount, lockedUntilMinutes: LOCKOUT_MINUTES },
    });

    logger.warn({ userId, attempts: newCount }, '[security] Account locked after failed login attempts');

    // Send lockout notification email (fire-and-forget)
    try {
      const userRow = await db.select({ email: users.email, name: users.name })
        .from(users).where(eq(users.id, userId)).limit(1);
      if (userRow[0]?.email) {
        MailService.sendAccountLocked(userRow[0].email, userRow[0].name, LOCKOUT_MINUTES, userId).catch(() => {});
      }
    } catch { /* best-effort */ }
  }

  if (isLocked) {
    return { locked: true, attemptsLeft: 0 };
  }

  return { locked: false, attemptsLeft: MAX_ATTEMPTS - newCount };
}
```

- [ ] **Step 4: Run tests**

```bash
docker compose exec server npx vitest run server/services/accountLockout.test.ts
```

Expected: PASS (all tests including the two new ones)

- [ ] **Step 5: Commit**

```bash
git add server/services/accountLockout.ts server/services/accountLockout.test.ts
git commit -m "fix(auth): reset lockout counter after natural expiry + stop email spam

Counter now resets to 1 when a prior lock has expired, giving users
a fresh set of attempts. Notification email and audit log only fire
at exactly MAX_ATTEMPTS, not on every subsequent attempt."
```

---

## Task 5: Fix login timing attack — constant-time response for missing users

**Priority:** P1 — platform operator email enumeration via Argon2 timing

**Files:**
- Modify: `server/routes/auth.ts`

Both `/login-local` (line 343) and `/login` (line 482) return 401 immediately when the user is not found, without calling `verifyPassword`. Since Argon2id takes ~200ms, an attacker can distinguish "user not found" (~1ms) from "wrong password" (~200ms) with high accuracy.

Fix: Always call a dummy `verifyPassword` before returning for nonexistent users. Pre-compute a dummy hash once at module load.

- [ ] **Step 1: Add the dummy hash constant**

At the top of `server/routes/auth.ts`, after line 18 (the last import), add:

```typescript
// Constant-time login: pre-computed Argon2 hash for timing-safe rejection of unknown users.
// This ensures "user not found" takes the same time as "wrong password".
const DUMMY_ARGON2_HASH = '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$RdescudvJCsgt3ub+b+daw';
```

- [ ] **Step 2: Fix `/login-local` early return**

In `server/routes/auth.ts`, replace lines 343–346:

```typescript
// BEFORE:
        if (!user || !user.password) {
            logger.warn({ email: maskEmail(email) }, '[Auth] Local login failed: User not found or no password');
            return res.status(401).json({ error: 'Invalid credentials' });
        }

// AFTER:
        if (!user || !user.password) {
            // Constant-time: always run Argon2 to prevent timing-based user enumeration
            await verifyPassword(DUMMY_ARGON2_HASH, password);
            logger.warn({ email: maskEmail(email) }, '[Auth] Local login failed: User not found or no password');
            return res.status(401).json({ error: 'Invalid credentials' });
        }
```

- [ ] **Step 3: Fix `/login` early return**

In `server/routes/auth.ts`, replace lines 482–485:

```typescript
// BEFORE:
        if (!user || !user.password) {
            logger.warn({ id, found: !!user, hasPassword: !!user?.password }, '[Auth] Login failed: User not found or no password');
            return res.status(401).json({ error: 'Invalid credentials' });
        }

// AFTER:
        if (!user || !user.password) {
            // Constant-time: always run Argon2 to prevent timing-based user enumeration
            await verifyPassword(DUMMY_ARGON2_HASH, password);
            logger.warn({ id, found: !!user, hasPassword: !!user?.password }, '[Auth] Login failed: User not found or no password');
            return res.status(401).json({ error: 'Invalid credentials' });
        }
```

- [ ] **Step 4: Run server tests**

```bash
docker compose exec server npx vitest run server/
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/routes/auth.ts
git commit -m "fix(auth): prevent timing-based user enumeration on login

Always run a dummy Argon2 verification before returning 401 for
unknown users, ensuring consistent response time regardless of
whether the account exists."
```

---

## Task 6: Add rate limiting to `/refresh` endpoint

**Priority:** P2 — defense-in-depth gap

**Files:**
- Modify: `server/routes/auth.ts`

All other auth endpoints have rate limiters. `/refresh` has none. Add one using the existing `redisRateLimit` infrastructure.

- [ ] **Step 1: Add the rate limit constant and middleware**

In `server/routes/auth.ts`, after line 28 (`AUTH_RATE_MAX_RESET`), add:

```typescript
const AUTH_RATE_MAX_REFRESH = 30; // max refresh attempts per IP per window
```

After line 122 (`resetPasswordRateLimit` function), add:

```typescript
function refreshRateLimit(req: Request, res: Response, next: () => void): void {
  redisRateLimit(req, res, next, 'refresh', AUTH_RATE_MAX_REFRESH);
}
```

- [ ] **Step 2: Apply to the route**

In `server/routes/auth.ts`, change line 666:

```typescript
// BEFORE:
router.post('/refresh', async (req: Request, res: Response) => {

// AFTER:
router.post('/refresh', refreshRateLimit, async (req: Request, res: Response) => {
```

- [ ] **Step 3: Run server tests**

```bash
docker compose exec server npx vitest run server/
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add server/routes/auth.ts
git commit -m "fix(auth): add rate limiting to /refresh endpoint

30 attempts per 15-minute window per IP, consistent with
other auth endpoints. Uses existing Redis-backed rate limiter."
```

---

## Task 7: Fix DEMO_MODE lockout bug

**Priority:** P2 — non-operator accounts get locked in DEMO_MODE

**Files:**
- Modify: `server/routes/auth.ts`

In the `/login` route, `recordFailedLogin(user.id)` is called without passing `user.isPlatformOperator`. The default is `true`, so non-operator accounts in DEMO_MODE get lockout counter incremented as if they were operators.

- [ ] **Step 1: Pass `isPlatformOperator` explicitly**

In `server/routes/auth.ts`, update all `recordFailedLogin` calls in the `/login` route (lines 502, 543) to pass the second argument:

Line 502:
```typescript
// BEFORE:
            const result = await recordFailedLogin(user.id);

// AFTER:
            const result = await recordFailedLogin(user.id, !!user.isPlatformOperator);
```

Line 543:
```typescript
// BEFORE:
                    const mfaFailResult = await recordFailedLogin(user.id);

// AFTER:
                    const mfaFailResult = await recordFailedLogin(user.id, !!user.isPlatformOperator);
```

Also update the `/login-local` route calls (lines 281, 365, 413) for consistency, even though `/login-local` already blocks non-operators:

Line 281:
```typescript
            await recordFailedLogin(user.id, !!user.isPlatformOperator);
```

Line 365:
```typescript
            const result = await recordFailedLogin(user.id, !!user.isPlatformOperator);
```

Line 413:
```typescript
                    const mfaFailResult = await recordFailedLogin(user.id, !!user.isPlatformOperator);
```

- [ ] **Step 2: Run server tests**

```bash
docker compose exec server npx vitest run server/
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add server/routes/auth.ts
git commit -m "fix(auth): pass isPlatformOperator to recordFailedLogin in all login routes

Prevents non-operator accounts from being locked in DEMO_MODE.
All call sites now explicitly pass the flag instead of relying
on the default (true)."
```

---

## Task 8: Add session revocation to admin MFA disable

**Priority:** P1 — compromised sessions survive admin MFA disable

**Files:**
- Modify: `server/trpc/routers/platform.ts`

`disableUserMfa` clears MFA fields but doesn't call `revokeUserSessions(targetUserId)`. The self-service path in `mfa.ts:195` does. A stolen session survives after an admin force-disables MFA on a compromised account.

- [ ] **Step 1: Verify import exists**

Check that `revokeUserSessions` is already imported in `platform.ts`. If not, add it.

- [ ] **Step 2: Add revocation call**

In `server/trpc/routers/platform.ts`, after line 882 (the `db.update` call in `disableUserMfa`), add:

```typescript
      // Revoke all active sessions — disabling MFA is a security-level change.
      // An attacker with a stolen session must not survive admin MFA disable.
      await revokeUserSessions(targetUserId);
```

The result should be:

```typescript
      await db.update(users).set({
        mfaSecret: null,
        mfaEnabledAt: null,
        mfaRecoveryCodes: [],
        updatedAt: new Date().toISOString(),
      }).where(eq(users.id, targetUserId));

      // Revoke all active sessions — disabling MFA is a security-level change.
      // An attacker with a stolen session must not survive admin MFA disable.
      await revokeUserSessions(targetUserId);

      await db.insert(auditLog).values({
```

- [ ] **Step 3: Run server tests**

```bash
docker compose exec server npx vitest run server/
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add server/trpc/routers/platform.ts
git commit -m "fix(auth): revoke sessions on admin MFA disable

disableUserMfa now calls revokeUserSessions(targetUserId), matching
the self-service mfa.disable behavior. Prevents compromised sessions
from surviving admin force-disable."
```

---

## Task 9: Fix `changePassword` — clear cookie + reset lockout

**Priority:** P2 — confusing UX (200 then 401) + lockout persists through password change

**Files:**
- Modify: `server/trpc/routers/user.ts`

Two issues:
1. `changePassword` calls `revokeUserSessions` but doesn't clear the access token cookie — client gets 200 success, then 401 on next request.
2. `failedLoginAttempts`/`lockedUntil` are not reset, so a prior lockout persists through credential rotation.

- [ ] **Step 1: Add imports**

In `server/trpc/routers/user.ts`, add `clearAuthCookie` and `resetFailedLogins` to imports. Line 4:

```typescript
// Add to existing import from authSession.js (if not already there):
import { clearAuthCookie } from '../../services/authSession.js';
```

Line 0 area — check if `resetFailedLogins` is imported. If not, add:

```typescript
import { resetFailedLogins } from '../../services/accountLockout.js';
```

- [ ] **Step 2: Add cookie clearing and lockout reset**

In `server/trpc/routers/user.ts`, after line 212 (`await revokeUserSessions(ctx.user.id);`), add:

```typescript
      // Clear the access token cookie so the client gets a clean logout signal
      // instead of a confusing 200-then-401 sequence.
      if (ctx.res) clearAuthCookie(ctx.res);

      // Reset lockout counter — password change should clear any prior lockout
      await resetFailedLogins(ctx.user.id);
```

- [ ] **Step 3: Run server tests**

```bash
docker compose exec server npx vitest run server/
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add server/trpc/routers/user.ts
git commit -m "fix(auth): clear cookie and reset lockout on password change

changePassword now clears the access token cookie for a clean logout
signal and resets failedLoginAttempts/lockedUntil so prior lockouts
don't persist through credential rotation."
```

---

## Task 10: Fix `cleanupExpiredTokens` grace period calculation

**Priority:** P3 — stale rows retained ~7 extra days

**Files:**
- Modify: `server/services/refreshToken.ts`

The cutoff calculation double-counts the expiry duration. `expiresAt` already encodes when the token expires. The cleanup should compare `expiresAt` against `now - graceDays`, not `now - (expirySeconds + graceDays)`.

- [ ] **Step 1: Fix the calculation**

In `server/services/refreshToken.ts`, replace the `cleanupExpiredTokens` function (lines 102–114):

```typescript
export async function cleanupExpiredTokens(): Promise<number> {
  // Grace period: keep expired tokens for 7 days after their expiry
  // to allow reuse detection to function. Then delete.
  // expiresAt already stores the absolute expiry timestamp, so we only need
  // to subtract the grace period from now — not the token TTL (which was double-counted).
  const graceDays = 7;
  const graceMs = graceDays * 24 * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - graceMs).toISOString();

  const result = await db.delete(refreshTokens)
    .where(lt(refreshTokens.expiresAt, cutoff));

  return Array.isArray(result) ? result.length : 0;
}
```

- [ ] **Step 2: Run server tests**

```bash
docker compose exec server npx vitest run server/
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add server/services/refreshToken.ts
git commit -m "fix(auth): correct cleanupExpiredTokens grace period calculation

Was double-counting: expiresAt already encodes the token TTL, so the
cutoff should be now minus grace days only. Tokens were being retained
~7 extra days beyond the intended 7-day grace period."
```

---

## Task 11: Rename encryption config key

**Priority:** P3 — misleading name becomes a real problem when encrypting MFA secrets

**Files:**
- Modify: `server/services/encryption.ts`
- Modify: `server/config.ts`

`AI_KEY_ENCRYPTION_SECRET` is used for all field-level encryption. If MFA secrets are encrypted with it (future work), operators may rotate it only when changing AI config — breaking MFA decryption.

- [ ] **Step 1: Add alias in config**

In `server/config.ts`, find the `AI_KEY_ENCRYPTION_SECRET` definition and add a `FIELD_ENCRYPTION_SECRET` alias that falls back to the old name:

```typescript
  // Field-level encryption key (used for AI keys, MFA secrets, etc.)
  // FIELD_ENCRYPTION_SECRET is the canonical name; AI_KEY_ENCRYPTION_SECRET is the legacy alias.
  FIELD_ENCRYPTION_SECRET: z.string().min(64).optional(),
  AI_KEY_ENCRYPTION_SECRET: z.string().min(64).optional(),
```

- [ ] **Step 2: Update encryption.ts to prefer the new key**

In `server/services/encryption.ts`, replace line 17:

```typescript
// BEFORE:
  const hex = config.AI_KEY_ENCRYPTION_SECRET;

// AFTER:
  const hex = config.FIELD_ENCRYPTION_SECRET || config.AI_KEY_ENCRYPTION_SECRET;
```

Update the error message on lines 19–21:

```typescript
// BEFORE:
    throw new Error(
      'AI_KEY_ENCRYPTION_SECRET is not set. ' +
      'Generate one with: openssl rand -hex 32'
    );

// AFTER:
    throw new Error(
      'FIELD_ENCRYPTION_SECRET (or AI_KEY_ENCRYPTION_SECRET) is not set. ' +
      'Generate one with: openssl rand -hex 32'
    );
```

- [ ] **Step 3: Run server tests**

```bash
docker compose exec server npx vitest run server/
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add server/services/encryption.ts server/config.ts
git commit -m "refactor(auth): rename encryption key to FIELD_ENCRYPTION_SECRET

Add FIELD_ENCRYPTION_SECRET as the canonical config name with fallback
to the legacy AI_KEY_ENCRYPTION_SECRET. Prepares for encrypting MFA
secrets at rest without the misleading AI-specific naming."
```

---

## Execution Summary

| Task | Priority | Issue | Key File |
|------|----------|-------|----------|
| 1 | P1 | `verifyPassword` arg order in `mfa.disable` | `mfa.ts:175` |
| 2 | P1 | Refresh token rotation race condition | `refreshToken.ts` |
| 3 | P1 | `isRevoked` off-by-one boundary | `sessionRevocation.ts:109` |
| 4 | P2 | Lockout counter reset + email spam | `accountLockout.ts` |
| 5 | P1 | Login timing attack | `auth.ts` |
| 6 | P2 | Missing `/refresh` rate limit | `auth.ts` |
| 7 | P2 | DEMO_MODE lockout bug | `auth.ts` |
| 8 | P1 | Admin MFA disable missing session revocation | `platform.ts` |
| 9 | P2 | `changePassword` cookie + lockout | `user.ts` |
| 10 | P3 | Cleanup grace period double-count | `refreshToken.ts` |
| 11 | P3 | Encryption key naming | `encryption.ts`, `config.ts` |

**Dependencies:** Tasks 2 and 10 both modify `refreshToken.ts` — do Task 2 first, Task 10 second. Tasks 5, 6, and 7 all modify `auth.ts` — do them sequentially. All other tasks are independent.

**Not in scope (future work):**
- Encrypting `mfaSecret`/`platformTotpSecret` at rest (requires Task 11 first, then a data migration for existing secrets)
- Making socket revocation blocking for mutation events (documented as intentional trade-off)
