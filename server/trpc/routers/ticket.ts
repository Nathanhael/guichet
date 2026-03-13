import { z } from 'zod';
import { router, protectedProcedure } from '../trpc.js';
import { db } from '../../db.js';
import { tickets, ticketLabels } from '../../db/schema.js';
import { eq, and, or, ilike, sql, asc, desc, gte, lte } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import logger from '../../utils/logger.js';

export const ticketRouter = router({
  list: protectedProcedure
    .input(z.object({
      agentId: z.string().optional(),
      status: z.enum(['open', 'pending', 'closed']).optional(),
      dept: z.string().optional(),
      search: z.string().optional(),
      limit: z.number().min(1).optional(),
      offset: z.number().min(0).optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
    }))
    .query(async ({ input }) => {
      try {
        const conditions = [];

        if (input.agentId) conditions.push(eq(tickets.agentId, input.agentId));
        if (input.status) conditions.push(eq(tickets.status, input.status));
        if (input.dept && input.dept !== 'all') conditions.push(eq(tickets.dept, input.dept));
        
        if (input.search) {
          const q = `%${input.search}%`;
          conditions.push(or(
            ilike(tickets.agentName, q),
            ilike(tickets.cdbId, q),
            ilike(tickets.dareRef, q),
            ilike(tickets.expertName, q)
          ));
        }

        if (input.dateFrom) conditions.push(gte(tickets.createdAt, input.dateFrom));
        if (input.dateTo) {
          const end = input.dateTo + 'T23:59:59';
          conditions.push(lte(tickets.createdAt, end));
        }

        const where = conditions.length > 0 ? and(...conditions) : undefined;

        // Pagination & Count for Archive
        if (input.limit !== undefined) {
          const countResult = await db.select({ count: sql<number>`count(*)` }).from(tickets).where(where);
          const total = Number(countResult[0]?.count || 0);

          const rows = await db.select().from(tickets).where(where)
             .orderBy(input.status === 'closed' ? desc(tickets.closedAt) : asc(tickets.createdAt))
             .limit(input.limit).offset(input.offset || 0);

          // Fetch labels for each ticket
          const ticketsWithLabels = await Promise.all(rows.map(async (t) => {
            const labels = await db.select({ labelId: ticketLabels.labelId })
              .from(ticketLabels)
              .where(eq(ticketLabels.ticketId, t.id));
            
            return {
              ...t,
              participants: JSON.parse(t.participants || '[]'),
              labels: labels.map(l => l.labelId),
            };
          }));

          return { tickets: ticketsWithLabels, total };
        }

        const rows = await db.select().from(tickets).where(where)
          .orderBy(input.status === 'closed' ? desc(tickets.closedAt) : asc(tickets.createdAt));
        const ticketsWithLabels = await Promise.all(rows.map(async (t) => {
          const labels = await db.select({ labelId: ticketLabels.labelId })
            .from(ticketLabels)
            .where(eq(ticketLabels.ticketId, t.id));
          
          return {
            ...t,
            participants: JSON.parse(t.participants || '[]'),
            labels: labels.map(l => l.labelId),
          };
        }));

        return ticketsWithLabels;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ err: message, input }, 'tRPC: Error listing tickets');
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message });
      }
    }),

  getById: protectedProcedure
    .input(z.string())
    .query(async ({ input: id }) => {
      try {
        const result = await db.select().from(tickets).where(eq(tickets.id, id)).limit(1);
        if (result.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Ticket not found' });
        }

        const t = result[0];
        const labels = await db.select({ labelId: ticketLabels.labelId })
          .from(ticketLabels)
          .where(eq(ticketLabels.ticketId, t.id));

        return {
          ...t,
          participants: JSON.parse(t.participants || '[]'),
          labels: labels.map(l => l.labelId),
        };
      } catch (err: unknown) {
        if (err instanceof TRPCError) throw err;
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ err: message, id }, 'tRPC: Error getting ticket');
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message });
      }
    }),
});
