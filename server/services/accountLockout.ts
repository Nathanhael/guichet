import { eq, sql } from 'drizzle-orm';
import { db } from '../db.js';
import { users, auditLog } from '../db/schema.js';
import logger from '../utils/logger.js';
import { MailService } from './mail.js';

const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

interface LockoutStatus {
  locked: boolean;
  retryAfterMs?: number;
}

/**
 * Checks if a user account is currently locked.
 */
export function checkLockout(user: { lockedUntil?: string | null }): LockoutStatus {
  if (!user.lockedUntil) return { locked: false };

  const lockedUntil = new Date(user.lockedUntil);
  const now = new Date();

  if (now >= lockedUntil) {
    // Lock has expired
    return { locked: false };
  }

  return {
    locked: true,
    retryAfterMs: lockedUntil.getTime() - now.getTime(),
  };
}

/**
 * Records a failed login attempt. Locks the account if MAX_ATTEMPTS is reached.
 * Uses a single atomic UPDATE to prevent race conditions from concurrent requests.
 * Lockout only applies to platform operators — partner users authenticate via SSO.
 */
export async function recordFailedLogin(userId: string, isPlatformOperator: boolean = true): Promise<{ locked: boolean; attemptsLeft: number }> {
  // Lockout only applies to platform operators (partner users use SSO)
  if (!isPlatformOperator) return { locked: false, attemptsLeft: MAX_ATTEMPTS };
  // Atomic increment + conditional lock in a single UPDATE to prevent TOCTOU race
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

/**
 * Resets failed login counter on successful login.
 */
export async function resetFailedLogins(userId: string): Promise<void> {
  await db.update(users).set({
    failedLoginAttempts: 0,
    lockedUntil: null,
  }).where(eq(users.id, userId));
}
