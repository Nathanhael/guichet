import { getRedisClients } from '../utils/redis.js';
import logger from '../utils/logger.js';
import { revokeAllUserRefreshTokens } from './refreshToken.js';

const REVOKED_TOKEN_PREFIX = 'auth:revoked:jti:';
const USER_REVOKED_AFTER_PREFIX = 'auth:user:revoked_after:';
const USER_REVOKED_AFTER_TTL_SECONDS = 90 * 24 * 60 * 60;

function revokedTokenKey(jti: string): string {
  return `${REVOKED_TOKEN_PREFIX}${jti}`;
}

function userRevokedAfterKey(userId: string): string {
  return `${USER_REVOKED_AFTER_PREFIX}${userId}`;
}

export async function revokeToken(jti: string, exp?: number): Promise<boolean> {
  const { pubClient } = getRedisClients();
  if (!jti) return false;
  if (!pubClient) {
    logger.warn({ jti }, 'Redis unavailable — token revocation could not be persisted');
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  const ttl = Math.max((exp ?? now + 60) - now, 60);

  try {
    await pubClient.set(revokedTokenKey(jti), '1', { EX: ttl });
    return true;
  } catch (err) {
    logger.error({ err, jti }, 'Failed to revoke token');
    return false;
  }
}

export async function revokeUserSessions(userId: string, revokedAfter?: number): Promise<number> {
  const { pubClient } = getRedisClients();
  const cutoff = revokedAfter ?? Math.floor(Date.now() / 1000);

  // Also revoke all refresh tokens for this user
  try {
    await revokeAllUserRefreshTokens(userId);
  } catch (err) {
    logger.error({ err, userId }, 'Failed to revoke user refresh tokens during session revocation');
  }

  if (!pubClient) return cutoff;

  try {
    await pubClient.set(userRevokedAfterKey(userId), String(cutoff), { EX: USER_REVOKED_AFTER_TTL_SECONDS });
  } catch (err) {
    logger.error({ err, userId }, 'Failed to revoke user sessions');
  }

  return cutoff;
}

export interface RevocationPayload {
  userId: string;
  jti?: string;
  iat?: number;
}

export async function isRevoked(payload: RevocationPayload): Promise<boolean> {
  const { pubClient } = getRedisClients();
  if (!pubClient) {
    // Fail closed: if Redis is unavailable, we cannot verify revocation status.
    // Treat as revoked to prevent use of potentially compromised tokens.
    logger.warn({ userId: payload.userId }, 'Redis unavailable — failing closed on revocation check');
    return true;
  }

  try {
    if (payload.jti) {
      const tokenRevoked = await pubClient.exists(revokedTokenKey(payload.jti));
      if (tokenRevoked) {
        return true;
      }
    }

    const revokedAfterRaw = await pubClient.get(userRevokedAfterKey(payload.userId));
    if (!revokedAfterRaw) {
      return false;
    }

    const revokedAfter = parseInt(revokedAfterRaw, 10);
    return Number.isFinite(revokedAfter) && !!payload.iat && payload.iat <= revokedAfter;
  } catch (err) {
    logger.error({ err, userId: payload.userId }, 'Failed to check token revocation — failing closed');
    // Fail closed on errors too
    return true;
  }
}
