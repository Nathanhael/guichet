/**
 * Dashboard Z2 — Scorecard query layer.
 *
 * Aggregates per-period totals into a `PeriodRollup` consumed by the pure
 * `buildScorecard` deep service. One round trip per period: tickets (for
 * volume / SLA / response-time stats) + ratings (for CSAT). Per-ticket
 * SLA-met decisions use `partner.departments[].sla.firstResponseMinutes`
 * — out-of-band SLA configs (disabled, missing) drop to "not counted".
 *
 * Window semantics: `from..to` inclusive, anchored on ticket `createdAt`.
 */

import { and, eq, gte, isNotNull, lte, sql } from 'drizzle-orm';
import { db } from '../../db.js';
import { partners, ratings, tickets } from '../../db/schema.js';
import { calculatePercentile } from '../stats.js';
import type { PeriodRollup } from './scorecard.js';

interface DeptSlaConfig {
  enabled: boolean;
  firstResponseMinutes: number;
}

interface PartnerDept {
  id: string;
  sla?: { enabled?: boolean; firstResponseMinutes?: number };
}

async function loadDeptSlaMap(partnerId: string): Promise<Map<string, DeptSlaConfig>> {
  const rows = await db
    .select({ departments: partners.departments })
    .from(partners)
    .where(eq(partners.id, partnerId))
    .limit(1);

  const map = new Map<string, DeptSlaConfig>();
  const depts = (rows[0]?.departments as PartnerDept[] | null) ?? [];
  for (const dept of depts) {
    if (dept?.id && dept.sla?.firstResponseMinutes) {
      map.set(dept.id, {
        enabled: dept.sla.enabled !== false,
        firstResponseMinutes: dept.sla.firstResponseMinutes,
      });
    }
  }
  return map;
}

export async function fetchPeriodRollup(
  partnerId: string,
  from: Date,
  to: Date,
  dept?: string,
): Promise<PeriodRollup> {
  const slaMap = await loadDeptSlaMap(partnerId);

  const ticketRows = await db
    .select({
      id: tickets.id,
      dept: tickets.dept,
      createdAt: tickets.createdAt,
      firstStaffResponseAt: tickets.firstStaffResponseAt,
    })
    .from(tickets)
    .where(
      and(
        eq(tickets.partnerId, partnerId),
        gte(tickets.createdAt, from.toISOString()),
        lte(tickets.createdAt, to.toISOString()),
        dept ? eq(tickets.dept, dept) : sql`TRUE`,
      ),
    );

  let ticketsMetSla = 0;
  let ticketsWithResponse = 0;
  const responseMinutesList: number[] = [];

  for (const row of ticketRows) {
    if (!row.firstStaffResponseAt) continue;
    const responseMs =
      new Date(row.firstStaffResponseAt).getTime() -
      new Date(row.createdAt).getTime();
    if (responseMs < 0) continue;
    const minutes = responseMs / 60000;
    ticketsWithResponse += 1;
    responseMinutesList.push(minutes);
    const config = slaMap.get(row.dept);
    if (config && config.enabled && minutes <= config.firstResponseMinutes) {
      ticketsMetSla += 1;
    }
  }

  const ratingRows = await db
    .select({
      rating: ratings.rating,
    })
    .from(ratings)
    .where(
      and(
        eq(ratings.partnerId, partnerId),
        gte(ratings.createdAt, from.toISOString()),
        lte(ratings.createdAt, to.toISOString()),
        dept ? eq(ratings.dept, dept) : sql`TRUE`,
        isNotNull(ratings.rating),
      ),
    );

  let ratingSum = 0;
  let ratingCount = 0;
  for (const row of ratingRows) {
    ratingSum += row.rating;
    ratingCount += 1;
  }

  const p95Ms = responseMinutesList.length
    ? calculatePercentile(responseMinutesList.map((m) => m * 60000), 95)
    : 0;
  const p95ResponseMinutes = p95Ms > 0 ? Math.round(p95Ms / 60000) : null;

  return {
    totalTickets: ticketRows.length,
    ticketsMetSla,
    ticketsWithResponse,
    ratingSum,
    ratingCount,
    p95ResponseMinutes,
  };
}
