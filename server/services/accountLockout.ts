import { eq } from 'drizzle-orm';
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
 */
export async function recordFailedLogin(userId: string): Promise<{ locked: boolean; attemptsLeft: number }> {
  const userRows = await db.select({ failedLoginAttempts: users.failedLoginAttempts })
    .from(users).where(eq(users.id, userId)).limit(1);
  const current = userRows[0]?.failedLoginAttempts ?? 0;
  const newCount = current + 1;

  if (newCount >= MAX_ATTEMPTS) {
    const lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000).toISOString();

    await db.update(users).set({
      failedLoginAttempts: newCount,
      lockedUntil,
    }).where(eq(users.id, userId));

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
        MailService.sendAccountLocked(userRow[0].email, userRow[0].name, LOCKOUT_MINUTES).catch(() => {});
      }
    } catch { /* best-effort */ }

    return { locked: true, attemptsLeft: 0 };
  }

  await db.update(users).set({
    failedLoginAttempts: newCount,
  }).where(eq(users.id, userId));

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
