import { type Server } from 'socket.io';
import { db } from '../db.js';
import { tickets } from '../db/schema.js';
import { and, isNotNull, lt, ne } from 'drizzle-orm';
import { insertSystemMessage } from './systemMessage.js';
import { getOfflineAt, getUserStatus } from './presence.js';
import { returnTicketToQueue } from './ticketQueries.js';
import { Rooms } from '../utils/rooms.js';
import config from '../config.js';
import logger from '../utils/logger.js';

/** Fallback safety multiplier when no offline-at marker is available. */
const RESTART_FALLBACK_MULTIPLIER = 4;

/**
 * Reclaims tickets abandoned by offline support agents.
 *
 * A ticket is "abandoned" when:
 * 1. It has an assigned support agent (support_id IS NOT NULL)
 * 2. The agent joined more than RECLAIM_TIMEOUT_MINS ago (coarse DB pre-filter)
 * 3. The agent is fully offline (no active socket connections)
 * 4. The agent has been continuously offline for at least RECLAIM_TIMEOUT_MINS,
 *    measured by the Redis offline-at marker written on full disconnect
 *
 * Measuring abandonment from `offline_at` (not `support_joined_at`) means a
 * support who held a ticket for hours and briefly dropped will not be
 * reclaimed, while a support who joined and immediately disappeared will be.
 *
 * Restart fallback: if Redis lost the offline marker (e.g., server restart
 * wiped state), fall back to a `support_joined_at`-based check with a much
 * wider window so genuinely stale tickets eventually clear without
 * punishing brief disconnects.
 *
 * Reclaimed tickets are returned to the queue (support unassigned, status→open)
 * with a system message for audit trail. Other agents can then pick them up.
 */
export async function reclaimAbandonedTickets(io: Server): Promise<void> {
  const timeoutMins = config.RECLAIM_TIMEOUT_MINS;
  if (timeoutMins <= 0) return; // disabled

  const offlineThresholdMs = timeoutMins * 60 * 1000;
  const now = Date.now();
  const cutoff = new Date(now - offlineThresholdMs).toISOString();

  // Coarse DB pre-filter: tickets with an assigned support that joined at
  // least RECLAIM_TIMEOUT_MINS ago. The fine-grained "support has been
  // continuously offline for that window" check happens per-row against
  // Redis below.
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

    // Primary check: how long has the agent actually been offline?
    const offlineAt = await getOfflineAt(ticket.supportId, ticket.partnerId);
    let offlineForMs: number;
    if (offlineAt) {
      offlineForMs = now - offlineAt.getTime();
      if (offlineForMs < offlineThresholdMs) continue;
    } else {
      // Restart fallback: no offline marker (Redis was wiped or this state
      // predates the offline-at tracking). Use supportJoinedAt as a proxy
      // with a wider window so we still eventually clean up genuinely stale
      // tickets without aggressively reclaiming on every restart.
      const joinedAt = ticket.supportJoinedAt ? new Date(ticket.supportJoinedAt).getTime() : 0;
      if (!joinedAt) continue;
      const sinceJoinMs = now - joinedAt;
      if (sinceJoinMs < offlineThresholdMs * RESTART_FALLBACK_MULTIPLIER) continue;
      offlineForMs = sinceJoinMs;
    }

    try {
      // Atomic: only reclaim if supportId still matches — prevents clobbering
      // if another agent picked up the ticket between the presence check and now.
      // Also strips the outgoing support from the participants JSONB so a stale
      // support:rejoin can't re-enter after reclaim.
      const reclaimedOk = await returnTicketToQueue(ticket.id, ticket.supportId);
      if (!reclaimedOk) continue; // ticket was already reassigned

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

      reclaimed++;
      logger.info(
        {
          ticketId: ticket.id,
          supportId: ticket.supportId,
          partnerId: ticket.partnerId,
          offlineForMins: Math.floor(offlineForMs / 60000),
          source: offlineAt ? 'offline_at' : 'restart_fallback',
        },
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
