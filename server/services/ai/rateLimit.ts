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

    // Atomic increment-first: avoids TOCTOU race where two concurrent
    // requests both read the same count and both pass the check.
    const multi = r.multi();
    multi.incr(minuteKey);
    multi.incr(dayKey);
    const results = await multi.exec();

    const newMinuteCount = Number(results[0]);
    const newDayCount = Number(results[1]);

    // Set expiry only on first increment (fixed window)
    if (newMinuteCount === 1) await r.expire(minuteKey, 60);
    if (newDayCount === 1) await r.expire(dayKey, 86400);

    // Check limits after incrementing — decrement if over-limit
    if (newMinuteCount > perMinute) {
      await r.decr(minuteKey);
      return { allowed: false, retryAfterSeconds: 60, limitHit: 'minute' };
    }

    if (newDayCount > perDay) {
      await r.decr(dayKey);
      return { allowed: false, retryAfterSeconds: 86400, limitHit: 'day' };
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
