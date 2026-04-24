import { z } from 'zod';
import { router, protectedProcedure } from '../trpc.js';
import { db } from '../../db.js';
import { messages, tickets } from '../../db/schema.js';
import { eq, and, asc, desc, or, gt, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import logger from '../../utils/logger.js';
import { mapMessageRow } from '../../utils/messageMapper.js';
import { canUseSupportWorkflows } from '../../services/roles.js';
import { loadTicketForUser } from '../../services/membership.js';
import { resolveReplySnippetsBatch, resolveUserAvatarsBatch } from '../../services/messageQueries.js';

/**
 * Convert a user search string into a PostgreSQL tsquery with prefix matching.
 * Each word gets `:*` for prefix matching; words are ANDed together.
 * Returns null if the input produces no valid tokens after sanitization.
 */
function toTsQuery(input: string): string | null {
  const tokens = input
    .trim()
    .split(/\s+/)
    .filter(w => w.length > 0)
    .map(w => w.replace(/[^a-zA-Z0-9àâäéèêëïîôùûüÿçñ]/g, ''))
    .filter(w => w.length > 0)
    .map(w => `${w}:*`);
  return tokens.length > 0 ? tokens.join(' & ') : null;
}

export const messageRouter = router({
  list: protectedProcedure
    .input(z.object({
      ticketId: z.string(),
      limit: z.number().int().min(1).max(100).default(50),
      cursor: z.string().optional(),
    }))
    .query(async ({ input, ctx }) => {
      try {
        const isSupport = canUseSupportWorkflows(ctx.user.role, ctx.user.isPlatformOperator);

        // Tenant isolation via shared helper: throws NOT_FOUND or FORBIDDEN.
        // No operator bypass — operators must have entered the partner.
        const ticket = await loadTicketForUser(input.ticketId, ctx);

        // Ownership check for agents (non-support)
        if (!isSupport && ticket.agentId !== ctx.user.id) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized to view these messages' });
        }

        // Build conditions array
        const conditions = [eq(messages.ticketId, input.ticketId)];

        // Agents shouldn't see whispers
        if (!isSupport) {
          conditions.push(eq(messages.whisper, 0)); // whisper is integer (0/1) in the schema
        }

        // Cursor-based keyset pagination (format: "createdAt|id")
        if (input.cursor) {
          const [cursorTime, cursorId] = input.cursor.split('|');
          conditions.push(
            or(
              gt(messages.createdAt, cursorTime),
              and(eq(messages.createdAt, cursorTime), gt(messages.id, cursorId))
            )!
          );
        }

        const rows = await db
          .select()
          .from(messages)
          .where(and(...conditions))
          .orderBy(asc(messages.createdAt), asc(messages.id))
          .limit(input.limit + 1);

        const hasMore = rows.length > input.limit;
        const items = hasMore ? rows.slice(0, input.limit) : rows;
        const nextCursor = hasMore
          ? `${items[items.length - 1].createdAt}|${items[items.length - 1].id}`
          : undefined;

        const mappedMessages = items.map(mapMessageRow);

        // Batch-resolve reply snippets + sender avatars in parallel (avoids N+1).
        // Avatars are joined live (not denormalized) so Entra photo updates
        // reflect on historical messages next refresh.
        const replyIds = mappedMessages
          .map((m) => m.replyToId)
          .filter((id): id is string => !!id);
        const senderIds = mappedMessages.map((m) => m.senderId).filter((id): id is string => !!id);
        const [snippetMap, avatarMap] = await Promise.all([
          resolveReplySnippetsBatch(replyIds),
          resolveUserAvatarsBatch(senderIds),
        ]);

        const decorated = mappedMessages.map((msg) => {
          const senderAvatarUrl = avatarMap.get(msg.senderId) ?? null;
          const base = { ...msg, senderAvatarUrl };
          if (!msg.replyToId) return base;
          const snippet = snippetMap.get(msg.replyToId) || null;
          return { ...base, replyTo: snippet };
        });
        return { messages: decorated, hasMore, nextCursor };
      } catch (err: unknown) {
        if (err instanceof TRPCError) throw err;
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ err: message, ticketId: input.ticketId }, 'tRPC: Error listing messages');
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' });
      }
    }),

  /**
   * Search across messages within the caller's partner scope.
   * Returns matching messages grouped by ticket.
   */
  search: protectedProcedure
    .input(z.object({
      query: z.string().min(1).max(200),
      dept: z.string().optional(),
      status: z.enum(['open', 'pending', 'closed']).optional(),
      limit: z.number().min(1).max(50).default(20),
    }))
    .query(async ({ input, ctx }) => {
      if (!canUseSupportWorkflows(ctx.user.role, ctx.user.isPlatformOperator)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Search requires support role' });
      }
      if (!ctx.user.partnerId && !ctx.user.isPlatformOperator) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No partner context' });
      }
      if (ctx.user.isPlatformOperator && !ctx.user.partnerId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Platform operators must have an active partner context to search messages' });
      }

      try {
        const conditions = [];

        // Tenant isolation — always enforce partner scope
        if (ctx.user.partnerId) {
          conditions.push(eq(tickets.partnerId, ctx.user.partnerId));
        }

        // Department filter
        if (input.dept) {
          conditions.push(eq(tickets.dept, input.dept));
        }

        // Status filter
        if (input.status) {
          conditions.push(eq(tickets.status, input.status));
        }

        // Full-text search using tsvector/tsquery with prefix matching
        const tsQuery = toTsQuery(input.query);
        if (!tsQuery) {
          return [];
        }
        conditions.push(
          sql`"messages"."search_vector" @@ to_tsquery('simple', ${tsQuery})`
        );

        // Exclude whispers from search results
        conditions.push(eq(messages.whisper, 0));
        conditions.push(eq(messages.system, 0));

        const results = await db
          .select({
            messageId: messages.id,
            ticketId: messages.ticketId,
            senderName: messages.senderName,
            text: messages.text,
            createdAt: messages.createdAt,
            ticketDept: tickets.dept,
            ticketStatus: tickets.status,
            agentName: tickets.agentName,
          })
          .from(messages)
          .innerJoin(tickets, eq(messages.ticketId, tickets.id))
          .where(and(...conditions))
          .orderBy(
            sql`ts_rank("messages"."search_vector", to_tsquery('simple', ${tsQuery})) DESC`,
            desc(messages.createdAt)
          )
          .limit(input.limit);

        return results;
      } catch (err: unknown) {
        if (err instanceof TRPCError) throw err;
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ err: message }, 'tRPC: Error searching messages');
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' });
      }
    }),
});
