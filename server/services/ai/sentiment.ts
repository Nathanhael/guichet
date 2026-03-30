// ─── AI Sentiment Scoring ─────────────────────────────────────────────────
//
// Fire-and-forget: scores message sentiment and persists to DB.
// Never throws — all errors are caught and logged.

import { isFeatureEnabled, getProvider, getPromptTemplate, interpolate, logUsage, checkRateLimit } from './index.js';
import { eq } from 'drizzle-orm';
import { getAiContext } from './context.js';

/**
 * Parse a sentiment score from AI response text.
 * Extracts the first float-like number and clamps to [-1.0, 1.0].
 * Returns null if no valid number found.
 */
export function parseSentimentScore(raw: string): number | null {
  const trimmed = raw.trim();
  const match = trimmed.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;

  const value = parseFloat(match[0]);
  if (!isFinite(value)) return null;

  return Math.max(-1.0, Math.min(1.0, value));
}

/**
 * Score the sentiment of a message and persist to DB.
 * Fire-and-forget — never throws.
 */
export async function scoreSentiment(
  partnerId: string,
  userId: string,
  messageId: string,
  text: string,
): Promise<void> {
  const { db, logger, schema } = getAiContext();
  const { messages } = schema as any;

  try {
    // 1. Feature gate
    const enabled = await isFeatureEnabled(partnerId, 'sentimentDetection');
    if (!enabled) return;

    // 2. Rate limit check
    const limit = await checkRateLimit(partnerId);
    if (!limit.allowed) {
      logger.debug({ partnerId, messageId }, '[sentiment] Rate limit hit, skipping');
      return;
    }

    // 3. Build prompt
    const template = await getPromptTemplate('sentiment', partnerId);
    const prompt = interpolate(template, { text });

    // 4. Call provider
    const provider = await getProvider(partnerId);
    const start = Date.now();

    const result = await provider.chat({
      model: 'default',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      maxTokens: 10,
    });

    const latencyMs = Date.now() - start;

    // 5. Parse and clamp score
    const score = parseSentimentScore(result.content);

    if (score === null) {
      logger.warn({ messageId, raw: result.content }, '[sentiment] Could not parse score from AI response');
      logUsage({
        partnerId,
        userId,
        action: 'sentiment',
        provider: provider.name,
        model: result.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        latencyMs,
        success: false,
        errorMessage: `Unparseable response: ${result.content}`,
      });
      return;
    }

    // 6. Persist to DB
    await db
      .update(messages)
      .set({ sentiment: score })
      .where(eq(messages.id, messageId));

    // 7. Log usage
    logUsage({
      partnerId,
      userId,
      action: 'sentiment',
      provider: provider.name,
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      latencyMs,
      success: true,
    });

    logger.debug({ messageId, score }, '[sentiment] Scored message');
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), messageId },
      '[sentiment] Failed to score message',
    );
  }
}
