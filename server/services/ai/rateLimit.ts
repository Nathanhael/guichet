import { getAiRedis } from './redis.js';
import logger from '../../utils/logger.js';

// ─── Rate Limiter for AI calls ──────────────────────────────────────────────
// Per-partner Redis counters with minute and daily windows.

const DEFAULT_PER_MINUTE = 30;
const DEFAULT_PER_DAY = 1000;

/**
 * HI-03 fix: Dual-key rate limit script that checks minute limit BEFORE incrementing day.
 * Prevents counter inflation where minute passes but day fails (minute already incremented).
 *
 * KEYS[1] = minute key, KEYS[2] = day key
 * ARGV[1] = minute TTL, ARGV[2] = day TTL, ARGV[3] = per-minute limit, ARGV[4] = per-day limit
 * Returns: { minuteCount, dayCount, blocked, limitHit }
 */
const DUAL_RATE_LIMIT_SCRIPT = `
  local minuteCount = redis.call('INCR', KEYS[1])
  if minuteCount == 1 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
  end
  if minuteCount > tonumber(ARGV[3]) then
    redis.call('DECR', KEYS[1])
    return { 0, 0, 1, 1 }
  end
  local dayCount = redis.call('INCR', KEYS[2])
  if dayCount == 1 then
    redis.call('EXPIRE', KEYS[2], ARGV[2])
  end
  if dayCount > tonumber(ARGV[4]) then
    redis.call('DECR', KEYS[1])
    redis.call('DECR', KEYS[2])
    return { 0, 0, 1, 2 }
  end
  return { minuteCount, dayCount, 0, 0 }
`;

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
 * Uses a Lua script for atomic INCR + EXPIRE to prevent TTL race conditions.
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

    // HI-03 fix: Single atomic Lua script checks minute before incrementing day,
    // preventing counter inflation under concurrent load.
    const result = await r.eval(DUAL_RATE_LIMIT_SCRIPT, {
      keys: [minuteKey, dayKey],
      arguments: ['60', '86400', String(perMinute), String(perDay)],
    }) as number[];

    const blocked = Number(result[2]);
    const limitHit = Number(result[3]);

    if (blocked) {
      if (limitHit === 1) {
        return { allowed: false, retryAfterSeconds: 60, limitHit: 'minute' };
      }
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
