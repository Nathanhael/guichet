import { eq, and, ne, desc, inArray, sql } from 'drizzle-orm';
import { db } from '../db/postgres.js';
import { tickets, ticketLabels, labels, ratings } from '../db/schema.js';

// ── SELECT queries ──────────────────────────────────────────────────────────

/**
 * Fetches just the partnerId for a ticket (used for tenant isolation checks).
 * Used by: message:delivered, message:read, message:edit, message:delete,
 *          ticket:labels:update, ticket:viewing
 */
export async function findTicketPartner(ticketId: string) {
  const rows = await db
    .select({ partnerId: tickets.partnerId })
    .from(tickets)
    .where(eq(tickets.id, ticketId));
  return rows[0];
}


/**
 * Fetches full ticket info needed for support:join.
 */
export async function findTicketForJoin(ticketId: string) {
  const rows = await db
    .select({
      id: tickets.id,
      partnerId: tickets.partnerId,
      agentId: tickets.agentId,
      supportId: tickets.supportId,
      supportName: tickets.supportName,
      supportLang: tickets.supportLang,
      supportJoinedAt: tickets.supportJoinedAt,
      status: tickets.status,
      participants: tickets.participants,
    })
    .from(tickets)
    .where(eq(tickets.id, ticketId));
  return rows[0];
}

/**
 * Fetches ticket status and partner for close authorization.
 * Used by: ticket:close
 */
export async function findTicketForClose(ticketId: string) {
  const rows = await db
    .select({ status: tickets.status, partnerId: tickets.partnerId, agentId: tickets.agentId, supportId: tickets.supportId, supportName: tickets.supportName })
    .from(tickets)
    .where(eq(tickets.id, ticketId));
  return rows[0];
}

/**
 * Fetches ticket owner info for rating authorization.
 * Used by: rating:submit
 */
export async function findTicketOwner(ticketId: string) {
  const rows = await db
    .select({
      partnerId: tickets.partnerId,
      agentId: tickets.agentId,
      supportId: tickets.supportId,
      dept: tickets.dept,
      status: tickets.status,
      closedAt: tickets.closedAt,
    })
    .from(tickets)
    .where(eq(tickets.id, ticketId));
  return rows[0];
}

/**
 * Fetches ticket participants and partnerId.
 * Used by: support:leave
 */
export async function findTicketParticipants(ticketId: string) {
  const rows = await db
    .select({ partnerId: tickets.partnerId, supportId: tickets.supportId, participants: tickets.participants })
    .from(tickets)
    .where(eq(tickets.id, ticketId));
  return rows[0];
}

/**
 * Fetches ticket status and partner for message:send authorization.
 * Used by: message:send
 */
export async function findTicketForMessage(ticketId: string) {
  const rows = await db
    .select({
      status: tickets.status,
      partnerId: tickets.partnerId,
      agentId: tickets.agentId,
      agentLang: tickets.agentLang,
    })
    .from(tickets)
    .where(eq(tickets.id, ticketId));
  return rows[0];
}

/**
 * Fetches recently closed tickets for reopen detection.
 * Used by: ticket:new
 */
export async function findRecentClosedTickets(partnerId: string, limit: number) {
  return db
    .select({ id: tickets.id, reopenCount: tickets.reopenCount, references: tickets.references })
    .from(tickets)
    .where(and(eq(tickets.partnerId, partnerId), eq(tickets.status, 'closed')))
    .orderBy(desc(tickets.createdAt))
    .limit(limit);
}

/**
 * Fetches active (non-closed) ticket IDs for an agent. Used during reconnect.
 * Used by: socket:identify
 */
export async function findActiveTicketsForAgent(userId: string, partnerId: string) {
  return db
    .select({ id: tickets.id })
    .from(tickets)
    .where(and(eq(tickets.agentId, userId), eq(tickets.partnerId, partnerId), ne(tickets.status, 'closed')));
}

/**
 * Fetches active ticket IDs for a support user (by supportId or JSONB participant).
 * Uses raw SQL for JSONB @> containment operator.
 * Used by: socket:identify
 */
export async function findActiveTicketsForSupport(userId: string, partnerId: string) {
  return db
    .select({ id: tickets.id })
    .from(tickets)
    .where(
      and(
        eq(tickets.partnerId, partnerId),
        ne(tickets.status, 'closed'),
        sql`(${tickets.supportId} = ${userId} OR ${tickets.participants}::jsonb @> ${JSON.stringify([{ id: userId }])}::jsonb)`,
      ),
    );
}

/**
 * Fetches ticket info for transfer authorization.
 * Used by: ticket:transfer
 */
export async function findTicketForTransfer(ticketId: string) {
  const rows = await db
    .select({
      id: tickets.id,
      partnerId: tickets.partnerId,
      supportId: tickets.supportId,
      supportName: tickets.supportName,
      participants: tickets.participants,
    })
    .from(tickets)
    .where(eq(tickets.id, ticketId));
  return rows[0];
}

/**
 * Fetches all labels belonging to a partner. Used for label validation.
 * Used by: ticket:labels:update
 */
export async function findPartnerLabels(partnerId: string, labelIds: string[]) {
  return db
    .select({ id: labels.id })
    .from(labels)
    .where(and(eq(labels.partnerId, partnerId), inArray(labels.id, labelIds)));
}

// ── INSERT / UPDATE queries ─────────────────────────────────────────────────
//
// The lifecycle slice (createTicket, closeTicket, transferTicket,
// transferTicketToDepartment, returnTicketToQueue, assignSupport,
// findUpdatedParticipants, updateParticipants) was absorbed into
// `services/ticketLifecycle/` in the deepening refactor (see
// docs/superpowers/specs/2026-04-26-deepen-ticketLifecycle-prd.md).
// Read-side helpers (`findTicketPartner`, `findTicketForJoin`,
// `findTicketForClose`, `findTicketForTransfer`, etc.) stay here because
// `partnerScope` guards and other handlers depend on them.

/**
 * Atomically replaces all labels on a ticket.
 * Used by: ticket:labels:update
 */
export async function replaceTicketLabels(ticketId: string, labelIds: string[]) {
  await db.transaction(async (tx) => {
    await tx.delete(ticketLabels).where(eq(ticketLabels.ticketId, ticketId));
    if (labelIds.length > 0) {
      await tx.insert(ticketLabels).values(
        labelIds.map((labelId) => ({ ticketId, labelId })),
      );
    }
  });
}

/**
 * Inserts a rating (ON CONFLICT DO NOTHING for idempotency).
 * Used by: rating:submit
 */
export async function insertRating(data: {
  id: string;
  ticketId: string;
  agentId: string;
  supportId: string;
  partnerId: string;
  rating: number;
  comment: string | null;
  dept: string | null;
  closedAt: string | null;
}) {
  await db.insert(ratings).values({
    id: data.id,
    ticketId: data.ticketId,
    agentId: data.agentId,
    supportId: data.supportId,
    partnerId: data.partnerId,
    rating: data.rating,
    comment: data.comment,
    dept: data.dept ?? undefined,
    closedAt: data.closedAt ?? undefined,
  }).onConflictDoNothing({ target: ratings.ticketId });
}
