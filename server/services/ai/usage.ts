import { db } from '../../db/postgres.js';
import { aiUsageLog } from '../../db/schema.js';
import logger from '../../utils/logger.js';
import type { AiUsageEntry } from './types.js';

/**
 * Log an AI usage event to the database.
 * Fire-and-forget — errors are logged but never thrown.
 */
export async function logUsage(entry: AiUsageEntry): Promise<void> {
  try {
    await db.insert(aiUsageLog).values({
      id: crypto.randomUUID(),
      partnerId: entry.partnerId,
      userId: entry.userId,
      action: entry.action,
      provider: entry.provider,
      model: entry.model,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      latencyMs: entry.latencyMs,
      success: entry.success,
      errorMessage: entry.errorMessage ?? null,
    });
  } catch (err) {
    logger.error({ err, entry }, 'Failed to log AI usage');
  }
}
