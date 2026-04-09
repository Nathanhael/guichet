import { Socket } from 'socket.io';
import logger from '../../utils/logger.js';
import { Rooms } from '../../utils/rooms.js';
import { requirePartnerScopeWith } from '../partnerScope.js';
import { findTicketOwner, insertRating } from '../../services/ticketQueries.js';
import { MAX_NOTE_LENGTH } from '../../constants.js';
import {
  requireIdentified,
  socketioEventsTotal,
  type HandlerContext,
} from './types.js';

export function register(socket: Socket, ctx: HandlerContext): void {
  // ── Rating Submit ──────────────────────────────────────────────────────────
  socket.on('rating:submit', async ({ ticketId, rating, comment }: { ticketId: string; rating: number; comment: string | null }) => {
    if (!requireIdentified(socket)) return;
    socketioEventsTotal.inc({ event: 'rating:submit' });
    try {
      if (!ticketId || typeof rating !== 'number' || rating < 1 || rating > 5) {
        logger.warn('[rating:submit] invalid payload');
        return;
      }
      const intRating = Math.round(rating);
      const agentId = socket.data.userId; // Server-side identity — never trust client-supplied agentId

      // Tenant isolation: verify ticket belongs to caller's partner and caller is the agent
      // Read support_id from the ticket instead of trusting client-provided value
      const ticket = await requirePartnerScopeWith(socket, ticketId, findTicketOwner);
      if (!ticket) return;
      if (ticket.agentId !== socket.data.userId) {
        return socket.emit('error', { message: 'Only the ticket agent can submit a rating' });
      }
      if (!ticket.supportId) {
        return socket.emit('error', { message: 'No support user assigned to this ticket' });
      }
      const supportId = ticket.supportId;

      const id = crypto.randomUUID();
      const safeComment = comment ? comment.slice(0, MAX_NOTE_LENGTH) : null;
      await insertRating({ id, ticketId, agentId: agentId!, supportId, partnerId: socket.data.partnerId, rating: intRating, comment: safeComment });
      ctx.io.to(Rooms.ticket(ticketId)).emit('rating:submitted', { ticketId, agentId, supportId, rating: intRating });
    } catch (err: unknown) { logger.error({ err: err instanceof Error ? err.message : String(err) }, '[rating:submit] error'); }
  });
}
