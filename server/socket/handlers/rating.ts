import { Socket } from 'socket.io';
import logger from '../../utils/logger.js';
import { Rooms } from '../../utils/rooms.js';
import { requireActorTicketScopeWith } from '../partnerScope.js';
import { findTicketOwner, insertRating } from '../../services/ticketQueries.js';
import { MAX_NOTE_LENGTH } from '../../constants.js';
import { socketActor } from '../../services/ticketLifecycle/index.js';
import {
  requireIdentified,
  socketioEventsTotal,
  validatePayload,
  ratingSubmitSchema,
  type HandlerContext,
} from './types.js';

export function register(socket: Socket, ctx: HandlerContext): void {
  // ── Rating Submit ──────────────────────────────────────────────────────────
  socket.on('rating:submit', async (data: unknown) => {
    if (!requireIdentified(socket)) return;
    const parsed = validatePayload(socket, ratingSubmitSchema, data);
    if (!parsed) return;
    const { ticketId, rating, comment } = parsed;
    socketioEventsTotal.inc({ event: 'rating:submit' });
    try {
      const actor = socketActor(socket);
      if (!actor) return;
      const intRating = Math.round(rating);
      const agentId = actor.userId; // Server-side identity — never trust client-supplied agentId

      // Tenant isolation: verify ticket belongs to caller's partner and caller is the agent
      // Read support_id from the ticket instead of trusting client-provided value
      const ticket = await requireActorTicketScopeWith(socket, actor, ticketId, findTicketOwner);
      if (!ticket) return;
      if (ticket.agentId !== agentId) {
        return socket.emit('error', { message: 'Only the ticket agent can submit a rating' });
      }
      if (ticket.status !== 'closed') {
        return socket.emit('error', { message: 'Rating can only be submitted on closed tickets' });
      }
      if (!ticket.supportId) {
        return socket.emit('error', { message: 'No support user assigned to this ticket' });
      }
      const supportId = ticket.supportId;

      const id = crypto.randomUUID();
      const safeComment = comment ? comment.slice(0, MAX_NOTE_LENGTH) : null;
      await insertRating({
        id,
        ticketId,
        agentId,
        supportId,
        partnerId: actor.partnerId,
        rating: intRating,
        comment: safeComment,
        dept: ticket.dept ?? null,
        closedAt: ticket.closedAt ?? null,
      });
      ctx.io.to(Rooms.ticket(ticketId)).emit('rating:submitted', { ticketId, agentId, supportId, rating: intRating });
    } catch (err: unknown) { logger.error({ err: err instanceof Error ? err.message : String(err) }, '[rating:submit] error'); }
  });
}
