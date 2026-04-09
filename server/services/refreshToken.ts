import crypto from 'crypto';
import { eq, and, isNull, lt, sql } from 'drizzle-orm';
import { db } from '../db.js';
import { refreshTokens } from '../db/schema.js';
import config from '../config.js';
import { parseExpiryToSeconds } from './authSession.js';
import logger from '../utils/logger.js';

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function createRefreshToken(userId: string, partnerId?: string): Promise<{ token: string; family: string; expiresAt: string }> {
  const token = crypto.randomBytes(32).toString('hex');
  const family = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + parseExpiryToSeconds(config.REFRESH_TOKEN_EXPIRY) * 1000).toISOString();

  await db.insert(refreshTokens).values({
    userId,
    tokenHash: hashToken(token),
    family,
    partnerId: partnerId ?? null,
    expiresAt,
  });

  return { token, family, expiresAt };
}

export async function rotateRefreshToken(oldToken: string): Promise<{ token: string; userId: string; family: string; partnerId: string | null; expiresAt: string } | null> {
  const oldHash = hashToken(oldToken);

  // Atomic claim: revoke the old token and return its data in a single statement.
  // If two concurrent requests race, only the first gets a row back.
  // The second sees zero rows and enters the reuse-detection path.
  // TRADEOFF: The old design wrapped revoke+insert in a transaction to prevent
  // crash-between-ops lockout. This atomic UPDATE trades that crash-recovery
  // guarantee for race-condition safety — if the process crashes between the
  // UPDATE and the INSERT below, the user loses their refresh family and must
  // re-login. This is acceptable: the crash window is microseconds, while the
  // race condition was hit routinely by multi-tab browsers.
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

  // Issue the new token (insert only — old token already revoked above)
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

export async function revokeFamily(family: string): Promise<void> {
  await db.update(refreshTokens)
    .set({ revokedAt: new Date().toISOString() })
    .where(and(
      eq(refreshTokens.family, family),
      isNull(refreshTokens.revokedAt),
    ));
}

export async function revokeAllUserRefreshTokens(userId: string): Promise<void> {
  await db.update(refreshTokens)
    .set({ revokedAt: new Date().toISOString() })
    .where(and(
      eq(refreshTokens.userId, userId),
      isNull(refreshTokens.revokedAt),
    ));
}

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
