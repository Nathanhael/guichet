import { Socket } from 'socket.io';
import { findTicketPartner } from '../services/ticketQueries.js';
import logger from '../utils/logger.js';
import type { UserActor } from '../services/auth/types.js';

/**
 * Centralized tenant isolation guard for socket events.
 *
 * Verifies that a ticket belongs to the caller's partner. Returns the
 * ticket's partner info on success, or null (with error emission) on failure.
 *
 * Usage in socket handlers:
 *   const ticket = await requirePartnerScope(socket, ticketId);
 *   if (!ticket) return;
 */
export async function requirePartnerScope(
  socket: Socket,
  ticketId: string,
): Promise<{ partnerId: string } | null> {
  const ticket = await findTicketPartner(ticketId);
  if (!ticket || ticket.partnerId !== socket.data.partnerId) {
    logger.warn(
      {
        socketId: socket.id,
        userId: socket.data.userId,
        ticketId,
        expected: socket.data.partnerId,
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
 * Generic variant of requirePartnerScope that accepts a custom query function.
 *
 * Useful when handlers need more than just partnerId (e.g. status, supportId).
 * The query function must return an object with at least `partnerId`.
 *
 * Usage:
 *   const ticket = await requirePartnerScopeWith(socket, ticketId, findTicketForClose);
 *   if (!ticket) return;
 */
export async function requirePartnerScopeWith<T extends { partnerId: string }>(
  socket: Socket,
  ticketId: string,
  queryFn: (ticketId: string) => Promise<T | undefined>,
): Promise<T | null> {
  const ticket = await queryFn(ticketId);
  if (!ticket || ticket.partnerId !== socket.data.partnerId) {
    logger.warn(
      {
        socketId: socket.id,
        userId: socket.data.userId,
        ticketId,
        expected: socket.data.partnerId,
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
 * Actor-aware sibling of `requirePartnerScope`. The Bundle A migration
 * (slices #68–#70) moves socket handlers off direct `socket.data` reads
 * in favor of `socketActor(socket)`; this helper lets the partner-scope
 * check follow the same pattern — pass the typed `UserActor` instead of
 * the raw socket. Same semantics, same error UX, same warn log.
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
 * Actor-aware sibling of `requirePartnerScopeWith`. Used when handlers
 * need richer ticket fields (status, agentLang, supportId) than just
 * `partnerId`. The custom query function is unchanged.
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
