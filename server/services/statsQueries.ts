import { db } from '../db.js';
import { sql, eq, inArray } from 'drizzle-orm';
import { partners, users } from '../db/schema.js';
import { Ticket } from '../types/index.js';

/** Sentiment aggregate per ticket from SQL AVG query */
export interface TicketSentimentAvg {
  ticketId: string;
  sentimentAvg: number | null;
  sentimentCount: number;
}

/** Sentiment aggregate per dept from SQL AVG+JOIN query */
export interface DeptSentimentAvg {
  dept: string;
  sentimentAvg: number | null;
  sentimentCount: number;
}

export interface HistoricalStatRow {
  date: string;
  total: number;
  closed: number;
  abandoned: number;
  avgResponseMs: number;
  avgDurationMs: number;
  avgRating: number | null;
  ratingCount: number;
  slaResolved: number;
  slaCompliant: number;
  p95ResponseMs: number;
  reopened: number;
  sentimentSum: number;
  sentimentCount: number;
  deptCounts: string;
  ratingsByDept: string;
  hourly: string;
}

export interface RatingRow {
  id: string;
  ticketId: string;
  supportId: string;
  rating: number;
  createdAt: string;
}

export interface PrevHistRow {
  total: number | null;
  avgresp: number | null;
  avgdur: number | null;
  abandoned: number | null;
  slares: number | null;
  slacomp: number | null;
}

export interface LabelCountRow {
  name: string;
  dept: string;
  count: number;
}

export async function fetchPartnerSlaConfig(partnerId: string): Promise<{ slaConfig: unknown }[]> {
  return db.select({ slaConfig: partners.slaConfig }).from(partners).where(
    eq(partners.id, partnerId)
  );
}

export async function fetchHistoricalStats(partnerId: string, rangeStart: string, rangeEnd: string): Promise<HistoricalStatRow[]> {
  const result = await db.execute(sql`SELECT date, total, closed, abandoned, avg_response_ms, avg_duration_ms, avg_rating, rating_count, sla_resolved, sla_compliant, p95_response_ms, reopened, sentiment_sum, sentiment_count, dept_counts, ratings_by_dept, hourly FROM daily_stats WHERE date >= ${rangeStart} AND date <= ${rangeEnd} AND partner_id = ${partnerId}`);
  return (result.rows ?? []) as unknown as HistoricalStatRow[];
}

export async function fetchLiveTickets(partnerId: string, rangeStart: string, rangeEnd: string): Promise<Ticket[]> {
  const result = await db.execute(sql`SELECT id, created_at, status, closed_at, dept, agent_id, agent_name, support_id, support_name, support_joined_at, sla_breached, sla_response_due_at, sla_resolution_due_at, reopened, closing_notes, closed_by, partner_id FROM tickets WHERE created_at::date >= ${rangeStart} AND created_at::date <= ${rangeEnd} AND partner_id = ${partnerId}`);
  return result.rows as unknown as Ticket[];
}

export async function fetchRatings(partnerId: string, rangeStart: string, rangeEnd: string, dept?: string): Promise<RatingRow[]> {
  const result = dept && dept !== 'all'
    ? await db.execute(sql`SELECT r.ticket_id AS "ticketId", r.rating, r.comment, r.created_at AS "createdAt"
       FROM ratings r JOIN tickets t ON r.ticket_id = t.id
       WHERE t.created_at::date >= ${rangeStart} AND t.created_at::date <= ${rangeEnd} AND t.partner_id = ${partnerId} AND t.dept = ${dept}`)
    : await db.execute(sql`SELECT r.ticket_id AS "ticketId", r.rating, r.comment, r.created_at AS "createdAt"
       FROM ratings r JOIN tickets t ON r.ticket_id = t.id
       WHERE t.created_at::date >= ${rangeStart} AND t.created_at::date <= ${rangeEnd} AND t.partner_id = ${partnerId}`);
  return result.rows as unknown as RatingRow[];
}

export async function fetchTicketSentiment(partnerId: string, rangeStart: string, rangeEnd: string, dept?: string): Promise<TicketSentimentAvg[]> {
  const result = dept && dept !== 'all'
    ? await db.execute(sql`SELECT m.ticket_id AS "ticketId", AVG(m.sentiment) AS "sentimentAvg", COUNT(m.sentiment) AS "sentimentCount"
       FROM messages m JOIN tickets t ON m.ticket_id = t.id
       WHERE t.created_at::date >= ${rangeStart} AND t.created_at::date <= ${rangeEnd} AND t.partner_id = ${partnerId} AND t.dept = ${dept} AND m.sentiment IS NOT NULL
       GROUP BY m.ticket_id`)
    : await db.execute(sql`SELECT m.ticket_id AS "ticketId", AVG(m.sentiment) AS "sentimentAvg", COUNT(m.sentiment) AS "sentimentCount"
       FROM messages m JOIN tickets t ON m.ticket_id = t.id
       WHERE t.created_at::date >= ${rangeStart} AND t.created_at::date <= ${rangeEnd} AND t.partner_id = ${partnerId} AND m.sentiment IS NOT NULL
       GROUP BY m.ticket_id`);
  return result.rows as unknown as TicketSentimentAvg[];
}

export async function fetchDeptSentiment(partnerId: string, rangeStart: string, rangeEnd: string): Promise<DeptSentimentAvg[]> {
  const result = await db.execute(sql`SELECT t.dept, AVG(m.sentiment) AS "sentimentAvg", COUNT(m.sentiment) AS "sentimentCount"
     FROM messages m JOIN tickets t ON m.ticket_id = t.id
     WHERE t.created_at::date >= ${rangeStart} AND t.created_at::date <= ${rangeEnd} AND t.partner_id = ${partnerId} AND m.sentiment IS NOT NULL
     GROUP BY t.dept`);
  return result.rows as unknown as DeptSentimentAvg[];
}

export async function fetchWaitingTickets(partnerId: string, thirtyMinsAgo: string): Promise<{ createdAt: string }[]> {
  const result = await db.execute(sql`SELECT created_at FROM tickets WHERE status = 'open' AND support_id IS NULL AND created_at >= ${thirtyMinsAgo} AND partner_id = ${partnerId}`);
  return result.rows as unknown as { createdAt: string }[];
}

export async function fetchPreviousPeriodStats(partnerId: string, prevStartStr: string, prevEndStr: string, excludeWeekends?: boolean): Promise<(PrevHistRow & { avgrat: number | null })[]> {
  const result = excludeWeekends
    ? await db.execute(sql`SELECT SUM(total) as total, AVG(avg_response_ms) as avgresp, AVG(avg_duration_ms) as avgdur, SUM(abandoned) as abandoned, AVG(sla_resolved) as slares, AVG(sla_compliant) as slacomp, AVG(avg_rating) as avgrat
       FROM daily_stats WHERE date >= ${prevStartStr} AND date <= ${prevEndStr} AND partner_id = ${partnerId} AND EXTRACT(DOW FROM date::date) NOT IN (0, 6)`)
    : await db.execute(sql`SELECT SUM(total) as total, AVG(avg_response_ms) as avgresp, AVG(avg_duration_ms) as avgdur, SUM(abandoned) as abandoned, AVG(sla_resolved) as slares, AVG(sla_compliant) as slacomp, AVG(avg_rating) as avgrat
       FROM daily_stats WHERE date >= ${prevStartStr} AND date <= ${prevEndStr} AND partner_id = ${partnerId}`);
  return result.rows as unknown as (PrevHistRow & { avgrat: number | null })[];
}

export async function fetchLabelSummary(partnerId: string, rangeStart: string, rangeEnd: string): Promise<LabelCountRow[]> {
  const result = await db.execute(sql`SELECT l.name, t.dept, COUNT(*) as count
                     FROM ticket_labels tl
                     JOIN labels l ON tl.label_id = l.id
                     JOIN tickets t ON tl.ticket_id = t.id
                     WHERE t.created_at::date >= ${rangeStart} AND t.created_at::date <= ${rangeEnd} AND t.partner_id = ${partnerId}
                     GROUP BY l.name, t.dept
                     ORDER BY t.dept, count DESC`);
  return result.rows as unknown as LabelCountRow[];
}

export async function fetchSupportUserNames(supportIds: string[]): Promise<{ id: string; name: string }[]> {
  if (supportIds.length === 0) return [];
  return db.select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, supportIds));
}
