import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { router, partnerScopedProcedure } from '../trpc.js';
import { notFound, forbidden } from '../../utils/trpcErrors.js';
import { db } from '../../db.js';
import { aiUsageLog, aiFeedback } from '../../db/schema.js';
import {
  getCachedSummary,
  setCachedSummary,
  formatMessagesForAi,
  runAiAction,
  verifyTicketOwnership,
  fetchTicketMessages,
  getCachedTranslation,
  setCachedTranslation,
  getProvider,
} from '../../services/ai/index.js';
import { getEffectiveAuditVerbosity } from '../../services/ai/auditVerbosity.js';
import { canUseSupportWorkflows } from '../../services/roles.js';

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
   * Summarize a chat conversation.
   * Only available to support/admin users.
   * Results are cached in Redis with a 30-min TTL.
   */
  summarizeChat: partnerScopedProcedure
    .input(z.object({
      ticketId: z.string(),
      refresh: z.boolean().optional().default(false),
    }))
    .mutation(async ({ input, ctx }) => {
      const partnerId = ctx.user.partnerId;

      // Only support/admin can summarize
      if (!canUseSupportWorkflows(ctx.user.role, ctx.user.isPlatformOperator)) {
        throw forbidden('Only support staff can summarize chats');
      }

      // Verify ticket exists and belongs to this partner
      const ticket = await verifyTicketOwnership(input.ticketId, partnerId);
      if (!ticket) throw notFound('Ticket');

      // Check cache (unless refresh is requested)
      if (!input.refresh) {
        const cached = await getCachedSummary(input.ticketId);
        if (cached) return { summary: cached, cached: true };
      }

      // Fetch messages
      const userMessages = await fetchTicketMessages(input.ticketId);

      if (userMessages.length === 0) {
        return { summary: 'No messages to summarize.', cached: false };
      }

      const formatted = formatMessagesForAi(userMessages);

      const result = await runAiAction({
        partnerId,
        userId: ctx.user.id,
        feature: 'chatSummarization',
        action: 'summarize',
        vars: { messages: formatted },
        temperature: 0.3,
        maxTokens: 512,
      });

      const summary = result.content.trim();

      // Cache the result
      await setCachedSummary(input.ticketId, summary);

      return { summary, cached: false };
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

      const inserted = await db
        .insert(aiFeedback)
        .values({
          partnerId,
          userId: ctx.user.id,
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
});
