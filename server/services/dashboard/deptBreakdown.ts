/**
 * Dashboard Z5 — Department breakdown deep service.
 *
 * Pure transform: takes pre-fetched tickets / ratings / breaches plus the
 * partner's departments config, returns one `DeptRow` per dept seen in the
 * window (sorted by volume descending). Tickets whose `dept` is not in the
 * config land in an `__unknown__` bucket (renamed depts shouldn't disappear
 * from the breakdown silently).
 *
 * Defense-in-depth: every row's `partnerId` is verified — DB filter is the
 * primary line, this is the second.
 */

export interface DateWindow {
  from: Date;
  to: Date;
}

export interface DeptConfig {
  id: string;
  name: string;
  sla?: { enabled?: boolean; firstResponseMinutes?: number };
}

export interface RawTicketRow {
  id: string;
  partnerId: string;
  dept: string;
  createdAt: Date;
  firstStaffResponseAt: Date | null;
}

export interface RawRatingRow {
  id: string;
  partnerId: string;
  dept: string;
  rating: number;
  createdAt: Date;
}

export interface RawBreachRow {
  id: string;
  partnerId: string;
  dept: string;
  breachedAt: Date;
}

export interface DeptBreakdownInput {
  partnerId: string;
  window: DateWindow;
  departments: DeptConfig[];
  tickets: RawTicketRow[];
  ratings: RawRatingRow[];
  breaches: RawBreachRow[];
}

export interface DeptRow {
  id: string;
  name: string;
  volume: number;
  slaPct: number | null;
  csat: number | null;
  breachCount: number;
}

const UNKNOWN_ID = '__unknown__';
const UNKNOWN_NAME = 'Unknown';

interface Bucket {
  id: string;
  name: string;
  volume: number;
  ticketsWithResponse: number;
  ticketsMetSla: number;
  slaTrackable: boolean;
  ratingSum: number;
  ratingCount: number;
  breachCount: number;
}

function inWindow(t: Date, w: DateWindow): boolean {
  return t.getTime() >= w.from.getTime() && t.getTime() <= w.to.getTime();
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function buildDeptBreakdown(input: DeptBreakdownInput): DeptRow[] {
  const { partnerId, window, departments, tickets, ratings, breaches } = input;

  const configById = new Map<string, DeptConfig>();
  for (const d of departments) configById.set(d.id, d);

  const buckets = new Map<string, Bucket>();
  const ensure = (deptId: string): Bucket => {
    let b = buckets.get(deptId);
    if (b) return b;
    const cfg = configById.get(deptId);
    b = {
      id: cfg ? cfg.id : UNKNOWN_ID,
      name: cfg ? cfg.name : UNKNOWN_NAME,
      volume: 0,
      ticketsWithResponse: 0,
      ticketsMetSla: 0,
      slaTrackable: cfg?.sla?.enabled === true && (cfg.sla.firstResponseMinutes ?? 0) > 0,
      ratingSum: 0,
      ratingCount: 0,
      breachCount: 0,
    };
    // Unknown bucket coalesces every unrecognized dept under one row.
    const key = cfg ? cfg.id : UNKNOWN_ID;
    buckets.set(key, b);
    return b;
  };

  for (const t of tickets) {
    if (t.partnerId !== partnerId) continue;
    if (!inWindow(t.createdAt, window)) continue;
    const cfg = configById.get(t.dept);
    const bucketKey = cfg ? cfg.id : UNKNOWN_ID;
    const bucket = ensure(bucketKey);
    bucket.volume += 1;
    if (t.firstStaffResponseAt) {
      bucket.ticketsWithResponse += 1;
      if (cfg?.sla?.enabled && cfg.sla.firstResponseMinutes) {
        const minutes =
          (t.firstStaffResponseAt.getTime() - t.createdAt.getTime()) / 60000;
        if (minutes <= cfg.sla.firstResponseMinutes) {
          bucket.ticketsMetSla += 1;
        }
      }
    }
  }

  for (const r of ratings) {
    if (r.partnerId !== partnerId) continue;
    if (!inWindow(r.createdAt, window)) continue;
    if (!buckets.has(configById.has(r.dept) ? r.dept : UNKNOWN_ID)) continue;
    const bucket = buckets.get(configById.has(r.dept) ? r.dept : UNKNOWN_ID)!;
    bucket.ratingSum += r.rating;
    bucket.ratingCount += 1;
  }

  for (const b of breaches) {
    if (b.partnerId !== partnerId) continue;
    if (!inWindow(b.breachedAt, window)) continue;
    const bucketKey = configById.has(b.dept) ? b.dept : UNKNOWN_ID;
    if (!buckets.has(bucketKey)) continue;
    buckets.get(bucketKey)!.breachCount += 1;
  }

  const rows: DeptRow[] = Array.from(buckets.values()).map((b) => ({
    id: b.id,
    name: b.name,
    volume: b.volume,
    slaPct:
      b.slaTrackable && b.ticketsWithResponse > 0
        ? round1((b.ticketsMetSla / b.ticketsWithResponse) * 100)
        : null,
    csat: b.ratingCount > 0 ? round1(b.ratingSum / b.ratingCount) : null,
    breachCount: b.breachCount,
  }));

  rows.sort((a, b) => b.volume - a.volume);
  return rows;
}
