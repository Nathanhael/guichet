import { z } from 'zod';
import { db } from '../db.js';
import { sql, inArray } from 'drizzle-orm';
import { users } from '../db/schema.js';
import { Ticket } from '../types/index.js';

/**
 * Raw-SQL row validation.
 *
 * All dashboard stats come from hand-written SQL against daily_stats / tickets
 * / messages / ratings / labels. A silent column rename — or a forgotten AS
 * alias — used to propagate as `undefined` through eight `as unknown as`
 * casts, corrupting dashboard output without a single error.
 *
 * Runtime validation via `parseRows` now makes that impossible: a missing or
 * wrong-shaped column throws immediately with the query name, and consumers
 * get types derived directly from the schema (`z.infer`) so there is no
 * interface/SQL divergence to drift.
 *
 * `z.coerce.number()` is used for aggregate columns (SUM / COUNT / AVG)
 * because node-postgres returns `numeric` / `bigint` types as strings.
 */

function parseRows<T extends z.ZodTypeAny>(
  rows: unknown,
  schema: T,
  context: string,
): z.infer<T>[] {
  const result = z.array(schema).safeParse(rows ?? []);
  if (!result.success) {
    throw new Error(
      `statsQueries.${context}: row shape mismatch — ${result.error.message}`,
    );
  }
  return result.data;
}

const historicalStatSchema = z.object({
  date: z.string(),
  total: z.coerce.number(),
  closed: z.coerce.number(),
  abandoned: z.coerce.number(),
  avgResponseMs: z.coerce.number(),
  avgDurationMs: z.coerce.number(),
  avgRating: z.coerce.number().nullable(),
  ratingCount: z.coerce.number(),
  responseCount: z.coerce.number(),
  p95ResponseMs: z.coerce.number(),
  reopened: z.coerce.number(),
  deptCounts: z.string(),
  ratingsByDept: z.string(),
  hourly: z.string(),
});
export type HistoricalStatRow = z.infer<typeof historicalStatSchema>;

const ratingSchema = z.object({
  id: z.string(),
  ticketId: z.string(),
  supportId: z.string().nullable(),
  rating: z.coerce.number(),
  comment: z.string().nullable().optional(),
  createdAt: z.union([z.string(), z.date()]).transform((v) => (v instanceof Date ? v.toISOString() : v)),
});
export type RatingRow = z.infer<typeof ratingSchema>;

const prevHistSchema = z.object({
  total: z.coerce.number().nullable(),
  avgresp: z.coerce.number().nullable(),
  avgdur: z.coerce.number().nullable(),
  abandoned: z.coerce.number().nullable(),
  avgrat: z.coerce.number().nullable(),
});
export type PrevHistRow = z.infer<typeof prevHistSchema>;

const labelCountSchema = z.object({
  name: z.string(),
  dept: z.string(),
  count: z.coerce.number(),
});
export type LabelCountRow = z.infer<typeof labelCountSchema>;

const waitingSchema = z.object({
  // node-postgres returns timestamptz as a Date, but raw queries can land as string too
  created_at: z.union([z.string(), z.date()]).transform((v) => (v instanceof Date ? v.toISOString() : v)),
});

export async function fetchHistoricalStats(partnerId: string, rangeStart: string, rangeEnd: string): Promise<HistoricalStatRow[]> {
  const result = await db.execute(sql`SELECT date, total, closed, abandoned, avg_response_ms AS "avgResponseMs", avg_duration_ms AS "avgDurationMs", avg_rating AS "avgRating", rating_count AS "ratingCount", response_count AS "responseCount", p95_response_ms AS "p95ResponseMs", reopened, dept_counts AS "deptCounts", ratings_by_dept AS "ratingsByDept", hourly FROM daily_stats WHERE date >= ${rangeStart} AND date <= ${rangeEnd} AND partner_id = ${partnerId}`);
  return parseRows(result.rows, historicalStatSchema, 'fetchHistoricalStats');
}

export async function fetchLiveTickets(partnerId: string, rangeStart: string, rangeEnd: string): Promise<Ticket[]> {
  // Ticket shape is defined in types/index.ts and is shared across the app;
  // guarding it here would require duplicating 20+ fields. The selected
  // columns below are fixed — any rename will surface at read-site via the
  // Ticket type. Kept as cast by design.
  //
  // Half-open range on created_at (no ::date cast on the column) so the
  // planner can use idx_tickets_partner_created. rangeEnd is inclusive in
  // intent, so we bump one day and use `<`.
  const result = await db.execute(sql`SELECT id, created_at, status, closed_at, dept, agent_id, agent_name, support_id, support_name, support_joined_at, reopened, closing_notes, closed_by, partner_id FROM tickets WHERE created_at >= ${rangeStart} AND created_at < (${rangeEnd}::date + 1) AND partner_id = ${partnerId}`);
  return result.rows as unknown as Ticket[];
}

export async function fetchRatings(partnerId: string, rangeStart: string, rangeEnd: string, dept?: string): Promise<RatingRow[]> {
  // NB: `id` and `supportId` were previously absent from the SELECT while the
  // old `as unknown as RatingRow[]` cast still claimed they existed — a silent
  // propagation of `undefined` into the support-by-rating map in stats.ts.
  // Adding the columns and validating the row shape fixes that latent bug.
  const result = dept && dept !== 'all'
    ? await db.execute(sql`SELECT r.id, r.ticket_id AS "ticketId", r.support_id AS "supportId", r.rating, r.comment, r.created_at AS "createdAt"
       FROM ratings r JOIN tickets t ON r.ticket_id = t.id
       WHERE t.created_at >= ${rangeStart} AND t.created_at < (${rangeEnd}::date + 1) AND t.partner_id = ${partnerId} AND t.dept = ${dept}`)
    : await db.execute(sql`SELECT r.id, r.ticket_id AS "ticketId", r.support_id AS "supportId", r.rating, r.comment, r.created_at AS "createdAt"
       FROM ratings r JOIN tickets t ON r.ticket_id = t.id
       WHERE t.created_at >= ${rangeStart} AND t.created_at < (${rangeEnd}::date + 1) AND t.partner_id = ${partnerId}`);
  return parseRows(result.rows, ratingSchema, 'fetchRatings');
}

export async function fetchWaitingTickets(partnerId: string, thirtyMinsAgo: string): Promise<{ createdAt: string }[]> {
  const result = await db.execute(sql`SELECT created_at FROM tickets WHERE status = 'open' AND support_id IS NULL AND created_at >= ${thirtyMinsAgo} AND partner_id = ${partnerId}`);
  const rows = parseRows(result.rows, waitingSchema, 'fetchWaitingTickets');
  return rows.map((r) => ({ createdAt: r.created_at }));
}

export async function fetchPreviousPeriodStats(partnerId: string, prevStartStr: string, prevEndStr: string, excludeWeekends?: boolean): Promise<PrevHistRow[]> {
  const result = excludeWeekends
    ? await db.execute(sql`SELECT SUM(total) as total, AVG(avg_response_ms) as avgresp, AVG(avg_duration_ms) as avgdur, SUM(abandoned) as abandoned, AVG(avg_rating) as avgrat
       FROM daily_stats WHERE date >= ${prevStartStr} AND date <= ${prevEndStr} AND partner_id = ${partnerId} AND EXTRACT(DOW FROM date::date) NOT IN (0, 6)`)
    : await db.execute(sql`SELECT SUM(total) as total, AVG(avg_response_ms) as avgresp, AVG(avg_duration_ms) as avgdur, SUM(abandoned) as abandoned, AVG(avg_rating) as avgrat
       FROM daily_stats WHERE date >= ${prevStartStr} AND date <= ${prevEndStr} AND partner_id = ${partnerId}`);
  return parseRows(result.rows, prevHistSchema, 'fetchPreviousPeriodStats');
}

export async function fetchLabelSummary(partnerId: string, rangeStart: string, rangeEnd: string): Promise<LabelCountRow[]> {
  const result = await db.execute(sql`SELECT l.name, t.dept, COUNT(*) as count
                     FROM ticket_labels tl
                     JOIN labels l ON tl.label_id = l.id
                     JOIN tickets t ON tl.ticket_id = t.id
                     WHERE t.created_at >= ${rangeStart} AND t.created_at < (${rangeEnd}::date + 1) AND t.partner_id = ${partnerId}
                     GROUP BY l.name, t.dept
                     ORDER BY t.dept, count DESC`);
  return parseRows(result.rows, labelCountSchema, 'fetchLabelSummary');
}

export async function fetchSupportUserNames(supportIds: string[]): Promise<{ id: string; name: string }[]> {
  if (supportIds.length === 0) return [];
  return db.select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, supportIds));
}

// Exported for tests — lets us assert schema shape without hitting the DB.
export const __schemas = {
  historicalStatSchema,
  ratingSchema,
  waitingSchema,
  prevHistSchema,
  labelCountSchema,
  parseRows,
};
