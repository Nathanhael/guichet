import { getAiRedis } from './redis.js';
import logger from '../../utils/logger.js';

// ─── Rate Limiter for AI calls ──────────────────────────────────────────────
// Per-partner Redis counters with minute and daily windows.

const DEFAULT_PER_MINUTE = 30;
const DEFAULT_PER_DAY = 1000;

interface RateLimitConfig {
  perMinute?: number;
  perDay?: number;
}

interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
  /** Which limit was hit: 'minute' | 'day' */
  limitHit?: 'minute' | 'day';
}

/**
 * Check and increment the rate limit for a partner's AI usage.
 * Uses atomic MULTI/EXEC to avoid TOCTOU race conditions.
 * Returns { allowed: true } if the request can proceed.
 */
export async function checkRateLimit(
  partnerId: string,
  limits?: RateLimitConfig,
): Promise<RateLimitResult> {
  const perMinute = limits?.perMinute ?? DEFAULT_PER_MINUTE;
  const perDay = limits?.perDay ?? DEFAULT_PER_DAY;

  try {
    const r = await getAiRedis();
    const minuteKey = `ai:rate:${partnerId}:minute`;
    const dayKey = `ai:rate:${partnerId}:day`;

    // Atomic: increment both counters and set TTL if new
    const multi = r.multi();
    multi.incr(minuteKey);
    multi.ttl(minuteKey);
    multi.incr(dayKey);
    multi.ttl(dayKey);
    const results = await multi.exec();

    // results: [minuteCount, minuteTtl, dayCount, dayTtl]
    const minuteCount = Number(results[0]);
    const minuteTtl = Number(results[1]);
    const dayCount = Number(results[2]);
    const dayTtl = Number(results[3]);

    // Set expiry for new keys (TTL -1 means no expiry set yet)
    if (minuteTtl === -1) await r.expire(minuteKey, 60);
    if (dayTtl === -1) await r.expire(dayKey, 86400);

    if (minuteCount > perMinute) {
      return { allowed: false, retryAfterSeconds: Math.max(minuteTtl, 1), limitHit: 'minute' };
    }

    if (dayCount > perDay) {
      return { allowed: false, retryAfterSeconds: Math.max(dayTtl, 1), limitHit: 'day' };
    }

    return { allowed: true };
  } catch (err) {
    // If Redis is down, allow the request but log a warning
    logger.warn({ err, partnerId }, 'AI rate-limit check failed — allowing request');
    return { allowed: true };
  }
}

/**
 * Get current usage counts for a partner (for admin dashboards).
 */
export async function getUsageCounts(partnerId: string): Promise<{ minute: number; day: number }> {
  try {
    const r = await getAiRedis();
    const [minute, day] = await Promise.all([
      r.get(`ai:rate:${partnerId}:minute`),
      r.get(`ai:rate:${partnerId}:day`),
    ]);
    return { minute: parseInt(minute ?? '0', 10), day: parseInt(day ?? '0', 10) };
  } catch {
    return { minute: 0, day: 0 };
  }
}
