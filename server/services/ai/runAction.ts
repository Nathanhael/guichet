/**
 * Shared AI action runner with rate-limiting, logging, and feature gating.
 *
 * Used by both the tRPC ai router and the fire-and-forget autoSummarize
 * service. Extracted to avoid duplicating the gate → limit → prompt → call → log
 * pipeline in multiple places.
 */

import { TRPCError } from '@trpc/server';
import type { AiAction } from './types.js';
import {
  isFeatureEnabled,
  getProvider,
  getPromptTemplate,
  interpolate,
  checkRateLimit,
  logUsage,
} from './index.js';
import { stripPromptArtifacts } from './prompts.js';
import { getAiContext } from './context.js';
import { getEffectiveAuditVerbosity } from './auditVerbosity.js';
import { applyPartnerCustomization } from './promptCustomization.js';

type AiFeature =
  | 'messageImprovement'
  | 'translation'
  | 'cannedTranslation';

interface RunAiActionOpts {
  partnerId: string;
  userId: string;
  feature: AiFeature;
  action: AiAction;
  vars: Record<string, string>;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Run an AI action with the full gate → limit → prompt → call → log pipeline.
 * Throws TRPCError on feature-disabled, rate-limited, or provider failure.
 *
 * The returned `usageLogId` is the row id of the persisted ai_usage_log entry
 * (or null if the DB write failed). Callers expose it to the client when
 * follow-up annotations matter — e.g. ai.markImproveResult / ai.submitFeedback.
 */
export async function runAiAction(
  opts: RunAiActionOpts,
): Promise<{ content: string; model: string; usageLogId: string | null }> {
  const { logger } = getAiContext();

  // 1. Feature gate
  const enabled = await isFeatureEnabled(opts.partnerId, opts.feature);
  if (!enabled) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `AI feature "${opts.feature}" is not enabled for this tenant`,
    });
  }

  // 2. Rate limit
  const limit = await checkRateLimit(opts.partnerId);
  if (!limit.allowed) {
    throw new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message: `Rate limit exceeded (${limit.limitHit}). Retry after ${limit.retryAfterSeconds}s`,
    });
  }

  // 3. Build prompt — apply partner glossary + custom-instruction prefix
  //    BEFORE interpolating user vars. Glossary placeholders ({{preserve_terms}},
  //    {{forbidden_terms}}) must be substituted before interpolate runs, since
  //    interpolate replaces any unknown {{x}} with empty string.
  const template = await getPromptTemplate(opts.action, opts.partnerId);
  const customized = await applyPartnerCustomization(template, opts.action, opts.partnerId);
  const prompt = interpolate(customized, opts.vars);

  // 4. Call provider
  const provider = await getProvider(opts.partnerId);
  const start = Date.now();

  // Slice 2.5: gate full prompt/response capture on partner audit verbosity.
  const verbosity = await getEffectiveAuditVerbosity(opts.partnerId);
  const captureFull = verbosity === 'full';

  try {
    const result = await provider.chat({
      model: 'default',
      messages: [{ role: 'user', content: prompt }],
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
    });

    // Strip any prompt-template boundary tags the model may have echoed back.
    // Cheaper models occasionally include the `<user_content>` delimiters in
    // their reply despite the "Reply with ONLY ..." instruction — those leak
    // into chat bubbles and translation caches if not sanitized here.
    const cleaned = stripPromptArtifacts(result.content);

    // 5. Log usage and capture the row id for caller-side annotations.
    const usageLogId = await logUsage({
      partnerId: opts.partnerId,
      userId: opts.userId,
      action: opts.action,
      provider: provider.name,
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      latencyMs: Date.now() - start,
      success: true,
      prompt: captureFull ? prompt : undefined,
      response: captureFull ? cleaned : undefined,
    });

    return { content: cleaned, model: result.model, usageLogId };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const errorMessage = err instanceof Error ? err.message : String(err);

    logUsage({
      partnerId: opts.partnerId,
      userId: opts.userId,
      action: opts.action,
      provider: provider.name,
      model: 'unknown',
      inputTokens: 0,
      outputTokens: 0,
      latencyMs,
      success: false,
      errorMessage,
      prompt: captureFull ? prompt : undefined,
    });

    logger.error({ err: errorMessage, action: opts.action, partnerId: opts.partnerId }, 'AI action failed');
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'AI service unavailable. Please try again later.',
    });
  }
}
