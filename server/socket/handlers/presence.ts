import { Socket } from 'socket.io';
import logger from '../../utils/logger.js';
import { Rooms } from '../../utils/rooms.js';
import * as presenceService from '../../services/presence.js';
import * as statusTracking from '../../services/statusTracking.js';
import { requirePartnerScopeWith } from '../partnerScope.js';
import { canUseSupportWorkflows } from '../../services/roles.js';
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
  type HandlerContext,
  type SupportJoinPayload,
  type SupportLeavePayload,
  type Participant,
} from './types.js';

export function register(socket: Socket, ctx: HandlerContext) {
  socket.on('support:join', async ({ ticketId, supportLang }: SupportJoinPayload) => {
    if (!requireIdentified(socket)) return;
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

  socket.on('status:set', async ({ status }: { status: string }) => {
    if (!requireIdentified(socket)) return;
    const VALID_STATUSES = ['online', 'away'] as const;
    if (!VALID_STATUSES.includes(status as typeof VALID_STATUSES[number])) return;
    const userId = socket.data.userId;
    const partnerId = socket.data.partnerId;
    if (userId && partnerId) {
      await presenceService.setUserStatus(userId, partnerId, status);
      await statusTracking.logTransition(userId, partnerId, status);
    }
  });

  socket.on('support:leave', async ({ ticketId }: SupportLeavePayload) => {
    if (!requireIdentified(socket)) return;
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

  socket.on('typing:start', ({ ticketId }: { ticketId: string, senderName?: string }) => {
    if (!requireIdentified(socket)) return;
    // Only emit if socket is actually in the ticket room (i.e., is a participant)
    if (!ticketId || !socket.rooms.has(Rooms.ticket(ticketId))) return;
    socket.to(Rooms.ticket(ticketId)).emit('typing:update', { ticketId, senderName: socket.data.name, typing: true });
  });

  socket.on('typing:stop', ({ ticketId }: { ticketId: string, senderName?: string }) => {
    if (!requireIdentified(socket)) return;
    if (!ticketId || !socket.rooms.has(Rooms.ticket(ticketId))) return;
    socket.to(Rooms.ticket(ticketId)).emit('typing:update', { ticketId, senderName: socket.data.name, typing: false });
  });
}
