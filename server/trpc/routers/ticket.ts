import { z } from 'zod';
import { router, protectedProcedure, partnerScopedProcedure } from '../trpc.js';
import { db } from '../../db.js';
import { messages, ratings, tickets, ticketLabels } from '../../db/schema.js';
import { eq, and, or, ilike, sql, asc, desc, gte, lte, inArray, isNull, isNotNull } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import logger from '../../utils/logger.js';
import { escapeLikePattern } from '../../utils/security.js';

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

/**
 * First non-system, non-deleted message text per ticket — used by the Archive
 * panel as a row preview / title so admins can scan a list of closed tickets
 * without opening each one. One SELECT per page (≤ ~25 tickets), DISTINCT ON
 * keeps it to a single round-trip with index-friendly ordering.
 */
async function fetchFirstMessagesForTickets(ticketIds: string[]): Promise<Record<string, string>> {
  if (ticketIds.length === 0) return {};
  const rows = await db
    .selectDistinctOn([messages.ticketId], {
      ticketId: messages.ticketId,
      text: messages.text,
    })
    .from(messages)
    .where(
      and(
        inArray(messages.ticketId, ticketIds),
        isNull(messages.deletedAt),
        eq(messages.system, 0),
      ),
    )
    .orderBy(messages.ticketId, asc(messages.createdAt));
  const map: Record<string, string> = {};
  for (const r of rows) map[r.ticketId] = r.text ?? '';
  return map;
}

/**
 * CSAT rating per ticket — only one rating per ticket (unique index), so the
 * map is a flat ticketId → 1-5 lookup.
 */
async function fetchRatingsForTickets(ticketIds: string[]): Promise<Record<string, number>> {
  if (ticketIds.length === 0) return {};
  const rows = await db
    .select({ ticketId: ratings.ticketId, rating: ratings.rating })
    .from(ratings)
    .where(inArray(ratings.ticketId, ticketIds));
  const map: Record<string, number> = {};
  for (const r of rows) {
    if (r.ticketId) map[r.ticketId] = r.rating;
  }
  return map;
}

export const ticketRouter = router({
  list: partnerScopedProcedure
    .input(z.object({
      agentId: z.string().optional(),
      status: z.union([z.enum(['open', 'pending', 'closed']), z.array(z.enum(['open', 'pending', 'closed']))]).optional(),
      dept: z.string().optional(),
      search: z.string().optional(),
      limit: z.number().min(1).optional(),
      cursor: z.string().optional(), // "<queueEnteredAt|closedAt>|id"
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      hasSupport: z.boolean().optional(), // true = supportId assigned, false = unassigned
      supportId: z.string().optional(), // narrow to a specific support user
    }))
    .query(async ({ input, ctx }) => {
      try {
        const conditions = [eq(tickets.partnerId, ctx.user.partnerId)];

        // CR-04: Agents (non-support, non-admin) can only see their own tickets
        if (!ctx.user.isPlatformOperator && ctx.user.role === 'agent') {
          conditions.push(eq(tickets.agentId, ctx.user.id));
        } else if (input.agentId) {
          conditions.push(eq(tickets.agentId, input.agentId));
        }

        // H-6: Department isolation for support users with explicitly assigned departments.
        // Per CLAUDE.md contract: empty/null departments = generalist (sees all partner tickets).
        // Admin and platform_operator are never restricted.
        // Departments sourced from JWT context (refreshed on token rotation, max staleness = ACCESS_TOKEN_EXPIRY).
        if (!ctx.user.isPlatformOperator && ctx.user.role === 'support') {
          const depts = ctx.user.departments;
          if (depts.length > 0) {
            conditions.push(inArray(tickets.dept, depts));
          }
          // else: generalist — no additional dept filter
        }
        // Normalize status filter (single value or array)
        const statusArr = input.status
          ? (Array.isArray(input.status) ? input.status : [input.status])
          : [];

        // Reject mixed active+terminal status filters. Active rows sort by
        // queueEnteredAt ASC and terminal rows sort by closedAt DESC; mixing
        // them would silently use one column for both groups and produce a
        // cursor that's compared in the wrong direction for half the page.
        const hasActive = statusArr.some(s => s === 'open' || s === 'pending');
        const hasTerminal = statusArr.some(s => s === 'closed');
        if (hasActive && hasTerminal) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Cannot mix active (open/pending) and terminal (closed) status filters in a single query.',
          });
        }

        if (statusArr.length === 1) {
          conditions.push(eq(tickets.status, statusArr[0]));
        } else if (statusArr.length > 1) {
          conditions.push(inArray(tickets.status, statusArr));
        }
        if (input.dept && input.dept !== 'all') conditions.push(eq(tickets.dept, input.dept));

        if (input.hasSupport === true) conditions.push(isNotNull(tickets.supportId));
        else if (input.hasSupport === false) conditions.push(isNull(tickets.supportId));

        if (input.supportId) conditions.push(eq(tickets.supportId, input.supportId));

        if (input.search) {
          const q = `%${escapeLikePattern(input.search)}%`;
          conditions.push(or(
            ilike(tickets.agentName, q),
            ilike(tickets.supportName, q),
            // Match any reference value (Order ID, tracking #, case #, …).
            // Labels are translated per-partner; searching values lets support
            // paste a raw identifier and find the ticket regardless of label.
            sql`EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(${tickets.references}, '[]'::jsonb)) el WHERE el->>'value' ILIKE ${q})`,
          )!);
        }

        if (input.dateFrom) conditions.push(gte(tickets.createdAt, input.dateFrom));
        if (input.dateTo) {
          const end = input.dateTo + 'T23:59:59';
          conditions.push(lte(tickets.createdAt, end));
        }

        // Terminal statuses (closed/resolved) sort by closedAt DESC.
        // Active statuses sort by queueEnteredAt ASC so the live queue order
        // matches broadcastQueuePositions — a ticket that got a brief support
        // touch and was returned to queue (queueEnteredAt bumped) goes to the
        // back, not back to head-of-queue based on its original createdAt.
        const isTerminal = statusArr.length > 0 && statusArr.every(s => s === 'closed');
        const orderCol = isTerminal ? tickets.closedAt : tickets.queueEnteredAt;

        // Cursor-based pagination
        if (input.limit !== undefined) {
          if (input.cursor) {
            const sepIdx = input.cursor.indexOf('|');
            if (sepIdx !== -1) {
              const cursorTime = input.cursor.slice(0, sepIdx);
              const cursorId = input.cursor.slice(sepIdx + 1);
              // Closed = DESC, Open = ASC
              if (isTerminal) {
                conditions.push(
                  sql`(${orderCol} < ${cursorTime} OR (${orderCol} = ${cursorTime} AND ${tickets.id} < ${cursorId}))`
                );
              } else {
                conditions.push(
                  sql`(${orderCol} > ${cursorTime} OR (${orderCol} = ${cursorTime} AND ${tickets.id} > ${cursorId}))`
                );
              }
            }
          }

          const where = conditions.length > 0 ? and(...conditions) : undefined;

          const rows = await db.select().from(tickets).where(where)
            .orderBy(isTerminal ? desc(orderCol) : asc(orderCol), isTerminal ? desc(tickets.id) : asc(tickets.id))
            .limit(input.limit + 1);

          const hasMore = rows.length > input.limit;
          const pageRows = hasMore ? rows.slice(0, input.limit) : rows;

          if (pageRows.length === 0) return { tickets: [], nextCursor: '' };

          const ticketIds = pageRows.map(t => t.id);
          const [labelsMap, firstMessageMap, ratingMap] = await Promise.all([
            fetchLabelsForTickets(ticketIds),
            // Archive-style queries (terminal status) get extra enrichment;
            // live queues skip it to keep the queue render path lean.
            isTerminal
              ? fetchFirstMessagesForTickets(ticketIds)
              : Promise.resolve({} as Record<string, string>),
            isTerminal
              ? fetchRatingsForTickets(ticketIds)
              : Promise.resolve({} as Record<string, number>),
          ]);

          const ticketsWithLabels = pageRows.map(t => ({
            ...t,
            participants: t.participants || [],
            labels: labelsMap[t.id] || [],
            firstMessage: firstMessageMap[t.id] ?? null,
            rating: ratingMap[t.id] ?? null,
          }));

          const lastItem = pageRows[pageRows.length - 1];
          const cursorValue = isTerminal ? (lastItem.closedAt ?? lastItem.createdAt) : lastItem.queueEnteredAt;
          const nextCursor = hasMore && lastItem ? `${cursorValue}|${lastItem.id}` : '';

          return { tickets: ticketsWithLabels, nextCursor };
        }

        // Non-paginated path (live queue views)
        const where = conditions.length > 0 ? and(...conditions) : undefined;

        const rows = await db.select().from(tickets).where(where)
          .orderBy(isTerminal ? desc(orderCol) : asc(orderCol))
          .limit(500);

        if (rows.length === 0) return [];

        const ticketIds = rows.map(t => t.id);
        const labelsMap = await fetchLabelsForTickets(ticketIds);

        const ticketsWithLabels = rows.map(t => ({
          ...t,
          participants: t.participants || [],
          labels: labelsMap[t.id] || [],
        }));

        return ticketsWithLabels;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ err: message, input }, 'tRPC: Error listing tickets');
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' });
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

        // M-6: Agents can only view their own tickets (mirrors ticket.list CR-04 filter)
        if (!ctx.user.isPlatformOperator && ctx.user.role === 'agent' && t.agentId !== ctx.user.id) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Ticket not found' });
        }

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
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' });
      }
    }),
});
