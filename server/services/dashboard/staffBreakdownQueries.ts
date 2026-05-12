/**
 * Dashboard Z5 — Staff breakdown query layer.
 *
 * Pulls every input `buildStaffBreakdown` needs for the requested partner
 * and window in a single fan-out: tickets with a support assignment
 * (volume + response times), ratings tied to a support agent (CSAT), and
 * a name map for support members from `users`. The deep service folds the
 * three streams into one row per agent.
 */

import { and, eq, gte, isNotNull, lte, inArray } from 'drizzle-orm';
import { db } from '../../db.js';
import { ratings, tickets, users } from '../../db/schema.js';
import type {
  RawStaffRatingRow,
  RawStaffTicketRow,
} from './staffBreakdown.js';

export interface StaffBreakdownData {
  tickets: RawStaffTicketRow[];
  ratings: RawStaffRatingRow[];
  staffNames: Map<string, string>;
}

/** @internal — call via `dashboard.compute({ metric: 'staffBreakdown' })`. */
export async function fetchStaffBreakdownData(
  partnerId: string,
  from: Date,
  to: Date,
): Promise<StaffBreakdownData> {
  const [ticketRows, ratingRows] = await Promise.all([
    db
      .select({
        id: tickets.id,
        partnerId: tickets.partnerId,
        supportId: tickets.supportId,
        createdAt: tickets.createdAt,
        firstStaffResponseAt: tickets.firstStaffResponseAt,
      })
      .from(tickets)
      .where(
        and(
          eq(tickets.partnerId, partnerId),
          isNotNull(tickets.supportId),
          gte(tickets.createdAt, from.toISOString()),
          lte(tickets.createdAt, to.toISOString()),
        ),
      ),
    db
      .select({
        id: ratings.id,
        partnerId: ratings.partnerId,
        supportId: ratings.supportId,
        rating: ratings.rating,
        createdAt: ratings.createdAt,
      })
      .from(ratings)
      .where(
        and(
          eq(ratings.partnerId, partnerId),
          isNotNull(ratings.supportId),
          isNotNull(ratings.rating),
          gte(ratings.createdAt, from.toISOString()),
          lte(ratings.createdAt, to.toISOString()),
        ),
      ),
  ]);

  const staffIds = new Set<string>();
  for (const t of ticketRows) if (t.supportId) staffIds.add(t.supportId);
  for (const r of ratingRows) if (r.supportId) staffIds.add(r.supportId);

  const nameMap = new Map<string, string>();
  if (staffIds.size > 0) {
    const userRows = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, Array.from(staffIds)));
    for (const u of userRows) nameMap.set(u.id, u.name);
  }

  return {
    staffNames: nameMap,
    tickets: ticketRows
      .filter((r): r is typeof r & { partnerId: string; supportId: string } =>
        r.partnerId !== null && r.supportId !== null,
      )
      .map((r) => ({
        id: r.id,
        partnerId: r.partnerId,
        supportId: r.supportId,
        createdAt: new Date(r.createdAt),
        firstStaffResponseAt: r.firstStaffResponseAt
          ? new Date(r.firstStaffResponseAt)
          : null,
      })),
    ratings: ratingRows
      .filter((r): r is typeof r & { partnerId: string; supportId: string } =>
        r.partnerId !== null && r.supportId !== null,
      )
      .map((r) => ({
        id: r.id,
        partnerId: r.partnerId,
        supportId: r.supportId,
        rating: r.rating,
        createdAt: new Date(r.createdAt),
      })),
  };
}
