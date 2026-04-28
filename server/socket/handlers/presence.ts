import { Socket } from 'socket.io';
import logger from '../../utils/logger.js';
import { Rooms } from '../../utils/rooms.js';
import * as presenceService from '../../services/presence.js';
import * as statusTracking from '../../services/statusTracking.js';
import { requirePartnerScopeWith } from '../partnerScope.js';
import { applyEffects, socketActor } from '../../services/ticketLifecycle/index.js';

import {
  findTicketForJoin,
  findTicketParticipants,
} from '../../services/ticketQueries.js';
import { findTicketMessagesPaginated, findTicketLabelIds } from '../../services/messageQueries.js';
import { mapMessageRow } from '../../utils/messageMapper.js';
import { findUserName } from '../../services/userQueries.js';
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
      const supportId = socket.data.userId;
      const callerPartnerId = socket.data.partnerId;

      if (!socket.data.isSupport) {
        return socket.emit('error', { message: 'Not authorized to join tickets' });
      }

      const ticket = await requirePartnerScopeWith(socket, ticketId, findTicketForJoin);
      if (!ticket) return;

      // HI-01: closed tickets cannot be re-opened by a join — block here
      // for the user-facing error message; the lifecycle would also reject
      // with TICKET_CLOSED.
      if (ticket.status === 'closed') {
        return socket.emit('error', { message: 'Cannot join a closed ticket' });
      }

      // Idempotency: silent rejoin path. If the joiner is already a
      // participant (tab re-open, state rehydrate, duplicate emit), skip
      // the lifecycle call entirely — no audit write, no whisper, no
      // staff-room broadcast. Just refresh the room + history.
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

      // Ghost decision — Redis presence check stays in the handler so the
      // lifecycle module remains DB-only and PGLite-testable. Mirrors the
      // legacy invariant exactly: if support_id points to someone who's
      // either not in participants or fully offline, clear the slot via
      // the lifecycle's race-guarded path inside the assign txn.
      let ghostHealPreviousSupportId: string | null = null;
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
        if (!primaryValid) ghostHealPreviousSupportId = ticket.supportId;
      }

      // Denormalize the joiner's B2B-guest flag onto tickets.participants
      // — lets ChatHeader flag offline guests without a live presence
      // lookup. findUserName is a cheap single-row read.
      const joinerInfo = await findUserName(supportId);
      const baseActor = socketActor(socket);
      if (!baseActor) return;
      const joinActor = { ...baseActor, isExternal: !!joinerInfo?.isExternal };

      const result = await ctx.lifecycle.assign({
        ticketId,
        partnerId: callerPartnerId,
        actor: joinActor,
        supportLang,
        ghostHealPreviousSupportId,
      });

      if (!result.ok) {
        switch (result.code) {
          case 'NOT_AUTHORIZED':
            return socket.emit('error', { message: 'Not authorized to join tickets' });
          case 'TICKET_CLOSED':
            return socket.emit('error', { message: 'Cannot join a closed ticket' });
          case 'TICKET_NOT_FOUND':
            return; // requirePartnerScopeWith already emitted the error
          default:
            return;
        }
      }

      // Join the ticket room BEFORE dispatching effects so the joiner
      // receives the message:new and support:joined events in their own
      // chat tab. History fetch + emit is purely transport — kept here
      // because the lifecycle has no socket access.
      socket.join(Rooms.ticket(ticketId));
      const { messages: msgRows, hasMore, nextCursor } = await findTicketMessagesPaginated(ticketId, { limit: 100 });
      const msgs = msgRows.map(mapMessageRow);
      const labelIds = await findTicketLabelIds(ticketId);
      socket.emit('ticket:history', { ticketId, messages: msgs, labels: labelIds, hasMore, nextCursor });

      applyEffects(ctx.io, result.effects);
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

      const actor = socketActor(socket);
      if (!actor) return;

      const result = await ctx.lifecycle.leave({
        ticketId,
        partnerId: callerPartnerId,
        actor,
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
