import { z } from 'zod';
import { router, protectedProcedure } from '../trpc.js';
import { db } from '../../db.js';
import { tickets, ticketLabels } from '../../db/schema.js';
import { eq, and, or, ilike, sql, asc, desc, gte, lte, inArray } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import logger from '../../utils/logger.js';

async function fetchLabelsForTickets(ticketIds: string[]): Promise<Record<string, string[]>> {
  if (ticketIds.length === 0) return {};
  const rows = await db.select({
    ticketId: ticketLabels.ticketId,
    labelId: ticketLabels.labelId,
  }).from(ticketLabels).where(inArray(ticketLabels.ticketId, ticketIds));
  const map: Record<string, string[]> = {};
  for (const row of rows) {
    if (!map[row.ticketId]) map[row.ticketId] = [];
    map[row.ticketId].push(row.labelId);
  }
  return map;
}

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
    .query(async ({ input, ctx }) => {
      try {
        const conditions = [];

        // Scope by partner
        if (!ctx.user.isPlatformOperator) {
          if (!ctx.user.partnerId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No active partner context' });
          conditions.push(eq(tickets.partnerId, ctx.user.partnerId));
        }

        if (input.agentId) conditions.push(eq(tickets.agentId, input.agentId));
        if (input.status) conditions.push(eq(tickets.status, input.status));
        if (input.dept && input.dept !== 'all') conditions.push(eq(tickets.dept, input.dept));
        
        if (input.search) {
          const q = `%${input.search}%`;
          conditions.push(or(
            ilike(tickets.agentName, q),
            ilike(tickets.supportName, q)
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

          if (rows.length === 0) return { tickets: [], total };

          // Optimized: Fetch all labels for these tickets in ONE query
          const ticketIds = rows.map(t => t.id);
          const labelsMap = await fetchLabelsForTickets(ticketIds);

          const ticketsWithLabels = rows.map(t => {
            return {
              ...t,
              participants: t.participants || [],
              labels: labelsMap[t.id] || [],
            };
          });

          return { tickets: ticketsWithLabels, total };
        }

        const rows = await db.select().from(tickets).where(where)
          .orderBy(input.status === 'closed' ? desc(tickets.closedAt) : asc(tickets.createdAt));
        
        if (rows.length === 0) return [];

        // Optimized: Fetch all labels for these tickets in ONE query
        const ticketIds = rows.map(t => t.id);
        const labelsMap = await fetchLabelsForTickets(ticketIds);

        const ticketsWithLabels = rows.map(t => {
          return {
            ...t,
            participants: t.participants || [],
            labels: labelsMap[t.id] || [],
          };
        });

        return ticketsWithLabels;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ err: message, input }, 'tRPC: Error listing tickets');
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message });
      }
    }),

  getById: protectedProcedure
    .input(z.string())
    .query(async ({ input: id, ctx }) => {
      try {
        const conditions = [eq(tickets.id, id)];
        if (!ctx.user.isPlatformOperator) {
          if (!ctx.user.partnerId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No active partner context' });
          conditions.push(eq(tickets.partnerId, ctx.user.partnerId));
        }

        const result = await db.select().from(tickets).where(and(...conditions)).limit(1);
        if (result.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Ticket not found' });
        }

        const t = result[0];
        const labelsMap = await fetchLabelsForTickets([t.id]);

        return {
          ...t,
          participants: t.participants || [],
          labels: labelsMap[t.id] || [],
        };
      } catch (err: unknown) {
        if (err instanceof TRPCError) throw err;
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ err: message, id }, 'tRPC: Error getting ticket');
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message });
      }
    }),
});
