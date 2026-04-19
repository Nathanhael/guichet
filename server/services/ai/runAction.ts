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
import { getAiContext } from './context.js';

type AiFeature =
  | 'messageImprovement'
  | 'chatSummarization'
  | 'translation'
  | 'autoSummarizeOnClose';

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
 */
export async function runAiAction(
  opts: RunAiActionOpts,
): Promise<{ content: string; model: string }> {
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

  // 3. Build prompt
  const template = await getPromptTemplate(opts.action, opts.partnerId);
  const prompt = interpolate(template, opts.vars);

  // 4. Call provider
  const provider = await getProvider(opts.partnerId);
  const start = Date.now();

  try {
    const result = await provider.chat({
      model: 'default',
      messages: [{ role: 'user', content: prompt }],
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
    });

    // 5. Log usage (fire-and-forget)
    logUsage({
      partnerId: opts.partnerId,
      userId: opts.userId,
      action: opts.action,
      provider: provider.name,
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      latencyMs: Date.now() - start,
      success: true,
    });

    return { content: result.content, model: result.model };
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
    });

    logger.error({ err: errorMessage, action: opts.action, partnerId: opts.partnerId }, 'AI action failed');
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'AI service unavailable. Please try again later.',
    });
  }
}
