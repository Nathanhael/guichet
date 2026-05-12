import { z } from 'zod';
import { eq, and, count } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { router, partnerScopedProcedure, partnerAdminProcedure } from '../trpc.js';
import { notFound } from '../../utils/trpcErrors.js';
import { db } from '../../db.js';
import { aiUsageLog, aiFeedback, memberships } from '../../db/schema.js';
import {
  runAiAction,
  getCachedTranslation,
  setCachedTranslation,
  getProvider,
  getEffectiveAiConfig,
  isUserOptedOut,
  invalidateOptOutCache,
} from '../../services/ai/index.js';
import { getEffectiveAuditVerbosity } from '../../services/ai/auditVerbosity.js';
import { shouldSkipTranslation } from '../../services/ai/translateGuards.js';

// k-anonymity threshold for the admin-facing opt-out count. Below this many
// active memberships, an aggregate count can leak identity by elimination
// in small teams — so the AdminAi panel shows "—" with an explanatory tooltip.
const ANONYMIZATION_COUNT_MIN_GROUP = 5;

export const aiRouter = router({
  /**
   * Improve a message — rewrites for clarity and professionalism.
   * Available to both agents and support staff.
   */
  improveMessage: partnerScopedProcedure
    .input(z.object({
      text: z.string().min(10, 'Message must be at least 10 characters').max(5000, 'Message too long (max 5000 chars)'),
      role: z.enum(['agent', 'support']),
    }))
    .mutation(async ({ input, ctx }) => {
      const partnerId = ctx.user.partnerId;

      // Pre-flight skip: digits / punctuation / emoji-only inputs don't
      // have semantic content to improve. Cheaper models reply with a
      // meta-refusal ("I'm sorry, that looks like placeholder text...")
      // which then opens the diff modal with junk. Reject upstream so the
      // forced-mode caller falls through to a direct send and the optional-
      // mode caller silently no-ops.
      if (shouldSkipTranslation(input.text)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'No improvable content in this message',
        });
      }

      const result = await runAiAction({
        partnerId,
        userId: ctx.user.id,
        feature: 'messageImprovement',
        action: 'improve',
        vars: {
          text: input.text,
          role: input.role,
        },
        temperature: 0.4,
        maxTokens: 1024,
      });

      // usageLogId lets the client annotate the row later (slice 7 thumbs
      // feedback + sentOriginal tracking via ai.markImproveResult / submitFeedback).
      return { improved: result.content.trim(), usageLogId: result.usageLogId };
    }),

  /**
   * Translate a message to a target language.
   * Used for on-the-fly translation when senderLang !== viewerLang.
   */
  translateMessage: partnerScopedProcedure
    .input(z.object({
      messageId: z.string(),
      text: z.string().min(1).max(5000, 'Message too long (max 5000 chars)'),
      targetLang: z.enum(['nl', 'en', 'fr']),
    }))
    .mutation(async ({ input, ctx }) => {
      const partnerId = ctx.user.partnerId;

      // Digits/whitespace/punctuation-only inputs are not translation-worthy
      // and cheaper models reply with meta-refusals on these. Echo the source
      // and cache it so the on-mount auto-fire stays a noop next time.
      if (shouldSkipTranslation(input.text)) {
        await setCachedTranslation(input.messageId, input.targetLang, input.text);
        return { translated: input.text };
      }

      // Cache check first — auto-fire on every mount means many cache hits.
      const cached = await getCachedTranslation(input.messageId, input.targetLang);
      if (cached) return { translated: cached };

      const result = await runAiAction({
        partnerId,
        userId: ctx.user.id,
        feature: 'translation',
        action: 'translate',
        vars: {
          text: input.text,
          targetLang: input.targetLang === 'nl' ? 'Dutch' : input.targetLang === 'fr' ? 'French' : 'English',
        },
        temperature: 0.3,
        maxTokens: 1024,
      });

      const translated = result.content.trim();
      await setCachedTranslation(input.messageId, input.targetLang, translated);

      return { translated };
    }),

  /**
   * Health check — used by the client to gate AI-driven UI affordances
   * (mic button, improve button) when the provider is unreachable.
   * Reuses the provider's internal isAvailable() cache.
   */
  healthCheck: partnerScopedProcedure.query(async ({ ctx }) => {
    let available: boolean;
    try {
      const provider = await getProvider(ctx.user.partnerId);
      available = await provider.isAvailable();
    } catch {
      available = false;
    }
    return { available, lastChecked: new Date().toISOString() };
  }),

  /**
   * Mark whether the user sent the AI-improved message or reverted to the original.
   * Decision 30: persists the final user choice as a side-channel on the existing
   * ai_usage_log row via metadata.sentOriginal — no new table for this signal.
   *
   * Multi-tenant guard: row lookup filters by (id AND partnerId) so a caller can
   * never poke at another partner's usage log.
   */
  markImproveResult: partnerScopedProcedure
    .input(z.object({
      usageLogId: z.string(),
      sentOriginal: z.boolean(),
    }))
    .mutation(async ({ input, ctx }) => {
      const partnerId = ctx.user.partnerId;

      const rows = await db
        .select()
        .from(aiUsageLog)
        .where(and(eq(aiUsageLog.id, input.usageLogId), eq(aiUsageLog.partnerId, partnerId)))
        .limit(1);

      const row = rows[0];
      if (!row) throw notFound('AI usage log');

      // Preserve any existing metadata keys (e.g. cache hit flags, debug breadcrumbs)
      // so this mutation only affects the sentOriginal axis.
      const existing = (row.metadata && typeof row.metadata === 'object') ? row.metadata as Record<string, unknown> : {};
      const merged = { ...existing, sentOriginal: input.sentOriginal };

      await db
        .update(aiUsageLog)
        .set({ metadata: merged })
        .where(and(eq(aiUsageLog.id, input.usageLogId), eq(aiUsageLog.partnerId, partnerId)))
        .returning();

      return { ok: true };
    }),

  /**
   * Record thumbs-up/down feedback on an AI output (decision 29).
   * Body fields (originalText, aiOutput) are persisted ONLY when the partner's
   * effective audit verbosity is 'full'. Otherwise we keep just the rating +
   * comment + linkage — no message content lands in ai_feedback.
   *
   * When the caller has `memberships.aiOptOut = true`, `userId` is written as
   * NULL so the feedback row carries no personal trace (mirrors the
   * `ai_usage_log` anonymization in `runAiAction`).
   */
  submitFeedback: partnerScopedProcedure
    .input(z.object({
      usageLogId: z.string(),
      rating: z.enum(['up', 'down']),
      comment: z.string().max(500).optional(),
      originalText: z.string().optional(),
      aiOutput: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const partnerId = ctx.user.partnerId;

      const rows = await db
        .select()
        .from(aiUsageLog)
        .where(and(eq(aiUsageLog.id, input.usageLogId), eq(aiUsageLog.partnerId, partnerId)))
        .limit(1);

      const usageRow = rows[0];
      if (!usageRow) throw notFound('AI usage log');

      const verbosity = await getEffectiveAuditVerbosity(partnerId);
      const persistBody = verbosity === 'full';

      const anonymize = await isUserOptedOut(partnerId, ctx.user.id);

      const inserted = await db
        .insert(aiFeedback)
        .values({
          partnerId,
          userId: anonymize ? null : ctx.user.id,
          action: usageRow.action,
          usageLogId: input.usageLogId,
          rating: input.rating,
          comment: input.comment ?? null,
          originalText: persistBody ? (input.originalText ?? null) : null,
          aiOutput: persistBody ? (input.aiOutput ?? null) : null,
          userFinalChoice: null,
        })
        .returning();

      const feedbackId = inserted[0]?.id ?? '';
      return { feedbackId };
    }),

  /**
   * Effective AI config for the calling user, after applying their own
   * `memberships.aiOptOut` to the partner-level config. The client uses this
   * to decide whether `forced` improve mode is in effect, and to render the
   * profile toggle's state and help-text.
   */
  getEffectiveConfig: partnerScopedProcedure.query(async ({ ctx }) => {
    return await getEffectiveAiConfig(ctx.user.partnerId, ctx.user.id);
  }),

  /**
   * Flip the caller's `memberships.aiOptOut`. Deliberately does NOT emit an
   * `audit_log` row — recording the toggle action with `userId` would
   * undermine the very anonymization the toggle exists to grant
   * (would create a permanent WORM-keten entry tying the worker to the
   * privacy choice). See plan §Decision 6.
   */
  setOptOut: partnerScopedProcedure
    .input(z.object({ optOut: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const partnerId = ctx.user.partnerId;
      await db
        .update(memberships)
        .set({ aiOptOut: input.optOut })
        .where(and(eq(memberships.userId, ctx.user.id), eq(memberships.partnerId, partnerId)));
      await invalidateOptOutCache(partnerId, ctx.user.id);
      return { ok: true };
    }),

  /**
   * Admin-only k-anonymous aggregate: how many of this partner's workers
   * have AI anonymization on. Returns `{ hidden: true }` when the partner has
   * fewer than ANONYMIZATION_COUNT_MIN_GROUP active workers — at that scale
   * the number leaks identity by elimination.
   *
   * No drill-down. Belgian CCT 81 individualization-after-anomaly clause is
   * what makes drill-down a non-starter here.
   */
  getAnonymizedCount: partnerAdminProcedure.query(async ({ ctx }) => {
    const partnerId = ctx.user.partnerId;
    const [totalRow] = await db
      .select({ n: count(memberships.id) })
      .from(memberships)
      .where(eq(memberships.partnerId, partnerId));
    const [anonRow] = await db
      .select({ n: count(memberships.id) })
      .from(memberships)
      .where(and(eq(memberships.partnerId, partnerId), eq(memberships.aiOptOut, true)));

    const total = Number(totalRow?.n ?? 0);
    const anonymized = Number(anonRow?.n ?? 0);
    const hidden = total < ANONYMIZATION_COUNT_MIN_GROUP;
    return {
      total,
      anonymized: hidden ? null : anonymized,
      hidden,
      threshold: ANONYMIZATION_COUNT_MIN_GROUP,
    };
  }),
});
