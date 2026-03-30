import type { AiUsageEntry } from './types.js';
import { getAiContext } from './context.js';

/**
 * Log an AI usage event to the database.
 * Fire-and-forget — errors are logged but never thrown.
 */
export async function logUsage(entry: AiUsageEntry): Promise<void> {
  const { db, logger, schema } = getAiContext();
  const { aiUsageLog } = schema as any;

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
