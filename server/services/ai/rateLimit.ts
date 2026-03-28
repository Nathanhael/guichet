import { getAiRedis } from './redis.js';
import logger from '../../utils/logger.js';

// ─── Rate Limiter for AI calls ──────────────────────────────────────────────
// Per-partner Redis counters with minute and daily windows.

const DEFAULT_PER_MINUTE = 30;
const DEFAULT_PER_DAY = 1000;

/**
 * Lua script that atomically increments a key and sets its TTL on first creation.
 * This eliminates the race condition where a process could die between INCR and EXPIRE,
 * leaving a key without a TTL that never gets cleaned up.
 *
 * KEYS[1] = the rate limit key
 * ARGV[1] = TTL in seconds
 * Returns: the new count after increment
 */
const RATE_LIMIT_SCRIPT = `
  local count = redis.call('INCR', KEYS[1])
  if count == 1 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
  end
  return count
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

    // Atomic INCR + EXPIRE via Lua script — no TTL gap on process death
    const newMinuteCount = Number(await r.eval(RATE_LIMIT_SCRIPT, { keys: [minuteKey], arguments: ['60'] }));
    const newDayCount = Number(await r.eval(RATE_LIMIT_SCRIPT, { keys: [dayKey], arguments: ['86400'] }));

    // Check limits after incrementing — decrement if over-limit.
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
