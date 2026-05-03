import type { AiUsageEntry } from './types.js';
import { getAiContext } from './context.js';

/**
 * Log an AI usage event to the database.
 * Returns the inserted row id (so callers can later annotate the row, e.g.
 * via ai.markImproveResult). Returns null on DB failure — fire-and-forget
 * semantics are preserved at the call site.
 */
export async function logUsage(entry: AiUsageEntry): Promise<string | null> {
  const { db, logger, schema } = getAiContext();
  const { aiUsageLog } = schema;
  const id = crypto.randomUUID();

  // Slice 2.5 / 7: only populate metadata when caller passed full content.
  // Storage of prompt/response is gated upstream by audit verbosity in runAiAction.
  const metadata: Record<string, unknown> = {};
  if (entry.prompt !== undefined) metadata.prompt = entry.prompt;
  if (entry.response !== undefined) metadata.response = entry.response;
  const metadataValue = Object.keys(metadata).length > 0 ? metadata : null;

  try {
    await db.insert(aiUsageLog).values({
      id,
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
      metadata: metadataValue,
    });
    return id;
  } catch (err) {
    logger.error({ err, entry }, 'Failed to log AI usage');
    return null;
  }
}
