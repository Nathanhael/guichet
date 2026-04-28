import { Server, Socket } from 'socket.io';
import logger from '../../utils/logger.js';
import { Rooms } from '../../utils/rooms.js';
import { requireIdentified, validatePayload, ticketPreviewSchema, type HandlerContext } from './types.js';
import { requireActorTicketScope } from '../partnerScope.js';
import { socketActor } from '../../services/ticketLifecycle/index.js';
import { can } from '../../services/auth/capabilities.js';

/**
 * Notify any sockets that have a read-only preview open on this ticket
 * to refetch their message list. Lightweight payload — preview clients
 * pull through tRPC, which enforces visibility (whisper filtering, etc.).
 */
export function notifyPreviewers(io: Server, ticketId: string): void {
  io.to(Rooms.ticketPreview(ticketId)).emit('ticket:preview:invalidate', { ticketId });
}

/**
 * Read-only ticket preview subscription.
 *
 * Lets staff (admin/support) watch a ticket's message stream without
 * joining as a participant. The socket joins a separate preview-only
 * room so message broadcasts can fan out an invalidation hint without
 * triggering the full ticket-room side effects (notifications, unread
 * badges, delivery receipts).
 *
 * Whisper messages are NOT exposed via the preview channel: the preview
 * event carries only `{ ticketId }` and the client refetches via tRPC,
 * which enforces visibility through normal role checks.
 */
export function register(socket: Socket, _ctx: HandlerContext): void {
  socket.on('ticket:preview:join', async (data: unknown) => {
    if (!requireIdentified(socket)) return;
    const actor = socketActor(socket);
    if (!actor) return;
    if (!can(actor, 'use_support_workflows')) return;
    const parsed = validatePayload(socket, ticketPreviewSchema, data);
    if (!parsed) return;
    const { ticketId } = parsed;

    const ticket = await requireActorTicketScope(socket, actor, ticketId);
    if (!ticket) return;

    socket.join(Rooms.ticketPreview(ticketId));
    logger.debug({ socketId: socket.id, ticketId }, '[ticket:preview:join]');
  });

  socket.on('ticket:preview:leave', async (data: unknown) => {
    if (!requireIdentified(socket)) return;
    const parsed = validatePayload(socket, ticketPreviewSchema, data);
    if (!parsed) return;
    const { ticketId } = parsed;
    socket.leave(Rooms.ticketPreview(ticketId));
  });
}
