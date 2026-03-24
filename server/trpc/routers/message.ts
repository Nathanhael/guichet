import { z } from 'zod';
import { router, protectedProcedure } from '../trpc.js';
import { db } from '../../db.js';
import { messages, tickets } from '../../db/schema.js';
import { eq, and, asc, desc, ilike } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import logger from '../../utils/logger.js';
import { mapMessageRow } from '../../utils/messageMapper.js';
import { canUseSupportWorkflows } from '../../services/roles.js';

export const messageRouter = router({
  list: protectedProcedure
    .input(z.object({
      ticketId: z.string(),
    }))
    .query(async ({ input, ctx }) => {
      try {
        const isSupport = canUseSupportWorkflows(ctx.user.role, ctx.user.isPlatformOperator);

        // Always verify the ticket belongs to the caller's partner (tenant isolation)
        const ticketResult = await db.select({ agentId: tickets.agentId, partnerId: tickets.partnerId })
          .from(tickets)
          .where(eq(tickets.id, input.ticketId))
          .limit(1);

        if (ticketResult.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Ticket not found' });
        }

        // Tenant isolation: ticket must belong to caller's partner (platform operators can access any)
        if (!ctx.user.isPlatformOperator && ticketResult[0].partnerId !== ctx.user.partnerId) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized to view these messages' });
        }

        // Ownership check for agents (non-support)
        if (!isSupport && ticketResult[0].agentId !== ctx.user.id) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized to view these messages' });
        }
        
        let query = db.select().from(messages).where(eq(messages.ticketId, input.ticketId));

        // Agents shouldn't see whispers
        if (!isSupport) {
          query = db.select().from(messages).where(
            and(
              eq(messages.ticketId, input.ticketId),
              eq(messages.whisper, 0) // whisper is integer (0/1) in the schema
            )
          );
        }

        const rows = await query.orderBy(asc(messages.createdAt));

        return rows.map(mapMessageRow);
      } catch (err: unknown) {
        if (err instanceof TRPCError) throw err;
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ err: message, ticketId: input.ticketId }, 'tRPC: Error listing messages');
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message });
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
      status: z.enum(['open', 'pending', 'closed', 'resolved']).optional(),
      limit: z.number().min(1).max(50).default(20),
    }))
    .query(async ({ input, ctx }) => {
      if (!canUseSupportWorkflows(ctx.user.role, ctx.user.isPlatformOperator)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Search requires support role' });
      }
      if (!ctx.user.partnerId && !ctx.user.isPlatformOperator) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No partner context' });
      }

      try {
        const conditions = [];

        // Tenant isolation
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

        // Text search (ILIKE for simplicity — works well for moderate data)
        const searchPattern = `%${input.query}%`;
        conditions.push(ilike(messages.text, searchPattern));

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
          .orderBy(desc(messages.createdAt))
          .limit(input.limit);

        return results;
      } catch (err: unknown) {
        if (err instanceof TRPCError) throw err;
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ err: message }, 'tRPC: Error searching messages');
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message });
      }
    }),
});
