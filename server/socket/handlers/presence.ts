import { Socket } from 'socket.io';
import logger from '../../utils/logger.js';
import { Rooms } from '../../utils/rooms.js';
import * as presenceService from '../../services/presence.js';
import * as statusTracking from '../../services/statusTracking.js';
import { requirePartnerScopeWith } from '../partnerScope.js';

import {
  findTicketForJoin,
  findTicketParticipants,
  assignSupport,
  findUpdatedParticipants,
  updateParticipants,
} from '../../services/ticketQueries.js';
import { broadcastQueuePositions } from '../../services/businessHours.js';
import { findTicketMessagesPaginated, findTicketLabelIds } from '../../services/messageQueries.js';
import { mapMessageRow } from '../../utils/messageMapper.js';
import { sendPush } from '../../services/pushNotification.js';
import {
  requireIdentified,
  socketioEventsTotal,
  validatePayload,
  supportJoinSchema,
  supportLeaveSchema,
  typingSchema,
  statusSetSchema,
  type HandlerContext,
  type Participant,
} from './types.js';

export function register(socket: Socket, ctx: HandlerContext): void {
  socket.on('support:join', async (data: unknown) => {
    if (!requireIdentified(socket)) return;
    const parsed = validatePayload(socket, supportJoinSchema, data);
    if (!parsed) return;
    const { ticketId, supportLang } = parsed;
    socketioEventsTotal.inc({ event: 'support:join' });
    try {
      // Use verified identity from socket.data — never trust client-supplied supportId/supportName
      const supportId = socket.data.userId;
      const supportName = socket.data.name;
      const callerPartnerId = socket.data.partnerId;

      // Authorization: only support/admin roles can join
      if (!socket.data.isSupport) {
        return socket.emit('error', { message: 'Not authorized to join tickets' });
      }

      const ticket = await requirePartnerScopeWith(socket, ticketId, findTicketForJoin);
      if (!ticket) return;

      // HI-01 fix: Prevent joining closed tickets — this would silently re-open them
      if (ticket.status === 'closed') {
        return socket.emit('error', { message: 'Cannot join a closed ticket' });
      }

      await assignSupport(ticketId, supportId, supportName, supportLang);

      // Read back updated participants for broadcast
      const participants = (await findUpdatedParticipants(ticketId)) || [];
      socket.join(Rooms.ticket(ticketId));
      const { messages: msgRows, hasMore, nextCursor } = await findTicketMessagesPaginated(ticketId, { limit: 100 });
      const msgs = msgRows.map(mapMessageRow);
      const labelIds = await findTicketLabelIds(ticketId);
      socket.emit('ticket:history', { ticketId, messages: msgs, labels: labelIds, hasMore, nextCursor });
      ctx.io.to(Rooms.ticket(ticketId)).emit('support:joined', { ticketId, supportId, supportName, participants });
      await broadcastQueuePositions(callerPartnerId);
      if (ticket.agentId) {
        sendPush(ticket.agentId, {
          title: 'Support joined your ticket',
          body: `${socket.data.name} joined your conversation`,
          ticketId,
          type: 'joined',
          tag: `ticket-${ticketId}`,
        });
      }
    } catch (err: unknown) { logger.error({ err: err instanceof Error ? err.message : String(err) }, '[support:join] error'); }
  });

  socket.on('status:set', async (data: unknown) => {
    if (!requireIdentified(socket)) return;
    const statusParsed = validatePayload(socket, statusSetSchema, data);
    if (!statusParsed) return;
    const { status } = statusParsed;
    const userId = socket.data.userId;
    const partnerId = socket.data.partnerId;
    if (userId && partnerId) {
      await presenceService.setUserStatus(userId, partnerId, status);
      await statusTracking.logTransition(userId, partnerId, status);
      // Re-broadcast online support list so viewer UIs (chat header avatars, queue sidebar) reflect the new status immediately.
      await presenceService.broadcastOnlineSupport(partnerId);
    }
  });

  socket.on('support:leave', async (data: unknown) => {
    if (!requireIdentified(socket)) return;
    const leaveParsed = validatePayload(socket, supportLeaveSchema, data);
    if (!leaveParsed) return;
    const { ticketId } = leaveParsed;
    socketioEventsTotal.inc({ event: 'support:leave' });
    try {
      // Use verified identity — never trust client-supplied supportId/supportName
      const supportId = socket.data.userId;
      const supportName = socket.data.name;

      const ticket = await requirePartnerScopeWith(socket, ticketId, findTicketParticipants);
      if (!ticket) return;

      // Verify caller is actually a participant in this ticket
      const currentParticipants: Participant[] = (ticket.participants as unknown as Participant[]) || [];
      const isParticipant = currentParticipants.some((p: Participant) => p.id === supportId);
      if (!isParticipant) {
        return socket.emit('error', { message: 'You are not a participant of this ticket' });
      }

      let participants = currentParticipants.filter((p: Participant) => p.id !== supportId);
      await updateParticipants(ticketId, participants);
      socket.leave(Rooms.ticket(ticketId));
      ctx.io.to(Rooms.ticket(ticketId)).emit('support:left', { ticketId, supportId, supportName, participants });
    } catch (err: unknown) { logger.error({ err: err instanceof Error ? err.message : String(err) }, '[support:leave] error'); }
  });

  /**
   * Broadcast a typing update to the ticket room. When `whisper` is true,
   * routes only to staff sockets in the room (support/admin/platform
   * operator) and explicitly excludes the ticket's agent — whisper typing
   * is an internal staff signal and must not leak to the customer.
   */
  async function broadcastTyping(ticketId: string, typing: boolean, whisper: boolean) {
    const room = Rooms.ticket(ticketId);
    if (!whisper) {
      socket.to(room).emit('typing:update', { ticketId, senderName: socket.data.name, typing });
      return;
    }
    try {
      const sockets = await ctx.io.in(room).fetchSockets();
      for (const peer of sockets) {
        if (peer.id === socket.id) continue;
        if (peer.data?.role === 'agent') continue;
        peer.emit('typing:update', { ticketId, senderName: socket.data.name, typing });
      }
    } catch (err: unknown) {
      logger.error({ err: err instanceof Error ? err.message : String(err), ticketId }, '[typing whisper] failed to broadcast');
    }
  }

  socket.on('typing:start', async (data: unknown) => {
    if (!requireIdentified(socket)) return;
    const typingParsed = validatePayload(socket, typingSchema, data);
    if (!typingParsed) return;
    const { ticketId, whisper } = typingParsed;
    // Only emit if socket is actually in the ticket room (i.e., is a participant)
    if (!socket.rooms.has(Rooms.ticket(ticketId))) return;
    await broadcastTyping(ticketId, true, !!whisper);
  });

  socket.on('typing:stop', async (data: unknown) => {
    if (!requireIdentified(socket)) return;
    const typingStopParsed = validatePayload(socket, typingSchema, data);
    if (!typingStopParsed) return;
    const { ticketId, whisper } = typingStopParsed;
    if (!socket.rooms.has(Rooms.ticket(ticketId))) return;
    await broadcastTyping(ticketId, false, !!whisper);
  });
}
