/**
 * Dashboard Z2 — Scorecard query layer.
 *
 * Aggregates per-period totals into a `PeriodRollup` consumed by the pure
 * `buildScorecard` deep service. One round trip per period: tickets (for
 * volume / SLA / response-time stats) + ratings (for CSAT).
 *
 * SLA-met decisions use `elapsedBusinessMinutes` from services/sla so the
 * scorecard agrees with the breach sweep on the same ticket — both branches
 * pause the clock outside the partner's business hours.
 *
 * The p95 response-time metric stays wall-clock — it tracks "customer wait"
 * which is the right semantic for satisfaction analytics, independent of
 * whether staff were on the clock.
 *
 * Window semantics: `from..to` inclusive, anchored on ticket `createdAt`.
 */

import { and, eq, gte, isNotNull, lte, sql } from 'drizzle-orm';
import { db } from '../../db.js';
import { partners, ratings, tickets } from '../../db/schema.js';
import { calculatePercentile } from '../stats.js';
import type { BusinessHoursSchedule } from '../businessHours.js';
import {
  elapsedBusinessMinutes,
  extractPartnerSlaContext,
  type DepartmentSlaConfig,
  type PartnerSlaContext,
} from '../sla/index.js';
import type { PeriodRollup } from './scorecard.js';

async function loadPartnerSlaContext(partnerId: string): Promise<PartnerSlaContext> {
  const rows = await db
    .select({
      departments: partners.departments,
      businessHoursSchedule: partners.businessHoursSchedule,
    })
    .from(partners)
    .where(eq(partners.id, partnerId))
    .limit(1);

  return extractPartnerSlaContext({
    departments: rows[0]?.departments,
    businessHoursSchedule: rows[0]?.businessHoursSchedule as BusinessHoursSchedule | null | undefined,
  });
}

interface RollupTicketRow {
  dept: string;
  createdAt: string;
  firstStaffResponseAt: string | null;
}

interface RollupClassification {
  ticketsMetSla: number;
  ticketsWithResponse: number;
  responseMinutesList: number[];
}

/**
 * Pure classifier for the SLA-met / response-time portion of the rollup.
 * Exported for unit testing; `fetchPeriodRollup` is the SQL wrapper.
 */
export function classifyRollupRows(
  rows: ReadonlyArray<RollupTicketRow>,
  slaMap: Map<string, DepartmentSlaConfig>,
  schedule: BusinessHoursSchedule,
): RollupClassification {
  let ticketsMetSla = 0;
  let ticketsWithResponse = 0;
  const responseMinutesList: number[] = [];

  for (const row of rows) {
    if (!row.firstStaffResponseAt) continue;
    const responseMs =
      new Date(row.firstStaffResponseAt).getTime() -
      new Date(row.createdAt).getTime();
    if (responseMs < 0) continue;
    ticketsWithResponse += 1;
    // Wall-clock for the customer-wait analytics (p95).
    responseMinutesList.push(responseMs / 60000);

    // SLA-met: business-hours-corrected — matches services/sla/sweep.ts.
    const config = slaMap.get(row.dept);
    if (config && config.enabled) {
      const bhMinutes = elapsedBusinessMinutes(
        new Date(row.createdAt),
        new Date(row.firstStaffResponseAt),
        schedule,
      );
      if (bhMinutes <= config.firstResponseMinutes) ticketsMetSla += 1;
    }
  }

  return { ticketsMetSla, ticketsWithResponse, responseMinutesList };
}

/** @internal — call via `dashboard.compute({ metric: 'scorecard' })`. */
export async function fetchPeriodRollup(
  partnerId: string,
  from: Date,
  to: Date,
  dept?: string,
): Promise<PeriodRollup> {
  const { slaMap, schedule } = await loadPartnerSlaContext(partnerId);

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

  const { ticketsMetSla, ticketsWithResponse, responseMinutesList } =
    classifyRollupRows(ticketRows, slaMap, schedule);

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
