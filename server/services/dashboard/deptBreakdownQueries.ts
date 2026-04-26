/**
 * Dashboard Z5 — Department breakdown query layer.
 *
 * Single fan-out helper that pulls everything `buildDeptBreakdown` needs
 * for the requested partner + window: tickets (volume + SLA), ratings
 * (CSAT), sla_breaches (breach count), and the partner's departments
 * config (name lookup + per-dept SLA threshold). One round trip per data
 * source — the deep service folds them into one row per dept.
 */

import { and, eq, gte, isNotNull, lte } from 'drizzle-orm';
import { db } from '../../db.js';
import { partners, ratings, slaBreaches, tickets } from '../../db/schema.js';
import type {
  DeptConfig,
  RawBreachRow,
  RawRatingRow,
  RawTicketRow,
} from './deptBreakdown.js';

export interface DeptBreakdownData {
  tickets: RawTicketRow[];
  ratings: RawRatingRow[];
  breaches: RawBreachRow[];
  departments: DeptConfig[];
}

interface PartnerDept {
  id: string;
  name?: string;
  sla?: { enabled?: boolean; firstResponseMinutes?: number };
}

async function loadDepartments(partnerId: string): Promise<DeptConfig[]> {
  const rows = await db
    .select({ departments: partners.departments })
    .from(partners)
    .where(eq(partners.id, partnerId))
    .limit(1);

  const raw = (rows[0]?.departments as PartnerDept[] | null) ?? [];
  return raw
    .filter((d) => d?.id)
    .map((d) => ({
      id: d.id,
      name: d.name ?? d.id,
      sla: d.sla
        ? {
            enabled: d.sla.enabled !== false,
            firstResponseMinutes: d.sla.firstResponseMinutes ?? 0,
          }
        : undefined,
    }));
}

export async function fetchDeptBreakdownData(
  partnerId: string,
  from: Date,
  to: Date,
): Promise<DeptBreakdownData> {
  const [departments, ticketRows, ratingRows, breachRows] = await Promise.all([
    loadDepartments(partnerId),
    db
      .select({
        id: tickets.id,
        partnerId: tickets.partnerId,
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
        ),
      ),
    db
      .select({
        id: ratings.id,
        partnerId: ratings.partnerId,
        dept: ratings.dept,
        rating: ratings.rating,
        createdAt: ratings.createdAt,
      })
      .from(ratings)
      .where(
        and(
          eq(ratings.partnerId, partnerId),
          gte(ratings.createdAt, from.toISOString()),
          lte(ratings.createdAt, to.toISOString()),
          isNotNull(ratings.dept),
          isNotNull(ratings.rating),
        ),
      ),
    db
      .select({
        id: slaBreaches.id,
        partnerId: slaBreaches.partnerId,
        dept: slaBreaches.dept,
        breachedAt: slaBreaches.breachedAt,
      })
      .from(slaBreaches)
      .where(
        and(
          eq(slaBreaches.partnerId, partnerId),
          gte(slaBreaches.breachedAt, from.toISOString()),
          lte(slaBreaches.breachedAt, to.toISOString()),
        ),
      ),
  ]);

  return {
    departments,
    tickets: ticketRows
      .filter((r): r is typeof r & { partnerId: string } => r.partnerId !== null)
      .map((r) => ({
        id: r.id,
        partnerId: r.partnerId,
        dept: r.dept,
        createdAt: new Date(r.createdAt),
        firstStaffResponseAt: r.firstStaffResponseAt
          ? new Date(r.firstStaffResponseAt)
          : null,
      })),
    ratings: ratingRows
      .filter((r): r is typeof r & { partnerId: string; dept: string } =>
        r.partnerId !== null && r.dept !== null,
      )
      .map((r) => ({
        id: r.id,
        partnerId: r.partnerId,
        dept: r.dept,
        rating: r.rating,
        createdAt: new Date(r.createdAt),
      })),
    breaches: breachRows.map((r) => ({
      id: r.id,
      partnerId: r.partnerId,
      dept: r.dept,
      breachedAt: new Date(r.breachedAt),
    })),
  };
}
