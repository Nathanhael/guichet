import { type Server } from 'socket.io';
import { db } from '../db.js';
import { tickets } from '../db/schema.js';
import { and, eq, isNotNull, lt, ne } from 'drizzle-orm';
import { insertSystemMessage } from './systemMessage.js';
import { getUserStatus, getOnlineUsersForPartner } from './presence.js';
import { sendPush } from './pushNotification.js';
import { Rooms } from '../utils/rooms.js';
import config from '../config.js';
import logger from '../utils/logger.js';

/**
 * Reclaims tickets abandoned by offline support agents.
 *
 * A ticket is "abandoned" when:
 * 1. It has an assigned support agent (support_id IS NOT NULL)
 * 2. The agent joined more than RECLAIM_TIMEOUT_MINS ago
 * 3. The agent is fully offline (no active socket connections)
 *
 * Reclaimed tickets are returned to the queue (support unassigned, status→open)
 * with a system message for audit trail. Other agents can then pick them up.
 */
export async function reclaimAbandonedTickets(io: Server): Promise<void> {
  const timeoutMins = config.RECLAIM_TIMEOUT_MINS;
  if (timeoutMins <= 0) return; // disabled

  const cutoff = new Date(Date.now() - timeoutMins * 60 * 1000).toISOString();

  // Find tickets with assigned support that joined before the cutoff
  const candidates = await db
    .select({
      id: tickets.id,
      partnerId: tickets.partnerId,
      supportId: tickets.supportId,
      supportName: tickets.supportName,
      supportJoinedAt: tickets.supportJoinedAt,
    })
    .from(tickets)
    .where(
      and(
        isNotNull(tickets.supportId),
        lt(tickets.supportJoinedAt, cutoff),
        // Only open/pending — don't touch closed
        ne(tickets.status, 'closed'),
      ),
    );

  if (candidates.length === 0) return;

  let reclaimed = 0;

  for (const ticket of candidates) {
    if (!ticket.supportId || !ticket.partnerId) continue;

    // Only reclaim if the agent is fully offline (no sockets at all)
    const status = await getUserStatus(ticket.supportId, ticket.partnerId);
    if (status !== null) continue; // agent is online/away/busy — don't reclaim

    try {
      // Atomic: only reclaim if supportId still matches — prevents clobbering
      // if another agent picked up the ticket between the presence check and now.
      const result = await db
        .update(tickets)
        .set({ supportId: null, supportName: null, supportJoinedAt: null, status: 'open' })
        .where(and(eq(tickets.id, ticket.id), eq(tickets.supportId, ticket.supportId)));
      if (result.rowCount === 0) continue; // ticket was already reassigned

      await insertSystemMessage(
        ticket.id,
        `Auto-released — ${ticket.supportName || 'support agent'} unavailable`,
      );

      // Notify the partner staff room so queue UIs refresh
      io.to(Rooms.staff(ticket.partnerId)).emit('ticket:reclaimed', {
        ticketId: ticket.id,
        previousSupportId: ticket.supportId,
        previousSupportName: ticket.supportName,
      });

      // Push notification to online support agents for this partner
      const onlineUsers = await getOnlineUsersForPartner(ticket.partnerId);
      const supportUsers = onlineUsers.filter((u) => u.role === 'support' || u.role === 'admin');
      for (const user of supportUsers) {
        sendPush(user.userId, {
          title: 'Ticket available',
          body: `${ticket.supportName || 'An agent'} went offline — ticket returned to queue`,
          ticketId: ticket.id,
          type: 'reclaimed',
          tag: `reclaim-${ticket.id}`,
        });
      }

      reclaimed++;
      logger.info(
        { ticketId: ticket.id, supportId: ticket.supportId, partnerId: ticket.partnerId },
        '[ticket-reclaim] Ticket returned to queue',
      );
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err), ticketId: ticket.id },
        '[ticket-reclaim] Failed to reclaim ticket',
      );
    }
  }

  if (reclaimed > 0) {
    logger.info({ reclaimed, candidates: candidates.length }, '[ticket-reclaim] Reclaim cycle complete');
  }
}
