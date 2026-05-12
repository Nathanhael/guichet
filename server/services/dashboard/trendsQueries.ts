/**
 * Dashboard Z4 — Trends query layer.
 *
 * Pulls per-day rollup rows from `daily_stats` for the partner over the
 * requested window. The deep service `buildTrends` re-aggregates into
 * daily / weekly / monthly buckets — this layer is the thin Drizzle fetch.
 *
 * `daily_stats` is kept in lockstep with the live tickets table by the
 * GDPR purge path; for windows that span the live day, the caller should
 * pre-merge the live-day rollup before passing rows in. Phase-1 keeps it
 * simple — no live-day stitching here.
 */

import { and, eq, gte, lte } from 'drizzle-orm';
import { db } from '../../db.js';
import { dailyStats } from '../../db/schema.js';
import type { TrendsDailyRow } from './trends.js';

/** @internal — call via `dashboard.compute({ metric: 'trends' })`. */
export async function fetchTrendsData(
  partnerId: string,
  from: Date,
  to: Date,
): Promise<TrendsDailyRow[]> {
  const rows = await db
    .select({
      date: dailyStats.date,
      total: dailyStats.total,
      avgRating: dailyStats.avgRating,
      ratingCount: dailyStats.ratingCount,
      avgResponseMs: dailyStats.avgResponseMs,
      responseCount: dailyStats.responseCount,
    })
    .from(dailyStats)
    .where(
      and(
        eq(dailyStats.partnerId, partnerId),
        gte(dailyStats.date, from.toISOString().slice(0, 10)),
        lte(dailyStats.date, to.toISOString().slice(0, 10)),
      ),
    );

  return rows.map((r) => {
    const ratingCount = r.ratingCount ?? 0;
    const responseCount = r.responseCount ?? 0;
    return {
      date: r.date,
      total: r.total ?? 0,
      // daily_stats stores avgRating, not ratingSum — reconstruct sum.
      ratingSum: r.avgRating !== null && ratingCount > 0 ? r.avgRating * ratingCount : 0,
      ratingCount,
      // daily_stats stores avgResponseMs, not responseSumMs — reconstruct sum.
      responseSumMs:
        r.avgResponseMs !== null && responseCount > 0
          ? r.avgResponseMs * responseCount
          : 0,
      responseCount,
    };
  });
}
