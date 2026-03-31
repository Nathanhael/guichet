import { getAiContext } from './context.js';

const SUMMARY_TTL = 30 * 60; // 30 minutes

function key(ticketId: string): string {
  return `ai:summary:${ticketId}`;
}

/**
 * Get a cached AI summary for a ticket.
 */
export async function getCachedSummary(ticketId: string): Promise<string | null> {
  try {
    const { redis: r } = getAiContext();
    if (!r) return null;
    return await r.get(key(ticketId));
  } catch {
    return null;
  }
}

/**
 * Store an AI summary in cache with TTL.
 */
export async function setCachedSummary(ticketId: string, summary: string): Promise<void> {
  try {
    const { redis: r } = getAiContext();
    if (!r) return;
    await r.set(key(ticketId), summary, { EX: SUMMARY_TTL });
  } catch (err) {
    const { logger } = getAiContext();
    logger.warn({ err, ticketId }, 'Failed to cache AI summary');
  }
}

/**
 * Invalidate a cached summary (e.g., when new messages arrive).
 */
export async function invalidateSummary(ticketId: string): Promise<void> {
  try {
    const { redis: r } = getAiContext();
    if (!r) return;
    await r.del(key(ticketId));
  } catch {
    // Silently ignore — worst case the summary is stale
  }
}
