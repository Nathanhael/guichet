/**
 * Shared primitives for the dashboard deep services.
 *
 * Every metric module (scorecard, dept/staffBreakdown, trends, staffingHeatmap)
 * needs the same date-window math and the same one-decimal rounding. Pulling
 * them into a single file lets the per-metric transforms focus on their
 * unique aggregation logic.
 *
 * Pure — no DB, no I/O.
 */

export interface DateWindow {
  from: Date;
  to: Date;
}

/** Inclusive on both ends — `from <= t <= to`. */
export function inWindow(t: Date, w: DateWindow): boolean {
  return t.getTime() >= w.from.getTime() && t.getTime() <= w.to.getTime();
}

/**
 * Same as `inWindow` but accepts a date string in `YYYY-MM-DD` form (the
 * shape returned by Postgres date columns). Anchors at midnight UTC so
 * window boundaries align with the daily-rollup grain used by `daily_stats`
 * and `daily_agent_status`.
 */
export function dateInWindow(dateStr: string, w: DateWindow): boolean {
  const t = new Date(`${dateStr}T00:00:00Z`).getTime();
  return t >= w.from.getTime() && t <= w.to.getTime();
}

/** Round to one decimal place. Used for percentage and average displays. */
export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Day-of-week for a `YYYY-MM-DD` date string. 0 = Sunday … 6 = Saturday. */
export function dowFor(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay();
}
