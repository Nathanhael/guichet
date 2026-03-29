import crypto from 'crypto';
import { eq, and, isNull, lt } from 'drizzle-orm';
import { db, transaction } from '../db.js';
import { refreshTokens } from '../db/schema.js';
import config from '../config.js';
import { parseExpiryToSeconds } from './authSession.js';
import logger from '../utils/logger.js';

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function createRefreshToken(userId: string): Promise<{ token: string; family: string; expiresAt: string }> {
  const token = crypto.randomBytes(32).toString('hex');
  const family = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + parseExpiryToSeconds(config.REFRESH_TOKEN_EXPIRY) * 1000).toISOString();

  await db.insert(refreshTokens).values({
    userId,
    tokenHash: hashToken(token),
    family,
    expiresAt,
  });

  return { token, family, expiresAt };
}

export async function rotateRefreshToken(oldToken: string): Promise<{ token: string; userId: string; family: string; expiresAt: string } | null> {
  const oldHash = hashToken(oldToken);

  const rows = await db.select()
    .from(refreshTokens)
    .where(and(
      eq(refreshTokens.tokenHash, oldHash),
      isNull(refreshTokens.revokedAt),
    ))
    .limit(1);

  const existing = rows[0];
  if (!existing) {
    // Token not found or already revoked — possible replay attack
    // Check if this hash was ever used (reuse detection)
    const usedRows = await db.select({ family: refreshTokens.family })
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, oldHash))
      .limit(1);

    if (usedRows[0]) {
      // Reuse detected — revoke entire family
      logger.warn({ family: usedRows[0].family }, '[refresh] Token reuse detected, revoking family');
      await revokeFamily(usedRows[0].family);
    }
    return null;
  }

  // Check expiry
  if (new Date(existing.expiresAt) < new Date()) {
    return null;
  }

  // Generate new token values before entering the transaction (no DB access needed)
  const newToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + parseExpiryToSeconds(config.REFRESH_TOKEN_EXPIRY) * 1000).toISOString();

  // Atomically revoke old token and issue new one — prevents crash-between-ops lockout
  await transaction(async (tx) => {
    await tx.update(refreshTokens)
      .set({ revokedAt: new Date().toISOString() })
      .where(eq(refreshTokens.id, existing.id));

    await tx.insert(refreshTokens).values({
      userId: existing.userId,
      tokenHash: hashToken(newToken),
      family: existing.family,
      expiresAt,
    });
  });

  return { token: newToken, userId: existing.userId, family: existing.family, expiresAt };
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
  const graceDays = 7;
  const expirySeconds = parseExpiryToSeconds(config.REFRESH_TOKEN_EXPIRY);
  const cutoffMs = (expirySeconds * 1000) + (graceDays * 24 * 60 * 60 * 1000);
  const cutoff = new Date(Date.now() - cutoffMs).toISOString();

  const result = await db.delete(refreshTokens)
    .where(lt(refreshTokens.expiresAt, cutoff));

  return Array.isArray(result) ? result.length : 0;
}
