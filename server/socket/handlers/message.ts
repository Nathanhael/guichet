import { Socket } from 'socket.io';
import logger from '../../utils/logger.js';
import { Rooms } from '../../utils/rooms.js';
import { mapMessageRow } from '../../utils/messageMapper.js';
import { requireActorTicketScope, requireActorTicketScopeWith } from '../partnerScope.js';
import { findTicketForMessage } from '../../services/ticketQueries.js';
import {
  findTicketMessagesPaginated,
  markDelivered,
  markRead,
} from '../../services/messageQueries.js';
import { applyEffects, socketActor } from '../../services/ticketLifecycle/index.js';
import { isSupportLike } from '../../services/roles.js';
import { crossLangPickupTotal } from '../../utils/metrics.js';
import {
  MAX_BATCH_DELETE,
} from '../../constants.js';
import {
  requireIdentified,
  socketioEventsTotal,
  validatePayload,
  checkSocketRateLimit,
  messageSendSchema,
  messageEditSchema,
  messageDeleteSchema,
  messageDeliveredSchema,
  messageReadSchema,
  messageReactSchema,
  messageLoadMoreSchema,
  type HandlerContext,
} from './types.js';

export interface PrewarmInput {
  senderLang: string;
  ticketAgentLang: string | null;
  viewerLangs: Set<string>;
  aiFeatures: { translation?: boolean; queueLangAwareness?: boolean } | null | undefined;
}

export function computePrewarmTargets(input: PrewarmInput): string[] {
  const f = input.aiFeatures || {};
  if (!f.translation || !f.queueLangAwareness) return [];
  if (!input.ticketAgentLang || input.ticketAgentLang === input.senderLang) return [];
  const targets = new Set<string>();
  for (const vl of input.viewerLangs) {
    if (vl && vl !== input.senderLang) targets.add(vl);
  }
  return Array.from(targets);
}

export function register(socket: Socket, ctx: HandlerContext): void {
  // ── message:loadMore ────────────────────────────────────────────────────────
  socket.on('message:loadMore', async (data: unknown) => {
    if (!requireIdentified(socket)) return;
    const parsed = validatePayload(socket, messageLoadMoreSchema, data);
    if (!parsed) return;
    const { ticketId, cursor } = parsed;

    try {
      const actor = socketActor(socket);
      if (!actor) return;
      const ticket = await requireActorTicketScope(socket, actor, ticketId);
      if (!ticket) return;

      const { messages: msgRows, hasMore, nextCursor } = await findTicketMessagesPaginated(ticketId, {
        limit: 50,
        beforeCursor: cursor,
      });

      socket.emit('message:morePage', {
        ticketId,
        messages: msgRows.map(mapMessageRow),
        hasMore,
        nextCursor,
      });
    } catch (err: unknown) {
      logger.error({ err: err instanceof Error ? err.message : String(err), ticketId }, '[message:loadMore] error');
    }
  });

  // ── message:send ────────────────────────────────────────────────────────────
  socket.on('message:send', async (data: unknown) => {
    if (!requireIdentified(socket)) return;
    const parsed = validatePayload(socket, messageSendSchema, data);
    if (!parsed) return;
    if (!checkSocketRateLimit(socket, 'message:send')) return;
    const { ticketId, text, mediaUrl, attachments, whisper, replyToId, localId } = parsed;
    socketioEventsTotal.inc({ event: 'message:send' });
    try {
      const actor = socketActor(socket);
      if (!actor) return;

      // Partner-scope guard for legacy "Not authorized" UX + agentLang
      // (used for cross-lang metric + prewarm gating).
      const ticket = await requireActorTicketScopeWith(socket, actor, ticketId, findTicketForMessage);
      if (!ticket || ticket.status === 'closed') return;

      // Cross-lang metric: emit when a support agent sends in a different
      // language than the ticket's agentLang. Pre-flight observability.
      if (actor.lang && ticket.agentLang && actor.lang !== ticket.agentLang && isSupportLike(actor.role)) {
        crossLangPickupTotal.inc({ partner_id: ticket.partnerId, support_lang: actor.lang, ticket_lang: ticket.agentLang });
      }

      // Build viewerLangs only when cross-lang prewarm might apply
      // (matches legacy gating: skip the local-node socket iteration if
      // the ticket's agentLang matches the sender's lang).
      let viewerLangs: Set<string> | undefined;
      if (ticket.agentLang && ticket.agentLang !== actor.lang) {
        viewerLangs = new Set<string>();
        const room = Rooms.ticket(ticketId);
        for (const peer of ctx.io.sockets.sockets.values()) {
          if (peer.id === socket.id) continue;
          if (!peer.rooms.has(room)) continue;
          const lg = (peer.data.lang as string) || '';
          if (lg) viewerLangs.add(lg);
        }
      }

      const result = await ctx.messageLifecycle.send({
        ticketId,
        partnerId: actor.partnerId,
        actor,
        text,
        mediaUrl,
        attachments,
        whisper,
        replyToId: replyToId || null,
        localId,
        viewerLangs,
      });

      if (!result.ok) {
        switch (result.code) {
          case 'GUARD_REJECTED':
            socket.emit('message:rejected', { ticketId, localId, code: 'GUARD_REJECTED' });
            return;
          case 'INVALID_MEDIA_URL':
            return socket.emit('error', { message: 'Invalid media URL' });
          case 'EMPTY_MESSAGE':
          case 'TICKET_NOT_FOUND':
          case 'TICKET_CLOSED':
            return; // legacy treats these silently after the guard above
          default:
            return;
        }
      }

      applyEffects(ctx.io, result.effects);
    } catch (err: unknown) { logger.error({ err: err instanceof Error ? err.message : String(err) }, '[message:send] error'); }
  });

  // ── message:delivered ───────────────────────────────────────────────────────
  socket.on('message:delivered', async (data: unknown) => {
    if (!requireIdentified(socket)) return;
    const parsed = validatePayload(socket, messageDeliveredSchema, data);
    if (!parsed) return;
    const { ticketId, messageId } = parsed;
    try {
      const actor = socketActor(socket);
      if (!actor) return;
      // Tenant isolation: verify ticket belongs to caller's partner
      const ticket = await requireActorTicketScope(socket, actor, ticketId);
      if (!ticket) return;

      // Only update messages that belong to this ticket
      const now = await markDelivered(messageId, ticketId);
      ctx.io.to(Rooms.ticket(ticketId)).emit('message:status', { messageId, ticketId, status: 'delivered', timestamp: now });
    } catch (err: unknown) { logger.error({ err: err instanceof Error ? err.message : String(err) }, '[message:delivered] error'); }
  });

  // ── message:read ────────────────────────────────────────────────────────────
  socket.on('message:read', async (data: unknown) => {
    if (!requireIdentified(socket)) return;
    const parsed = validatePayload(socket, messageReadSchema, data);
    if (!parsed) return;
    const { ticketId, messageIds } = parsed;
    try {
      const actor = socketActor(socket);
      if (!actor) return;
      // Tenant isolation: verify ticket belongs to caller's partner
      const ticket = await requireActorTicketScope(socket, actor, ticketId);
      if (!ticket) return;

      // Limit array length to prevent DoS
      const limitedIds = messageIds.slice(0, MAX_BATCH_DELETE);

      // Batch update: scope to ticket_id for safety
      const now = await markRead(limitedIds, ticketId);

      // Broadcast status for each message
      for (const messageId of limitedIds) {
        ctx.io.to(Rooms.ticket(ticketId)).emit('message:status', { messageId, ticketId, status: 'read', timestamp: now });
      }
    } catch (err: unknown) { logger.error({ err: err instanceof Error ? err.message : String(err) }, '[message:read] error'); }
  });

  // ── Message Edit ─────────────────────────────────────────────────────────
  socket.on('message:edit', async (data: unknown) => {
    if (!requireIdentified(socket)) return;
    const parsed = validatePayload(socket, messageEditSchema, data);
    if (!parsed) return;
    if (!checkSocketRateLimit(socket, 'message:edit')) return;
    const { ticketId, messageId, text: newText } = parsed;
    socketioEventsTotal.inc({ event: 'message:edit' });
    try {
      const actor = socketActor(socket);
      if (!actor) return;

      // Partner-scope guard before the lifecycle — preserves the legacy
      // "Not authorized" wording on cross-tenant access. The lifecycle
      // would also refuse with TICKET_NOT_FOUND.
      const partnerCheck = await requireActorTicketScope(socket, actor, ticketId);
      if (!partnerCheck) return;

      const result = await ctx.messageLifecycle.edit({
        ticketId,
        partnerId: actor.partnerId,
        messageId,
        actor,
        newText,
      });

      if (!result.ok) {
        switch (result.code) {
          case 'NOT_OWN_MESSAGE':
            return socket.emit('error', { message: 'Can only edit your own messages' });
          case 'CANNOT_MUTATE_SYSTEM':
            return socket.emit('error', { message: 'Cannot edit system messages' });
          case 'CANNOT_MUTATE_DELETED':
            return socket.emit('error', { message: 'Cannot edit deleted messages' });
          case 'EDIT_WINDOW_EXPIRED':
            return socket.emit('error', { message: 'Edit window has expired (15 min)' });
          case 'GUARD_REJECTED':
            return socket.emit('error', { message: 'Edit blocked: GUARD_REJECTED' });
          case 'TICKET_NOT_FOUND':
          case 'MESSAGE_NOT_FOUND':
            return; // partner-scope guard already emitted; message-not-found silent (legacy)
          default:
            return;
        }
      }

      applyEffects(ctx.io, result.effects);
    } catch (err: unknown) { logger.error({ err: err instanceof Error ? err.message : String(err) }, '[message:edit] error'); }
  });

  // ── Message Delete ────────────────────────────────────────────────────────────
  socket.on('message:delete', async (data: unknown) => {
    if (!requireIdentified(socket)) return;
    const parsed = validatePayload(socket, messageDeleteSchema, data);
    if (!parsed) return;
    const { ticketId, messageId } = parsed;
    socketioEventsTotal.inc({ event: 'message:delete' });
    try {
      const actor = socketActor(socket);
      if (!actor) return;

      const partnerCheck = await requireActorTicketScope(socket, actor, ticketId);
      if (!partnerCheck) return;

      const result = await ctx.messageLifecycle.delete({
        ticketId,
        partnerId: actor.partnerId,
        messageId,
        actor,
      });

      if (!result.ok) {
        switch (result.code) {
          case 'NOT_OWN_MESSAGE':
            return socket.emit('error', { message: 'Can only delete your own messages' });
          case 'CANNOT_MUTATE_SYSTEM':
            return socket.emit('error', { message: 'Cannot delete system messages' });
          case 'TICKET_NOT_FOUND':
          case 'MESSAGE_NOT_FOUND':
            return; // partner-scope guard already emitted; not-found silent (legacy)
          default:
            return;
        }
      }

      applyEffects(ctx.io, result.effects);
    } catch (err: unknown) { logger.error({ err: err instanceof Error ? err.message : String(err) }, '[message:delete] error'); }
  });

  // ── Message Reactions ─────────────────────────────────────────────────────
  socket.on('message:react', async (data: unknown) => {
    if (!requireIdentified(socket)) { logger.warn('[message:react] Not identified'); return; }
    const parsed = validatePayload(socket, messageReactSchema, data);
    if (!parsed) return;
    if (!checkSocketRateLimit(socket, 'message:react')) return;
    const { ticketId, messageId, emoji } = parsed;
    socketioEventsTotal.inc({ event: 'message:react' });
    try {
      const actor = socketActor(socket);
      if (!actor) {
        logger.warn({ ticketId }, '[message:react] Missing actor');
        return;
      }

      // Partner-scope guard before the lifecycle — preserves the legacy
      // "Not authorized" wording on cross-tenant access. The lifecycle
      // would also refuse with TICKET_NOT_FOUND, but the handler-level
      // check is the canonical UX (matches `handlers/ticket.ts` close).
      const partnerCheck = await requireActorTicketScope(socket, actor, ticketId);
      if (!partnerCheck) return;

      const result = await ctx.messageLifecycle.react({
        ticketId,
        partnerId: actor.partnerId,
        messageId,
        actor,
        emoji,
      });

      if (!result.ok) {
        switch (result.code) {
          case 'INVALID_REACTION':
            return socket.emit('error', { message: 'Invalid reaction emoji' });
          case 'CANNOT_MUTATE_SYSTEM':
            return socket.emit('error', { message: 'Cannot react to system messages' });
          case 'CANNOT_MUTATE_DELETED':
            return socket.emit('error', { message: 'Cannot react to deleted messages' });
          case 'TICKET_NOT_FOUND':
            // Defense-in-depth — the handler-level guard above already
            // emitted on cross-tenant access; this branch only fires if
            // the ticket vanished between the guard and the lifecycle call.
            return;
          case 'MESSAGE_NOT_FOUND':
            logger.warn({ messageId, ticketId }, '[message:react] Message not found');
            return;
          default:
            return;
        }
      }

      applyEffects(ctx.io, result.effects);
    } catch (err: unknown) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, '[message:react] error');
    }
  });
}
