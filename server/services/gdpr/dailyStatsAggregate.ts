/**
 * Daily-stats aggregation step of the GDPR purge.
 *
 * Single bulk fetch of expired closed tickets + their ratings + messages,
 * grouped in-memory by (date, partner_id), then upserted into daily_stats.
 * Replaces the previous O(dates × partners) nested loop.
 *
 * The same message scan produces the list of `/uploads/*` files that the
 * orchestrator passes to `storage.delete()` AFTER the cascade transaction
 * commits — collecting them here avoids a second pass through messages.
 *
 * Returns:
 *   filesToDelete — relative filenames (without the `/uploads/` prefix)
 *
 * Note: this step only READS the live tables. The actual deletion happens
 * in `cascade.ts`.
 */

import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { db } from '../../db.js';
import logger from '../../utils/logger.js';
import { archiveTickets } from '../archive.js';
import { computeLiveDayStats } from '../stats.js';
import { Ticket, Rating, Message } from '../../types/index.js';
import {
  tickets,
  ratings as ratingsTable,
  messages as messagesTable,
  dailyStats,
  archivedTickets,
} from '../../db/schema.js';

export interface DailyStatsAggregateResult {
  filesToDelete: string[];
}

export async function aggregateDailyStats(cutoffDate: string): Promise<DailyStatsAggregateResult> {
  const cutoffIso = new Date(cutoffDate).toISOString();

  // Guard: archive any leftover closed-but-unarchived tickets. The original
  // `archiveTickets` return-value-based check missed day-2+ runs where the
  // archive was already done — re-archiving here is idempotent and cheap.
  const unarchivedRows = await db.execute(sql`
    SELECT COUNT(*)::int as count FROM ${tickets}
    WHERE ${tickets.createdAt} < ${cutoffIso} AND ${tickets.status} = 'closed'
    AND NOT EXISTS (SELECT 1 FROM ${archivedTickets} WHERE ${archivedTickets.id} = ${tickets.id})
  `);
  const unarchivedCount = (unarchivedRows.rows as unknown as { count: number }[])[0]?.count ?? 0;
  if (unarchivedCount > 0) {
    logger.warn({ unarchivedCount }, '[purge] Unarchived closed tickets exist — archiving first');
    await archiveTickets();
  }

  const windowStart = '1970-01-01';
  const windowEnd = cutoffDate;
  const filesToDelete: string[] = [];

  const allTickets = (await db
    .select()
    .from(tickets)
    .where(and(
      gte(tickets.createdAt, windowStart),
      lt(tickets.createdAt, windowEnd),
      eq(tickets.status, 'closed'),
    ))
    .orderBy(tickets.partnerId, tickets.createdAt)
  ) as unknown as Ticket[];

  if (allTickets.length === 0) return { filesToDelete };

  const allTicketIds = allTickets.map((t) => t.id);
  const allRatings = (await db.select().from(ratingsTable).where(inArray(ratingsTable.ticketId, allTicketIds))) as unknown as Rating[];
  const allMessages = (await db.select().from(messagesTable).where(inArray(messagesTable.ticketId, allTicketIds))) as unknown as Message[];

  const ratingsByTicket = new Map<string, Rating[]>();
  for (const r of allRatings) {
    const list = ratingsByTicket.get(r.ticketId) ?? [];
    list.push(r);
    ratingsByTicket.set(r.ticketId, list);
  }

  type TicketWithPartner = Ticket & { partnerId: string };
  type DayPartnerKey = string;
  const grouped = new Map<DayPartnerKey, { date: string; partnerId: string; tickets: TicketWithPartner[] }>();
  for (const ticket of allTickets as TicketWithPartner[]) {
    const date = new Date(ticket.createdAt).toISOString().slice(0, 10);
    const key: DayPartnerKey = `${date}|${ticket.partnerId}`;
    const entry = grouped.get(key) ?? { date, partnerId: ticket.partnerId, tickets: [] };
    entry.tickets.push(ticket);
    grouped.set(key, entry);
  }

  for (const { date, partnerId, tickets: dayTickets } of grouped.values()) {
    const ticketIds = dayTickets.map((t) => t.id);
    const dayRatings = ticketIds.flatMap((id) => ratingsByTicket.get(id) ?? []);

    const stats = computeLiveDayStats(dayTickets, dayRatings, 'all');

    const avgResponseMs = stats.responseCount > 0 ? Math.round(stats.responseSum / stats.responseCount) : 0;
    const avgDurationMs = stats.durationCount > 0 ? Math.round(stats.durationSum / stats.durationCount) : 0;
    const avgRating = stats.ratingCount > 0 ? Math.round((stats.ratingSum / stats.ratingCount) * 10) / 10 : null;

    const row = {
      date, partnerId,
      total: stats.total, closed: stats.closed, abandoned: stats.abandoned, reopened: stats.reopened,
      avgResponseMs, avgDurationMs, avgRating,
      ratingCount: stats.ratingCount,
      p95ResponseMs: stats.p95ResponseMs,
      deptCounts: stats.deptCounts, ratingsByDept: stats.ratingsByDept, hourly: stats.hourly,
    };

    await db.insert(dailyStats).values(row).onConflictDoUpdate({
      target: [dailyStats.date, dailyStats.partnerId],
      set: {
        total: sql`EXCLUDED.total`, closed: sql`EXCLUDED.closed`,
        abandoned: sql`EXCLUDED.abandoned`, reopened: sql`EXCLUDED.reopened`,
        avgResponseMs: sql`EXCLUDED.avg_response_ms`, avgDurationMs: sql`EXCLUDED.avg_duration_ms`,
        avgRating: sql`EXCLUDED.avg_rating`, ratingCount: sql`EXCLUDED.rating_count`,
        p95ResponseMs: sql`EXCLUDED.p95_response_ms`,
        deptCounts: sql`EXCLUDED.dept_counts`,
        ratingsByDept: sql`EXCLUDED.ratings_by_dept`, hourly: sql`EXCLUDED.hourly`,
      },
    });
  }

  for (const msg of allMessages) {
    if (msg.mediaUrl && msg.mediaUrl.startsWith('/uploads/')) {
      filesToDelete.push(msg.mediaUrl.replace(/^\/uploads\//, ''));
    }
    const rawAtt = (msg as unknown as Record<string, unknown>).attachments;
    const attachments: Array<{ url: string }> = Array.isArray(rawAtt)
      ? rawAtt
      : typeof rawAtt === 'string'
        ? (() => { try { return JSON.parse(rawAtt); } catch { return []; } })()
        : [];
    for (const att of attachments) {
      if (att.url?.startsWith('/uploads/')) {
        filesToDelete.push(att.url.replace(/^\/uploads\//, ''));
      }
    }
  }

  return { filesToDelete };
}
