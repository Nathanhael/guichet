import { router, roleProcedure, partnerAdminProcedure } from '../trpc.js';
import { db } from '../../db.js';
import { ratings, tickets, users } from '../../db/schema.js';
import { desc, eq, sql, and, gte, lt } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { wrapError } from '../../utils/trpcErrors.js';

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

      // Scope ratings via the denormalized partnerId column so rows survive
      // ticket purge (ratings.ticketId may be NULL after GDPR retention).
      const conditions = [eq(ratings.partnerId, ctx.user.partnerId!)];

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
      // LEFT JOIN tickets so ratings whose ticket was purged still appear.
      // Prefer the denormalized ratings.dept; fall back to live ticket row for legacy rows.
      const data = await db.select({
          id: ratings.id,
          ticketId: ratings.ticketId,
          agentId: ratings.agentId,
          supportId: ratings.supportId,
          rating: ratings.rating,
          comment: ratings.comment,
          createdAt: ratings.createdAt,
          dept: sql<string | null>`COALESCE(${ratings.dept}, ${tickets.dept})`,
        })
        .from(ratings)
        .leftJoin(tickets, eq(ratings.ticketId, tickets.id))
        .where(and(...conditions))
        .orderBy(desc(ratings.createdAt))
        .limit(fetchLimit);

      const hasMore = data.length > input.limit;
      const items = hasMore ? data.slice(0, input.limit) : data;
      const last = items[items.length - 1];
      const nextCursor = hasMore && last ? `${last.createdAt}|${last.id}` : null;

      return { items, nextCursor };
    } catch (err: unknown) {
      wrapError(err, 'list ratings');
    }
  }),

  getStaffRatings: partnerAdminProcedure
    .input(z.object({
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
    }))
    .query(async ({ input, ctx }) => {
      try {

        // Build conditions for the ratings query
        const conditions = [];

        // Scope via the denormalized ratings.partnerId so rows outlive the ticket row.
        conditions.push(eq(ratings.partnerId, ctx.user.partnerId));

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
        wrapError(err, 'get staff ratings');
      }
    }),

  getAnalytics: partnerAdminProcedure
    .input(z.object({
      dateFrom: z.string().refine(s => !isNaN(Date.parse(s)), { message: 'Invalid date' }).optional(),
      dateTo: z.string().refine(s => !isNaN(Date.parse(s)), { message: 'Invalid date' }).optional(),
      dept: z.string().optional(),
    }))
    .query(async ({ input, ctx }) => {
      try {
        const partnerId = ctx.user.partnerId;

        // Scope by the denormalized ratings.partner_id so rows survive ticket purge.
        // Use COALESCE(r.dept, t.dept) to prefer the denormalized dept but fall back
        // to the live ticket row for rows created before backfill.
        const conditions = [sql`r.partner_id = ${partnerId}`];
        if (input.dateFrom) {
          conditions.push(sql`r.created_at >= ${new Date(input.dateFrom).toISOString()}`);
        }
        if (input.dateTo) {
          const endDate = new Date(input.dateTo);
          endDate.setDate(endDate.getDate() + 1);
          conditions.push(sql`r.created_at < ${endDate.toISOString()}`);
        }
        if (input.dept) {
          conditions.push(sql`COALESCE(r.dept, t.dept) = ${input.dept}`);
        }

        const whereClause = sql.join(conditions, sql` AND `);

        // 1) Daily trend
        const trendRows = (await db.execute(sql`
          SELECT DATE(r.created_at) AS date,
                 ROUND(AVG(r.rating)::numeric, 2) AS avg,
                 COUNT(*)::int AS count
          FROM ratings r LEFT JOIN tickets t ON r.ticket_id = t.id
          WHERE ${whereClause}
          GROUP BY DATE(r.created_at) ORDER BY date ASC
        `)).rows as unknown as Record<string, unknown>[];

        // 2) Distribution
        const distRows = (await db.execute(sql`
          SELECT r.rating, COUNT(*)::int AS count
          FROM ratings r LEFT JOIN tickets t ON r.ticket_id = t.id
          WHERE ${whereClause}
          GROUP BY r.rating ORDER BY r.rating ASC
        `)).rows as unknown as Record<string, unknown>[];

        // 3) By department
        const deptRows = (await db.execute(sql`
          SELECT COALESCE(r.dept, t.dept) AS dept,
                 ROUND(AVG(r.rating)::numeric, 2) AS avg,
                 COUNT(*)::int AS count
          FROM ratings r LEFT JOIN tickets t ON r.ticket_id = t.id
          WHERE ${whereClause}
          GROUP BY COALESCE(r.dept, t.dept) ORDER BY avg DESC
        `)).rows as unknown as Record<string, unknown>[];

        // 4) By staff
        const staffRows = (await db.execute(sql`
          SELECT r.support_id, COALESCE(u.name, 'Unknown') AS name,
                 ROUND(AVG(r.rating)::numeric, 2) AS avg, COUNT(*)::int AS count
          FROM ratings r LEFT JOIN tickets t ON r.ticket_id = t.id
          LEFT JOIN users u ON r.support_id = u.id
          WHERE ${whereClause}
          GROUP BY r.support_id, u.name ORDER BY avg DESC
        `)).rows as unknown as Record<string, unknown>[];

        // 5) Summary
        const summaryRows = (await db.execute(sql`
          SELECT ROUND(AVG(r.rating)::numeric, 2) AS avg,
                 COUNT(*)::int AS total,
                 COUNT(r.comment) FILTER (WHERE r.comment IS NOT NULL AND r.comment != '')::int AS with_comment
          FROM ratings r LEFT JOIN tickets t ON r.ticket_id = t.id
          WHERE ${whereClause}
        `)).rows as unknown as Record<string, unknown>[];

        const summaryRow = summaryRows[0] ?? {};

        return {
          trend: trendRows.map((row) => ({
            date: String(row['date']),
            avg: Number(row['avg']),
            count: Number(row['count']),
          })),
          distribution: distRows.map((row) => ({
            rating: Number(row['rating']),
            count: Number(row['count']),
          })),
          byDept: deptRows.map((row) => ({
            dept: String(row['dept'] ?? ''),
            avg: Number(row['avg']),
            count: Number(row['count']),
          })),
          byStaff: staffRows.map((row) => ({
            supportId: row['support_id'] != null ? String(row['support_id']) : null,
            name: String(row['name'] ?? 'Unknown'),
            avg: Number(row['avg']),
            count: Number(row['count']),
          })),
          summary: {
            avg: Number(summaryRow['avg'] ?? 0),
            total: Number(summaryRow['total'] ?? 0),
            withComment: Number(summaryRow['with_comment'] ?? 0),
          },
        };
      } catch (err: unknown) {
        wrapError(err, 'get rating analytics');
      }
    }),
});
