import { Socket } from 'socket.io';
import { findTicketPartner } from '../services/ticketQueries.js';
import logger from '../utils/logger.js';
import type { UserActor } from '../services/auth/types.js';

/**
 * Centralized tenant isolation guard for socket events. Verifies that a
 * ticket belongs to the caller's partner. Returns the ticket on success,
 * null (with error emission) on failure.
 *
 * Usage in socket handlers:
 *   const actor = socketActor(socket);
 *   if (!actor) return;
 *   const ticket = await requireActorTicketScope(socket, actor, ticketId);
 *   if (!ticket) return;
 */
export async function requireActorTicketScope(
  socket: Socket,
  actor: UserActor,
  ticketId: string,
): Promise<{ partnerId: string } | null> {
  const ticket = await findTicketPartner(ticketId);
  if (!ticket || ticket.partnerId !== actor.partnerId) {
    logger.warn(
      {
        socketId: socket.id,
        userId: actor.userId,
        ticketId,
        expected: actor.partnerId,
        actual: ticket?.partnerId,
      },
      '[socket] Tenant isolation: partner mismatch',
    );
    socket.emit('error', { message: 'Not authorized' });
    return null;
  }
  return ticket;
}

/**
 * Variant that accepts a custom query function. Used when handlers need
 * richer ticket fields (status, agentLang, supportId) than just `partnerId`.
 */
export async function requireActorTicketScopeWith<T extends { partnerId: string }>(
  socket: Socket,
  actor: UserActor,
  ticketId: string,
  queryFn: (ticketId: string) => Promise<T | undefined>,
): Promise<T | null> {
  const ticket = await queryFn(ticketId);
  if (!ticket || ticket.partnerId !== actor.partnerId) {
    logger.warn(
      {
        socketId: socket.id,
        userId: actor.userId,
        ticketId,
        expected: actor.partnerId,
        actual: ticket?.partnerId,
      },
      '[socket] Tenant isolation: partner mismatch',
    );
    socket.emit('error', { message: 'Not authorized' });
    return null;
  }
  return ticket;
}
