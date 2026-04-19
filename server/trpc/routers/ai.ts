import { z } from 'zod';
import { router, partnerScopedProcedure } from '../trpc.js';
import { notFound, forbidden } from '../../utils/trpcErrors.js';
import {
  getCachedSummary,
  setCachedSummary,
  formatMessagesForAi,
  runAiAction,
  verifyTicketOwnership,
  fetchTicketMessages,
} from '../../services/ai/index.js';
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
});
