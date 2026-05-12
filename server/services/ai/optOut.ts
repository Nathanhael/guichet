/**
 * Per-membership AI opt-out lookup.
 *
 * When a worker enables the "Anonimiseer mijn AI-gebruik" toggle in their
 * profile, `memberships.aiOptOut` flips to true. From that moment, every
 * AI-call this worker triggers writes log rows with `user_id = NULL`. The
 * functional behaviour (improve / translate / suggest / etc.) is unchanged
 * — only the personal traceability is severed.
 *
 * `isUserOptedOut` is called from `runAiAction` on every AI call, so it
 * must be cheap. Redis caches the boolean per `{partnerId, userId}` for
 * 60 seconds; longer windows would delay toggle-effect after the user
 * flips the switch.
 *
 * Cache invalidation is triggered explicitly from the `ai.setOptOut`
 * mutation in the tRPC router, so the local user sees their change take
 * effect within one request round-trip even if the TTL hasn't elapsed.
 *
 * See: docs/superpowers/plans/2026-05-12-ai-opt-out-anonymization.md
 *      docs/WORKS_COUNCIL_DISCLOSURE.md §5
 */

import { eq, and } from 'drizzle-orm';
import { getAiContext } from './context.js';

const CACHE_TTL_SECONDS = 60;

function cacheKey(partnerId: string, userId: string): string {
  return `ai:optout:${partnerId}:${userId}`;
}

/**
 * Returns true if this user has opted out of personal AI tracking for the
 * given partner. Falls back to false on any error — failing closed here
 * would silently disable AI for everyone if Redis or the DB hiccups.
 */
export async function isUserOptedOut(partnerId: string, userId: string): Promise<boolean> {
  const { redis, db, schema, logger } = getAiContext();

  if (redis) {
    try {
      const cached = await redis.get(cacheKey(partnerId, userId));
      if (cached === '1') return true;
      if (cached === '0') return false;
    } catch (err) {
      logger.warn({ err, partnerId, userId }, 'opt-out cache read failed');
    }
  }

  let optedOut: boolean;
  try {
    const rows = await db
      .select({ aiOptOut: schema.memberships.aiOptOut })
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.partnerId, partnerId),
          eq(schema.memberships.userId, userId),
        ),
      )
      .limit(1);
    optedOut = rows[0]?.aiOptOut === true;
  } catch (err) {
    logger.warn({ err, partnerId, userId }, 'opt-out DB lookup failed');
    return false;
  }

  if (redis) {
    try {
      await redis.set(cacheKey(partnerId, userId), optedOut ? '1' : '0', { EX: CACHE_TTL_SECONDS });
    } catch (err) {
      logger.warn({ err, partnerId, userId }, 'opt-out cache write failed');
    }
  }

  return optedOut;
}

/**
 * Drop the cached opt-out flag for this membership. Called from the
 * `ai.setOptOut` mutation after a DB update so the next AI call observes
 * the new state immediately, not after the 60 s TTL.
 */
export async function invalidateOptOutCache(partnerId: string, userId: string): Promise<void> {
  const { redis, logger } = getAiContext();
  if (!redis) return;
  try {
    await redis.del(cacheKey(partnerId, userId));
  } catch (err) {
    logger.warn({ err, partnerId, userId }, 'opt-out cache invalidate failed');
  }
}
