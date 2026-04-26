/**
 * Dashboard Z4 — Trend charts deep service.
 *
 * Pure transform: takes pre-rolled per-day rows from `daily_stats` plus the
 * requested window, returns the three trend lines (volume / CSAT / avg
 * response time in minutes) bucketed at auto-granularity:
 *
 *   <= 14 days window  -> daily
 *   <= 90 days window  -> weekly  (bucket = Monday of the ISO week)
 *   >  90 days window  -> monthly (bucket = first of the month)
 *
 * No DB calls — fixture-testable. Caller filters rows by partner at the DB
 * layer; this module re-applies window + weekend filtering as defense in
 * depth and aggregates.
 */

const WEEKEND_DOWS = new Set([0, 6]);

export type TrendGranularity = 'daily' | 'weekly' | 'monthly';

export interface DateWindow {
  from: Date;
  to: Date;
}

export interface TrendsDailyRow {
  date: string;            // YYYY-MM-DD
  total: number;
  ratingSum: number;
  ratingCount: number;
  responseSumMs: number;
  responseCount: number;
}

export interface TrendsInput {
  rows: TrendsDailyRow[];
  window: DateWindow;
  now?: Date;
  excludeWeekends?: boolean;
}

export interface TrendPoint {
  bucket: string;
  value: number | null;
}

export interface TrendsOutput {
  granularity: TrendGranularity;
  series: {
    volume: TrendPoint[];
    csat: TrendPoint[];
    avgResponseMinutes: TrendPoint[];
  };
}

interface BucketAcc {
  total: number;
  ratingSum: number;
  ratingCount: number;
  responseSumMs: number;
  responseCount: number;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function chooseGranularity(window: DateWindow): TrendGranularity {
  // End-of-day `to` timestamps make the literal diff fall just under N days,
  // so floor + 1 recovers the inclusive calendar-day count.
  const days =
    Math.floor((window.to.getTime() - window.from.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  if (days <= 14) return 'daily';
  if (days <= 90) return 'weekly';
  return 'monthly';
}

function dateInWindow(dateStr: string, w: DateWindow): boolean {
  const t = new Date(`${dateStr}T00:00:00Z`).getTime();
  return t >= w.from.getTime() && t <= w.to.getTime();
}

function dowFor(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay();
}

function bucketKey(dateStr: string, granularity: TrendGranularity): string {
  if (granularity === 'daily') return dateStr;
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (granularity === 'monthly') {
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    return `${yyyy}-${mm}-01`;
  }
  // weekly — Monday of the ISO week (JS: 0 = Sun, 1 = Mon ... 6 = Sat)
  const dow = d.getUTCDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(d.getTime());
  monday.setUTCDate(d.getUTCDate() + offset);
  return monday.toISOString().slice(0, 10);
}

export function buildTrends(input: TrendsInput): TrendsOutput {
  const granularity = chooseGranularity(input.window);

  const filtered = input.rows.filter((r) => {
    if (!dateInWindow(r.date, input.window)) return false;
    if (input.excludeWeekends && WEEKEND_DOWS.has(dowFor(r.date))) return false;
    return true;
  });

  const buckets = new Map<string, BucketAcc>();
  for (const r of filtered) {
    const key = bucketKey(r.date, granularity);
    let acc = buckets.get(key);
    if (!acc) {
      acc = {
        total: 0,
        ratingSum: 0,
        ratingCount: 0,
        responseSumMs: 0,
        responseCount: 0,
      };
      buckets.set(key, acc);
    }
    acc.total += r.total;
    acc.ratingSum += r.ratingSum;
    acc.ratingCount += r.ratingCount;
    acc.responseSumMs += r.responseSumMs;
    acc.responseCount += r.responseCount;
  }

  const sortedKeys = Array.from(buckets.keys()).sort();

  const volume: TrendPoint[] = [];
  const csat: TrendPoint[] = [];
  const avgResponseMinutes: TrendPoint[] = [];

  for (const key of sortedKeys) {
    const acc = buckets.get(key)!;
    volume.push({ bucket: key, value: acc.total });
    csat.push({
      bucket: key,
      value: acc.ratingCount > 0 ? round1(acc.ratingSum / acc.ratingCount) : null,
    });
    avgResponseMinutes.push({
      bucket: key,
      value:
        acc.responseCount > 0
          ? round1(acc.responseSumMs / acc.responseCount / 60000)
          : null,
    });
  }

  return { granularity, series: { volume, csat, avgResponseMinutes } };
}
