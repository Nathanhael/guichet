/**
 * Dashboard Z1 — Action list query layer.
 *
 * Thin Drizzle queries that feed `buildActionList` (pure transform). Every
 * query is partner-scoped at the SQL level; the deep service then re-checks
 * `partnerId` row-by-row as defense-in-depth.
 *
 * Window semantics: `from..to` inclusive. The `pendingInvites` query has no
 * window — it returns the current snapshot of unclaimed B2B guests for the
 * partner; the deep service synthesizes `expiresAt = createdAt + 30 days`.
 */

import { and, desc, eq, gte, isNull, isNotNull, lte } from 'drizzle-orm';
import { db } from '../../db.js';
import {
  appFeedback,
  memberships,
  slaBreaches,
  tickets,
  users,
} from '../../db/schema.js';
import type {
  RawAbandonedRow,
  RawBreachRow,
  RawFeedbackRow,
  RawInviteRow,
} from './actionList.js';

const INVITE_WINDOW_DAYS = 30;

export async function fetchSlaBreaches(
  partnerId: string,
  from: Date,
  to: Date,
): Promise<RawBreachRow[]> {
  const rows = await db
    .select({
      id: slaBreaches.id,
      partnerId: slaBreaches.partnerId,
      ticketId: slaBreaches.ticketId,
      ticketTitle: tickets.agentName,
      breachedAt: slaBreaches.breachedAt,
    })
    .from(slaBreaches)
    .innerJoin(tickets, eq(tickets.id, slaBreaches.ticketId))
    .where(
      and(
        eq(slaBreaches.partnerId, partnerId),
        gte(slaBreaches.breachedAt, from.toISOString()),
        lte(slaBreaches.breachedAt, to.toISOString()),
      ),
    )
    .orderBy(desc(slaBreaches.breachedAt));

  return rows.map((r) => ({
    id: r.id,
    partnerId: r.partnerId,
    ticketId: r.ticketId,
    ticketTitle: r.ticketTitle ?? '',
    breachedAt: new Date(r.breachedAt),
  }));
}

export async function fetchAbandonedTickets(
  partnerId: string,
  from: Date,
  to: Date,
): Promise<RawAbandonedRow[]> {
  const rows = await db
    .select({
      id: tickets.id,
      partnerId: tickets.partnerId,
      title: tickets.agentName,
      closedAt: tickets.closedAt,
    })
    .from(tickets)
    .where(
      and(
        eq(tickets.partnerId, partnerId),
        eq(tickets.status, 'closed'),
        isNull(tickets.supportJoinedAt),
        isNotNull(tickets.closedAt),
        gte(tickets.closedAt, from.toISOString()),
        lte(tickets.closedAt, to.toISOString()),
      ),
    )
    .orderBy(desc(tickets.closedAt));

  return rows.map((r) => ({
    id: r.id,
    partnerId: r.partnerId,
    title: r.title ?? '',
    abandonedAt: new Date(r.closedAt!),
  }));
}

export async function fetchUntreatedFeedback(
  partnerId: string,
  from: Date,
  to: Date,
): Promise<RawFeedbackRow[]> {
  const rows = await db
    .select({
      id: appFeedback.id,
      partnerId: appFeedback.partnerId,
      type: appFeedback.role,
      body: appFeedback.text,
      submittedAt: appFeedback.createdAt,
      treated: appFeedback.treated,
    })
    .from(appFeedback)
    .where(
      and(
        eq(appFeedback.partnerId, partnerId),
        eq(appFeedback.treated, 0),
        gte(appFeedback.createdAt, from.toISOString()),
        lte(appFeedback.createdAt, to.toISOString()),
      ),
    )
    .orderBy(desc(appFeedback.createdAt));

  return rows.map((r) => ({
    id: r.id,
    partnerId: r.partnerId,
    type: r.type ?? 'feedback',
    body: r.body,
    submittedAt: new Date(r.submittedAt),
    treated: (r.treated ?? 0) === 1,
  }));
}

/**
 * Pending invites = B2B guests provisioned for the partner that have not
 * yet linked an Entra externalId. The schema has no `expiresAt` column, so
 * we synthesize one as `createdAt + 30 days` to match the deep service
 * contract; older invites flow through the deep service's expiry filter.
 */
export async function fetchPendingInvites(partnerId: string): Promise<RawInviteRow[]> {
  const rows = await db
    .select({
      id: memberships.id,
      partnerId: memberships.partnerId,
      email: users.email,
      role: memberships.role,
      createdAt: memberships.createdAt,
    })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(
      and(
        eq(memberships.partnerId, partnerId),
        eq(users.isExternal, true),
        isNull(users.externalId),
        isNull(users.deletedAt),
        isNotNull(users.email),
      ),
    )
    .orderBy(desc(memberships.createdAt));

  const ms = INVITE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return rows
    .filter((r): r is typeof r & { email: string } => r.email !== null)
    .map((r) => {
      const created = new Date(r.createdAt);
      return {
        id: r.id,
        partnerId: r.partnerId,
        email: r.email,
        role: r.role,
        expiresAt: new Date(created.getTime() + ms),
        claimedAt: null,
      };
    });
}

