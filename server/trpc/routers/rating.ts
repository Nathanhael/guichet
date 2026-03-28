import { router, roleProcedure, adminProcedure } from '../trpc.js';
import { db } from '../../db.js';
import { ratings, tickets, users } from '../../db/schema.js';
import { desc, eq, inArray, sql, and, gte, lt } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import logger from '../../utils/logger.js';

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const ratingRouter = router({
  list: roleProcedure(['admin', 'support'])
    .input(z.object({
      limit: z.number().min(1).max(200).default(100),
      cursor: z.string().optional(), // "createdAt|id" composite cursor
    }))
    .query(async ({ input, ctx }) => {
    try {
      // Tenant isolation: only return ratings for tickets belonging to the caller's partner
      if (!ctx.user.partnerId && !ctx.user.isPlatformOperator) {
        return { items: [], nextCursor: null };
      }

      if (ctx.user.isPlatformOperator && !ctx.user.partnerId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Partner context required to list ratings' });
      }

      // Scope ratings to this partner's tickets
      const partnerTicketIds = db.select({ id: tickets.id })
        .from(tickets)
        .where(eq(tickets.partnerId, ctx.user.partnerId!));

      const conditions = [inArray(ratings.ticketId, partnerTicketIds)];

      // IM-13: Cursor-based pagination to prevent unbounded result sets
      if (input.cursor) {
        const sepIdx = input.cursor.indexOf('|');
        if (sepIdx !== -1) {
          const cursorTime = input.cursor.slice(0, sepIdx);
          const cursorId = input.cursor.slice(sepIdx + 1);
          conditions.push(
            sql`(${ratings.createdAt} < ${cursorTime} OR (${ratings.createdAt} = ${cursorTime} AND ${ratings.id} < ${cursorId}))`
          );
        }
      }

      const fetchLimit = input.limit + 1;
      const data = await db.select()
        .from(ratings)
        .where(and(...conditions))
        .orderBy(desc(ratings.createdAt))
        .limit(fetchLimit);

      const hasMore = data.length > input.limit;
      const items = hasMore ? data.slice(0, input.limit) : data;
      const last = items[items.length - 1];
      const nextCursor = hasMore && last ? `${last.createdAt}|${last.id}` : null;

      return { items, nextCursor };
    } catch (err: unknown) {
      const message = errMsg(err);
      logger.error({ err: message }, 'tRPC: Error listing ratings');
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message });
    }
  }),

  getStaffRatings: adminProcedure
    .input(z.object({
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
    }))
    .query(async ({ input, ctx }) => {
      try {
        // Tenant isolation: always scope to a partner
        if (!ctx.user.partnerId) {
          return [];
        }

        // Build conditions for the ratings query
        const conditions = [];

        // Scope to partner's tickets (tenant isolation — mandatory)
        const partnerTicketIds = db.select({ id: tickets.id })
          .from(tickets)
          .where(eq(tickets.partnerId, ctx.user.partnerId));
        conditions.push(inArray(ratings.ticketId, partnerTicketIds));

        // Date range filters — use ISO strings for timestamp comparison (column is PgTimestampString)
        if (input.dateFrom) {
          conditions.push(gte(ratings.createdAt, new Date(input.dateFrom).toISOString()));
        }
        if (input.dateTo) {
          // End of day: add one day and use exclusive upper bound
          const endDate = new Date(input.dateTo);
          endDate.setDate(endDate.getDate() + 1);
          conditions.push(lt(ratings.createdAt, endDate.toISOString()));
        }

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        const data = await db
          .select({
            supportId: ratings.supportId,
            supportName: sql<string>`COALESCE(${users.name}, 'Unknown')`.as('support_name'),
            avgRating: sql<number>`ROUND(AVG(${ratings.rating})::numeric, 2)`.as('avg_rating'),
            totalRatings: sql<number>`COUNT(*)::int`.as('total_ratings'),
          })
          .from(ratings)
          .leftJoin(users, eq(ratings.supportId, users.id))
          .where(whereClause)
          .groupBy(ratings.supportId, users.name)
          .orderBy(sql`AVG(${ratings.rating}) DESC`);

        return data;
      } catch (err: unknown) {
        const message = errMsg(err);
        logger.error({ err: message }, 'tRPC: Error getting staff ratings');
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message });
      }
    }),
});
