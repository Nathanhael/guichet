import { eq, and, ne, desc, sql, inArray } from 'drizzle-orm';
import { db } from '../db/postgres.js';
import { tickets, ticketLabels, labels, ratings } from '../db/schema.js';
import { snapshotTicketToArchive } from './archive.js';
import logger from '../utils/logger.js';

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

export interface CreateTicketData {
  id: string;
  partnerId: string;
  dept: string;
  agentId: string;
  agentName: string;
  agentLang: string;
  references: Array<{ label: string; value: string }>;
  status: string;
  createdAt: string;
  participants: Array<{ id: string; name: string }>;
  reopened: boolean;
  reopenCount: number;
}

/**
 * Inserts a new ticket.
 * Used by: ticket:new
 */
export async function createTicket(data: CreateTicketData) {
  await db.insert(tickets).values({
    id: data.id,
    partnerId: data.partnerId,
    dept: data.dept,
    agentId: data.agentId,
    agentName: data.agentName,
    agentLang: data.agentLang,
    references: data.references,
    status: data.status as 'open',
    createdAt: data.createdAt,
    participants: data.participants,
    reopened: data.reopened,
    reopenCount: data.reopenCount,
  });
}

/**
 * Assigns support to a ticket using COALESCE for idempotency + JSONB participant append.
 * Uses Drizzle `sql` tag for the JSONB conditional append. Both CASE branches return jsonb
 * (the column type), so no cast to text is needed — and mixing text/jsonb branches in the
 * same CASE fails at runtime with "CASE types text and jsonb cannot be matched".
 * Used by: support:join
 */
export async function assignSupport(
  ticketId: string,
  supportId: string,
  supportName: string,
  supportLang: string,
  /**
   * Azure B2B guest flag for the joining support user. Denormalized onto
   * the `tickets.participants` JSONB entry so ChatHeader can render the
   * amber guest ring even when the participant is offline. Defaults to
   * false for backward compatibility with callers that haven't resolved
   * the flag. See docs/superpowers/specs/partner-sso-b2b-guest.md.
   */
  supportIsExternal: boolean = false,
) {
  const participantJson = JSON.stringify({
    id: supportId,
    name: supportName,
    isExternal: supportIsExternal,
  });
  await db.execute(sql`UPDATE tickets SET
    support_id = COALESCE(support_id, ${supportId}),
    support_name = COALESCE(support_name, ${supportName}),
    support_lang = COALESCE(support_lang, ${supportLang}),
    support_joined_at = COALESCE(support_joined_at, ${new Date().toISOString()}),
    participants = CASE
      WHEN NOT (COALESCE(participants, '[]'::jsonb) @> ${`[${participantJson}]`}::jsonb)
      THEN COALESCE(participants, '[]'::jsonb) || ${participantJson}::jsonb
      ELSE participants
    END,
    status = 'open'
  WHERE id = ${ticketId}`);
}

/**
 * Reads back updated participants after assignment.
 * Used by: support:join
 */
export async function findUpdatedParticipants(ticketId: string) {
  const rows = await db
    .select({ participants: tickets.participants })
    .from(tickets)
    .where(eq(tickets.id, ticketId));
  return rows[0]?.participants;
}

/**
 * Updates ticket participants JSONB.
 * Used by: support:leave
 */
export async function updateParticipants(ticketId: string, participants: Array<{ id: string; name: string }>) {
  await db
    .update(tickets)
    .set({ participants })
    .where(eq(tickets.id, ticketId));
}

/**
 * Closes a ticket with timestamp, closer name, and notes.
 * Used by: ticket:close
 */
export async function closeTicket(ticketId: string, closedBy: string, closingNotes: string) {
  const now = new Date().toISOString();
  await db
    .update(tickets)
    .set({ status: 'closed', closedAt: now, closedBy, closingNotes })
    .where(eq(tickets.id, ticketId));
  // Fire-and-forget snapshot into archived_tickets so AdminArchive shows it immediately.
  // Live row + messages stay until the scheduled GDPR/archive job purges them.
  snapshotTicketToArchive(ticketId).catch((err: unknown) => {
    logger.error({ err, ticketId }, '[ticketQueries] snapshotTicketToArchive failed');
  });
  return now;
}

/**
 * Transfers ticket to a new support agent using JSONB participant manipulation.
 * Uses raw SQL for the complex JSONB filter + append.
 * Used by: ticket:transfer (to specific agent)
 */
export async function transferTicket(
  ticketId: string,
  targetSupportId: string,
  targetName: string,
  senderId: string,
) {
  const newParticipantJson = JSON.stringify({ id: targetSupportId, name: targetName });
  await db.execute(sql`UPDATE tickets SET
    support_id = ${targetSupportId},
    support_name = ${targetName},
    participants = (
      SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb) || ${newParticipantJson}::jsonb
      FROM jsonb_array_elements(COALESCE(participants, '[]')::jsonb) AS elem
      WHERE elem->>'id' != ${senderId} AND elem->>'id' != ${targetSupportId}
    )
  WHERE id = ${ticketId}`);
}

/**
 * Returns ticket to queue — unassigns support and strips them from participants.
 *
 * When `supportId` is provided, the UPDATE is guarded by `support_id = supportId`
 * (atomic — prevents racing with a concurrent claim) and also filters the
 * outgoing support out of the participants JSONB array so a stale
 * `support:rejoin` from that user can't re-enter the ticket after it's
 * reclaimed by a different support.
 *
 * Returns true if a row was updated.
 *
 * Used by: ticket:transfer (return-to-queue), support:leave, ticketReclaim
 */
export async function returnTicketToQueue(
  ticketId: string,
  supportId?: string,
): Promise<boolean> {
  if (supportId) {
    const res = await db.execute(sql`UPDATE tickets SET
      support_id = NULL,
      support_name = NULL,
      support_joined_at = NULL,
      status = 'open',
      participants = (
        SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
        FROM jsonb_array_elements(COALESCE(participants, '[]')::jsonb) AS elem
        WHERE elem->>'id' != ${supportId}
      )
    WHERE id = ${ticketId} AND support_id = ${supportId}`);
    return (res.rowCount ?? 0) > 0;
  }
  const res = await db
    .update(tickets)
    .set({ supportId: null, supportName: null, supportJoinedAt: null, status: 'open' })
    .where(eq(tickets.id, ticketId));
  return (res.rowCount ?? 0) > 0;
}

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
