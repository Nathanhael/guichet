/**
 * Dashboard Z5 — Staff breakdown deep service.
 *
 * Pure transform: takes pre-fetched tickets + ratings (already partner-
 * scoped at the DB) plus a `staffNames` map, returns one `StaffRow` per
 * support agent who handled at least one in-window ticket. Sorted by
 * `handled` descending so heaviest-load agents lead.
 *
 * Tickets without a `supportId` are skipped entirely — staff analytics
 * shouldn't synthesize an "Unassigned" bucket. Use the queue / abandoned
 * surfaces for unattributed work.
 *
 * Defense-in-depth: every row's `partnerId` is verified against input.
 */

export interface DateWindow {
  from: Date;
  to: Date;
}

export interface RawStaffTicketRow {
  id: string;
  partnerId: string;
  supportId: string | null;
  createdAt: Date;
  firstStaffResponseAt: Date | null;
}

export interface RawStaffRatingRow {
  id: string;
  partnerId: string;
  supportId: string | null;
  rating: number;
  createdAt: Date;
}

export interface StaffBreakdownInput {
  partnerId: string;
  window: DateWindow;
  tickets: RawStaffTicketRow[];
  ratings: RawStaffRatingRow[];
  staffNames: Map<string, string>;
}

export interface StaffRow {
  id: string;
  name: string;
  handled: number;
  avgResponseMinutes: number | null;
  csat: number | null;
}

interface Bucket {
  id: string;
  handled: number;
  responseSum: number;
  responseCount: number;
  ratingSum: number;
  ratingCount: number;
}

function inWindow(t: Date, w: DateWindow): boolean {
  return t.getTime() >= w.from.getTime() && t.getTime() <= w.to.getTime();
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function buildStaffBreakdown(input: StaffBreakdownInput): StaffRow[] {
  const { partnerId, window, tickets, ratings, staffNames } = input;
  const buckets = new Map<string, Bucket>();

  const ensure = (id: string): Bucket => {
    let b = buckets.get(id);
    if (b) return b;
    b = {
      id,
      handled: 0,
      responseSum: 0,
      responseCount: 0,
      ratingSum: 0,
      ratingCount: 0,
    };
    buckets.set(id, b);
    return b;
  };

  for (const t of tickets) {
    if (t.partnerId !== partnerId) continue;
    if (!t.supportId) continue;
    if (!inWindow(t.createdAt, window)) continue;
    const b = ensure(t.supportId);
    b.handled += 1;
    if (t.firstStaffResponseAt) {
      const minutes =
        (t.firstStaffResponseAt.getTime() - t.createdAt.getTime()) / 60000;
      if (minutes >= 0) {
        b.responseSum += minutes;
        b.responseCount += 1;
      }
    }
  }

  for (const r of ratings) {
    if (r.partnerId !== partnerId) continue;
    if (!r.supportId) continue;
    if (!inWindow(r.createdAt, window)) continue;
    if (!buckets.has(r.supportId)) continue;
    const b = buckets.get(r.supportId)!;
    b.ratingSum += r.rating;
    b.ratingCount += 1;
  }

  const rows: StaffRow[] = Array.from(buckets.values()).map((b) => ({
    id: b.id,
    name: staffNames.get(b.id) ?? b.id,
    handled: b.handled,
    avgResponseMinutes:
      b.responseCount > 0 ? round1(b.responseSum / b.responseCount) : null,
    csat: b.ratingCount > 0 ? round1(b.ratingSum / b.ratingCount) : null,
  }));

  rows.sort((a, b) => b.handled - a.handled);
  return rows;
}
