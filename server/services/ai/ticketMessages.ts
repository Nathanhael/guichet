/**
 * Shared ticket message helpers for AI features.
 *
 * Used by both the tRPC ai router (summarizeChat) and the
 * fire-and-forget autoSummarize service to avoid duplicated
 * DB queries and tenant-isolation checks.
 */

import { db } from '../../db.js';
import { messages as messagesTable, tickets } from '../../db/schema.js';
import { eq, and, asc, isNull } from 'drizzle-orm';

interface TicketMessage {
  senderName: string | null;
  senderRole: string | null;
  text: string | null;
}

/**
 * Verify a ticket exists and belongs to the given partner.
 * Returns the ticket row or null if not found / wrong partner.
 */
export async function verifyTicketOwnership(
  ticketId: string,
  partnerId: string,
): Promise<{ id: string } | null> {
  const [ticket] = await db
    .select({ id: tickets.id })
    .from(tickets)
    .where(and(eq(tickets.id, ticketId), eq(tickets.partnerId, partnerId)))
    .limit(1);

  return ticket ?? null;
}

/**
 * Fetch non-deleted, non-empty messages for a ticket, ordered by creation time.
 * Returns formatted messages ready for AI consumption.
 */
export async function fetchTicketMessages(ticketId: string): Promise<TicketMessage[]> {
  const msgs = await db
    .select({
      senderName: messagesTable.senderName,
      senderRole: messagesTable.senderRole,
      text: messagesTable.text,
    })
    .from(messagesTable)
    .where(
      and(
        eq(messagesTable.ticketId, ticketId),
        isNull(messagesTable.deletedAt),
      ),
    )
    .orderBy(asc(messagesTable.createdAt));

  // Filter out empty messages
  return msgs.filter((m) => m.text && m.text.trim());
}
