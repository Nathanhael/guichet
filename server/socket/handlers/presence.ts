import { Socket } from 'socket.io';
import logger from '../../utils/logger.js';
import { Rooms } from '../../utils/rooms.js';
import * as presenceService from '../../services/presence.js';
import * as statusTracking from '../../services/statusTracking.js';
import { requirePartnerScopeWith } from '../partnerScope.js';
import { notifyPreviewers } from './preview.js';
import { applyEffects, socketActor } from '../../services/ticketLifecycle/index.js';

import {
  findTicketForJoin,
  findTicketParticipants,
  assignSupport,
  findUpdatedParticipants,
  returnTicketToQueue,
} from '../../services/ticketQueries.js';
import { broadcastQueuePositions } from '../../services/businessHours.js';
import { insertSystemMessage } from '../../services/systemMessage.js';
import { findTicketMessagesPaginated, findTicketLabelIds } from '../../services/messageQueries.js';
import { mapMessageRow } from '../../utils/messageMapper.js';
import { findUserName } from '../../services/userQueries.js';
import { auditTicketAssigned } from '../../services/ticketAudit.js';
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

/** Narrow the Drizzle JSONB participants row to Participant[]; null → []. */
function getParticipants(ticket: { participants: Participant[] | null }): Participant[] {
  return ticket.participants ?? [];
}

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

      // Idempotency: if the joiner is already a participant (tab re-open,
      // state rehydrate, duplicate emit), short-circuit to the silent-rejoin
      // behaviour — refresh the room + history but skip the audit write,
      // "joined the conversation" whisper, and staff-room broadcast. Prior
      // behaviour inserted a new system message on every call, producing
      // stacks of duplicate "X joined" lines in the chat.
      const existingParticipants = getParticipants(ticket);
      const alreadyParticipant = existingParticipants.some((p) => p.id === supportId);

      if (alreadyParticipant) {
        socket.join(Rooms.ticket(ticketId));
        const { messages: msgRows, hasMore, nextCursor } = await findTicketMessagesPaginated(ticketId, { limit: 100 });
        const msgs = msgRows.map(mapMessageRow);
        const labelIds = await findTicketLabelIds(ticketId);
        socket.emit('ticket:history', { ticketId, messages: msgs, labels: labelIds, hasMore, nextCursor });
        return;
      }

      // Ghost-heal: if support_id points to a user who either isn't in
      // participants (stale) or is fully offline (no active sockets),
      // clear it before assignSupport. Without this, a crashed primary
      // who never emitted support:leave leaves support_id set, and
      // assignSupport's COALESCE keeps the ghost — making new joiners
      // silent secondaries (their later leave doesn't unassign the ticket).
      if (ticket.supportId && ticket.supportId !== supportId) {
        const listedInParticipants = existingParticipants.some(
          (p) => p.id === ticket.supportId,
        );
        let primaryValid = false;
        if (listedInParticipants) {
          const status = await presenceService.getUserStatus(
            ticket.supportId,
            callerPartnerId,
          );
          primaryValid = status !== null;
        }
        if (!primaryValid) {
          // Guarded clear — if a concurrent support:join claimed the ticket
          // between our read and here, the guarded overload (WHERE support_id
          // = ghostId) no-ops instead of clobbering the fresh claim.
          await returnTicketToQueue(ticketId, ticket.supportId ?? undefined);
        }
      }

      // Resolve the joiner's Azure B2B guest flag so it can be denormalized
      // onto tickets.participants — lets ChatHeader flag offline guests
      // without a live presence lookup. findUserName is a cheap single-row
      // read; support:join is infrequent.
      const joinerInfo = await findUserName(supportId);
      await assignSupport(
        ticketId,
        supportId,
        supportName,
        supportLang,
        !!joinerInfo?.isExternal,
      );
      auditTicketAssigned({
        ticketId,
        partnerId: callerPartnerId,
        actorId: supportId,
        supportId,
        supportName,
      });

      // Read back updated participants for broadcast
      const participants = (await findUpdatedParticipants(ticketId)) || [];
      socket.join(Rooms.ticket(ticketId));
      const { messages: msgRows, hasMore, nextCursor } = await findTicketMessagesPaginated(ticketId, { limit: 100 });
      const msgs = msgRows.map(mapMessageRow);
      const labelIds = await findTicketLabelIds(ticketId);
      socket.emit('ticket:history', { ticketId, messages: msgs, labels: labelIds, hasMore, nextCursor });

      // Insert a staff-only whisper announcing the join, then fan out the
      // updated participants list to BOTH the ticket room (chat header) AND
      // the staff room (queue rows of every other support). io.to().to() de-
      // duplicates by socket id so no one receives the event twice.
      const joinMsg = await insertSystemMessage(
        ticketId,
        `${supportName} joined the conversation`,
      );
      ctx.io.to(Rooms.ticket(ticketId)).emit('message:new', joinMsg);
      ctx.io.to(Rooms.ticket(ticketId)).to(Rooms.staff(callerPartnerId))
        .emit('support:joined', { ticketId, supportId, supportName, participants });
      notifyPreviewers(ctx.io, ticketId);
      await broadcastQueuePositions(callerPartnerId);
    } catch (err: unknown) { logger.error({ err: err instanceof Error ? err.message : String(err) }, '[support:join] error'); }
  });

  // Silent rejoin — reconnect to ticket rooms after a crash/refresh without
  // inserting whisper messages or broadcasting join events. Only succeeds if
  // the caller is already a participant of the ticket (i.e., they joined before
  // the disconnect).
  socket.on('support:rejoin', async (data: unknown) => {
    if (!requireIdentified(socket)) return;
    const parsed = validatePayload(socket, supportLeaveSchema, data); // same shape: { ticketId }
    if (!parsed) return;
    const { ticketId } = parsed;
    socketioEventsTotal.inc({ event: 'support:rejoin' });
    try {
      const supportId = socket.data.userId;
      if (!socket.data.isSupport) return;

      const ticket = await requirePartnerScopeWith(socket, ticketId, findTicketParticipants);
      if (!ticket) return;

      // Only rejoin if already a participant — prevents abuse
      const participants = getParticipants(ticket);
      const isParticipant = participants.some((p) => p.id === supportId);
      if (!isParticipant) {
        socket.emit('support:rejoin:denied', { ticketId });
        return;
      }

      socket.join(Rooms.ticket(ticketId));
      const { messages: msgRows, hasMore, nextCursor } = await findTicketMessagesPaginated(ticketId, { limit: 100 });
      const msgs = msgRows.map(mapMessageRow);
      const labelIds = await findTicketLabelIds(ticketId);
      socket.emit('ticket:history', { ticketId, messages: msgs, labels: labelIds, hasMore, nextCursor });
    } catch (err: unknown) { logger.error({ err: err instanceof Error ? err.message : String(err) }, '[support:rejoin] error'); }
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
      const callerPartnerId = socket.data.partnerId;

      // Read the ticket once so the partner-scope check + the
      // ghost-primary decision can share a single round-trip; the
      // lifecycle does its own atomic re-read inside the txn so this is
      // not a TOCTOU surface.
      const ticket = await requirePartnerScopeWith(socket, ticketId, findTicketParticipants);
      if (!ticket) return;

      // Determine `clearPrimary` BEFORE the lifecycle call. The decision
      // depends on Redis presence (kept out of the lifecycle so the
      // module stays DB-only). Mirrors the legacy invariant exactly:
      //   1. Leaver is primary (storedPrimary === leaver) → clear.
      //   2. Stored primary not in remaining participants → clear.
      //   3. Stored primary fully offline → clear.
      const supportId = socket.data.userId;
      const currentParticipants: Participant[] = ticket.participants ?? [];
      const remaining = currentParticipants.filter((p: Participant) => p.id !== supportId);
      const storedPrimary = ticket.supportId;
      let clearPrimary = false;
      if (storedPrimary) {
        const primaryValid =
          storedPrimary !== supportId
          && remaining.some((p: Participant) => p.id === storedPrimary)
          && (await presenceService.getUserStatus(storedPrimary, callerPartnerId)) !== null;
        clearPrimary = !primaryValid;
      }

      const result = await ctx.lifecycle.leave({
        ticketId,
        partnerId: callerPartnerId,
        actor: socketActor(socket),
        clearPrimary,
        previousSupportId: storedPrimary ?? null,
      });

      if (!result.ok) {
        if (result.code === 'NOT_A_PARTICIPANT') {
          return socket.emit('error', { message: 'You are not a participant of this ticket' });
        }
        if (result.code === 'TICKET_NOT_FOUND') {
          return; // requirePartnerScopeWith already emitted the error.
        }
        return; // any other code → silently log via the lifecycle's own logging path
      }

      // Drop the leaver out of the ticket room before fanning out the
      // leave events; the lifecycle's `message:new` and `support:left`
      // emits target Rooms.ticket(ticketId) but we want the leaver to
      // still receive the farewell line in their currently-open chat
      // tab. Order matches the legacy handler exactly: emit, then leave.
      applyEffects(ctx.io, result.effects);
      socket.leave(Rooms.ticket(ticketId));
    } catch (err: unknown) { logger.error({ err: err instanceof Error ? err.message : String(err) }, '[support:leave] error'); }
  });

  /**
   * Broadcast a typing update to the ticket room. When `whisper` is true,
   * routes only to staff sockets in the room (support/admin/platform
   * operator) and explicitly excludes the ticket's agent — whisper typing
   * is an internal staff signal and must not leak to the customer.
   *
   * We iterate ctx.io.sockets.sockets directly (the local-node socket map)
   * instead of io.in(room).fetchSockets(). fetchSockets() goes through the
   * adapter and returns RemoteSocket stubs whose .data.role is not reliably
   * set across the Redis adapter, so the role-based filter silently failed.
   * Local iteration gives us the real Socket objects with live socket.data.
   */
  function broadcastTyping(ticketId: string, typing: boolean, whisper: boolean) {
    const room = Rooms.ticket(ticketId);
    if (!whisper) {
      socket.to(room).emit('typing:update', { ticketId, senderName: socket.data.name, typing });
      return;
    }
    let routed = 0;
    let skippedAgents = 0;
    for (const peer of ctx.io.sockets.sockets.values()) {
      if (peer.id === socket.id) continue;
      if (!peer.rooms.has(room)) continue;
      if (peer.data?.role === 'agent') { skippedAgents += 1; continue; }
      peer.emit('typing:update', { ticketId, senderName: socket.data.name, typing });
      routed += 1;
    }
    logger.debug({ ticketId, typing, routed, skippedAgents }, '[typing whisper] broadcast');
  }

  socket.on('typing:start', (data: unknown) => {
    if (!requireIdentified(socket)) return;
    const typingParsed = validatePayload(socket, typingSchema, data);
    if (!typingParsed) return;
    const { ticketId, whisper } = typingParsed;
    // Only emit if socket is actually in the ticket room (i.e., is a participant)
    if (!socket.rooms.has(Rooms.ticket(ticketId))) return;
    broadcastTyping(ticketId, true, !!whisper);
  });

  socket.on('typing:stop', (data: unknown) => {
    if (!requireIdentified(socket)) return;
    const typingStopParsed = validatePayload(socket, typingSchema, data);
    if (!typingStopParsed) return;
    const { ticketId, whisper } = typingStopParsed;
    if (!socket.rooms.has(Rooms.ticket(ticketId))) return;
    broadcastTyping(ticketId, false, !!whisper);
  });
}
