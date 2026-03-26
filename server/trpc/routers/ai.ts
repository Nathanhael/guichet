import { z } from 'zod';
import { router, partnerScopedProcedure } from '../trpc.js';
import { TRPCError } from '@trpc/server';
import { notFound, forbidden } from '../../utils/trpcErrors.js';
import {
  getProvider,
  isFeatureEnabled,
  checkRateLimit,
  logUsage,
  getPromptTemplate,
  interpolate,
  getCachedSummary,
  setCachedSummary,
  formatMessagesForAi,
} from '../../services/ai/index.js';
import type { AiAction } from '../../services/ai/types.js';
import { db } from '../../db.js';
import { messages as messagesTable, tickets } from '../../db/schema.js';
import { eq, and, asc, isNull, isNotNull, ne, sql, avg } from 'drizzle-orm';
import { canUseSupportWorkflows } from '../../services/roles.js';
import logger from '../../utils/logger.js';

/**
 * Helper: run an AI action with rate-limiting, logging, and feature gating.
 */
async function runAiAction(opts: {
  partnerId: string;
  userId: string;
  feature: 'messageImprovement' | 'chatSummarization' | 'translation' | 'sentimentDetection' | 'autoSummarizeOnClose';
  action: AiAction;
  vars: Record<string, string>;
  temperature?: number;
  maxTokens?: number;
}): Promise<{ content: string; model: string }> {
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

      return { improved: result.content.trim() };
    }),

  /**
   * Translate a message to a target language.
   * Used for on-the-fly translation when senderLang !== viewerLang.
   */
  translateMessage: partnerScopedProcedure
    .input(z.object({
      text: z.string().min(1).max(5000, 'Message too long (max 5000 chars)'),
      targetLang: z.enum(['nl', 'en', 'fr']),
    }))
    .mutation(async ({ input, ctx }) => {
      const partnerId = ctx.user.partnerId;

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

      return { translated: result.content.trim() };
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
      const [ticket] = await db
        .select({ id: tickets.id, partnerId: tickets.partnerId })
        .from(tickets)
        .where(eq(tickets.id, input.ticketId))
        .limit(1);

      if (!ticket) throw notFound('Ticket');
      if (ticket.partnerId !== partnerId) {
        throw forbidden('Ticket does not belong to your tenant');
      }

      // Check cache (unless refresh is requested)
      if (!input.refresh) {
        const cached = await getCachedSummary(input.ticketId);
        if (cached) return { summary: cached, cached: true };
      }

      // Fetch messages
      const msgs = await db
        .select({
          senderName: messagesTable.senderName,
          senderRole: messagesTable.senderRole,
          text: messagesTable.text,
        })
        .from(messagesTable)
        .where(
          and(
            eq(messagesTable.ticketId, input.ticketId),
            isNull(messagesTable.deletedAt),
          ),
        )
        .orderBy(asc(messagesTable.createdAt));

      // Filter out system messages (system = 0 means not system, 1 means system)
      const userMessages = msgs.filter((m) => m.text && m.text.trim());

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
   * Get sentiment analysis for a ticket's messages.
   * Returns average sentiment, trend, and count of scored messages.
   * Only available to support/admin users.
   */
  getTicketSentiment: partnerScopedProcedure
    .input(z.object({ ticketId: z.string() }))
    .query(async ({ input, ctx }) => {
      const partnerId = ctx.user.partnerId;

      // Only support/admin can view sentiment
      if (!canUseSupportWorkflows(ctx.user.role, ctx.user.isPlatformOperator)) {
        throw forbidden('Only support staff can view sentiment data');
      }

      // Verify ticket exists and belongs to this partner
      const [ticket] = await db
        .select({ id: tickets.id, partnerId: tickets.partnerId })
        .from(tickets)
        .where(eq(tickets.id, input.ticketId))
        .limit(1);

      if (!ticket) throw notFound('Ticket');
      if (ticket.partnerId !== partnerId) {
        throw forbidden('Ticket does not belong to your tenant');
      }

      // Query messages with non-null sentiment, ordered by creation time
      const scored = await db
        .select({
          sentiment: messagesTable.sentiment,
        })
        .from(messagesTable)
        .where(
          and(
            eq(messagesTable.ticketId, input.ticketId),
            isNull(messagesTable.deletedAt),
            isNotNull(messagesTable.sentiment),
          ),
        )
        .orderBy(asc(messagesTable.createdAt));

      const count = scored.length;

      if (count === 0) {
        return { average: 0, trend: 'stable' as const, count: 0 };
      }

      const scores = scored.map((m) => m.sentiment as number);

      // Compute average
      const sum = scores.reduce((a, b) => a + b, 0);
      const average = Math.round((sum / count) * 100) / 100;

      // Compute trend: compare first-half average vs second-half average
      const mid = Math.floor(count / 2);
      let trend: 'improving' | 'worsening' | 'stable' = 'stable';

      if (count >= 2) {
        const firstHalf = scores.slice(0, mid || 1);
        const secondHalf = scores.slice(mid || 1);

        const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
        const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
        const diff = secondAvg - firstAvg;

        // Threshold of 0.1 to avoid noise
        if (diff > 0.1) trend = 'improving';
        else if (diff < -0.1) trend = 'worsening';
      }

      return { average, trend, count };
    }),

  /**
   * Get average sentiment per open ticket for the current partner.
   * Used by support queue sidebar to show sentiment dots.
   */
  getTicketSentiments: partnerScopedProcedure
    .query(async ({ ctx }) => {
      const partnerId = ctx.user.partnerId;

      if (!canUseSupportWorkflows(ctx.user.role, ctx.user.isPlatformOperator)) {
        throw forbidden('Only support staff can view sentiment data');
      }

      const results = await db
        .select({
          ticketId: messagesTable.ticketId,
          avgSentiment: avg(messagesTable.sentiment).mapWith(Number),
        })
        .from(messagesTable)
        .innerJoin(tickets, eq(messagesTable.ticketId, tickets.id))
        .where(
          and(
            eq(tickets.partnerId, partnerId),
            ne(tickets.status, 'closed'),
            isNull(messagesTable.deletedAt),
            isNotNull(messagesTable.sentiment),
          ),
        )
        .groupBy(messagesTable.ticketId);

      const map: Record<string, number> = {};
      for (const r of results) {
        map[r.ticketId] = Math.round((r.avgSentiment ?? 0) * 100) / 100;
      }
      return map;
    }),

  /**
   * Get open tickets with negative average sentiment (< -0.3).
   * Used by admin dashboard to flag tickets needing attention.
   */
  getNegativeSentimentTickets: partnerScopedProcedure
    .input(z.object({ limit: z.number().min(1).max(50).optional().default(10) }))
    .query(async ({ input, ctx }) => {
      const partnerId = ctx.user.partnerId;

      if (!canUseSupportWorkflows(ctx.user.role, ctx.user.isPlatformOperator)) {
        throw forbidden('Only support/admin can view sentiment data');
      }

      // Find open tickets with avg sentiment < -0.3
      const results = await db
        .select({
          ticketId: messagesTable.ticketId,
          avgSentiment: avg(messagesTable.sentiment).mapWith(Number),
          messageCount: sql<number>`count(*)`.mapWith(Number),
        })
        .from(messagesTable)
        .innerJoin(tickets, eq(messagesTable.ticketId, tickets.id))
        .where(
          and(
            eq(tickets.partnerId, partnerId),
            ne(tickets.status, 'closed'),
            isNull(messagesTable.deletedAt),
            isNotNull(messagesTable.sentiment),
          ),
        )
        .groupBy(messagesTable.ticketId)
        .having(sql`avg(${messagesTable.sentiment}) < -0.3`)
        .orderBy(sql`avg(${messagesTable.sentiment}) asc`)
        .limit(input.limit);

      // Enrich with ticket info
      const ticketIds = results.map(r => r.ticketId);
      if (ticketIds.length === 0) return [];

      const ticketInfo = await db
        .select({
          id: tickets.id,
          agentName: tickets.agentName,
          dept: tickets.dept,
          status: tickets.status,
          createdAt: tickets.createdAt,
        })
        .from(tickets)
        .where(sql`${tickets.id} IN (${sql.join(ticketIds.map(id => sql`${id}`), sql`, `)})`);

      const ticketMap = new Map(ticketInfo.map(t => [t.id, t]));

      return results.map(r => {
        const t = ticketMap.get(r.ticketId);
        return {
          ticketId: r.ticketId,
          avgSentiment: Math.round((r.avgSentiment ?? 0) * 100) / 100,
          messageCount: r.messageCount,
          agentName: t?.agentName ?? 'Unknown',
          dept: t?.dept ?? '',
          status: t?.status ?? '',
          createdAt: t?.createdAt ?? '',
        };
      });
    }),
});
