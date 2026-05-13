import { Socket } from 'socket.io';
import logger from '../../utils/logger.js';
import { Rooms } from '../../utils/rooms.js';
import { mapMessageRow } from '../../utils/messageMapper.js';
import { requireActorTicketScope } from '../partnerScope.js';
import {
  findTicketMessagesPaginated,
  markDelivered,
  markRead,
} from '../../services/messageQueries.js';
import { socketActor } from '../../services/ticketLifecycle/index.js';
import { applyCommandResult } from '../commandBus/index.js';
import {
  MAX_BATCH_DELETE,
} from '../../constants.js';
import {
  requireIdentified,
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
  // Read-path event — not routed through the command bus (no lifecycle verb,
  // no broadcasts; the response is a direct emit back to the caller).
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
    try {
      const actor = socketActor(socket);
      if (!actor) return;

      const result = await ctx.bus.dispatch(
        {
          type: 'message:send',
          partnerId: actor.partnerId,
          actor,
          ticketId: parsed.ticketId,
          text: parsed.text,
          mediaUrl: parsed.mediaUrl,
          attachments: parsed.attachments,
          whisper: parsed.whisper,
          replyToId: parsed.replyToId ?? null,
          localId: parsed.localId,
          improvedFromUsageLogId: parsed.improvedFromUsageLogId,
        },
        socket.id,
      );
      applyCommandResult(socket, ctx.io, result);
    } catch (err: unknown) { logger.error({ err: err instanceof Error ? err.message : String(err) }, '[message:send] error'); }
  });

  // ── message:delivered ───────────────────────────────────────────────────────
  // Read-path side-effect — not routed through the bus.
  socket.on('message:delivered', async (data: unknown) => {
    if (!requireIdentified(socket)) return;
    const parsed = validatePayload(socket, messageDeliveredSchema, data);
    if (!parsed) return;
    const { ticketId, messageId } = parsed;
    try {
      const actor = socketActor(socket);
      if (!actor) return;
      const ticket = await requireActorTicketScope(socket, actor, ticketId);
      if (!ticket) return;

      const now = await markDelivered(messageId, ticketId);
      ctx.io.to(Rooms.ticket(ticketId)).emit('message:status', { messageId, ticketId, status: 'delivered', timestamp: now });
    } catch (err: unknown) { logger.error({ err: err instanceof Error ? err.message : String(err) }, '[message:delivered] error'); }
  });

  // ── message:read ────────────────────────────────────────────────────────────
  // Read-path side-effect — not routed through the bus.
  socket.on('message:read', async (data: unknown) => {
    if (!requireIdentified(socket)) return;
    const parsed = validatePayload(socket, messageReadSchema, data);
    if (!parsed) return;
    const { ticketId, messageIds } = parsed;
    try {
      const actor = socketActor(socket);
      if (!actor) return;
      const ticket = await requireActorTicketScope(socket, actor, ticketId);
      if (!ticket) return;

      const limitedIds = messageIds.slice(0, MAX_BATCH_DELETE);
      const now = await markRead(limitedIds, ticketId);

      for (const messageId of limitedIds) {
        ctx.io.to(Rooms.ticket(ticketId)).emit('message:status', { messageId, ticketId, status: 'read', timestamp: now });
      }
    } catch (err: unknown) { logger.error({ err: err instanceof Error ? err.message : String(err) }, '[message:read] error'); }
  });

  // ── message:edit ────────────────────────────────────────────────────────────
  socket.on('message:edit', async (data: unknown) => {
    if (!requireIdentified(socket)) return;
    const parsed = validatePayload(socket, messageEditSchema, data);
    if (!parsed) return;
    if (!checkSocketRateLimit(socket, 'message:edit')) return;
    try {
      const actor = socketActor(socket);
      if (!actor) return;

      const result = await ctx.bus.dispatch(
        {
          type: 'message:edit',
          partnerId: actor.partnerId,
          actor,
          ticketId: parsed.ticketId,
          messageId: parsed.messageId,
          newText: parsed.text,
        },
        socket.id,
      );
      applyCommandResult(socket, ctx.io, result);
    } catch (err: unknown) { logger.error({ err: err instanceof Error ? err.message : String(err) }, '[message:edit] error'); }
  });

  // ── message:delete ──────────────────────────────────────────────────────────
  socket.on('message:delete', async (data: unknown) => {
    if (!requireIdentified(socket)) return;
    const parsed = validatePayload(socket, messageDeleteSchema, data);
    if (!parsed) return;
    try {
      const actor = socketActor(socket);
      if (!actor) return;

      const result = await ctx.bus.dispatch(
        {
          type: 'message:delete',
          partnerId: actor.partnerId,
          actor,
          ticketId: parsed.ticketId,
          messageId: parsed.messageId,
        },
        socket.id,
      );
      applyCommandResult(socket, ctx.io, result);
    } catch (err: unknown) { logger.error({ err: err instanceof Error ? err.message : String(err) }, '[message:delete] error'); }
  });

  // ── message:react ───────────────────────────────────────────────────────────
  socket.on('message:react', async (data: unknown) => {
    if (!requireIdentified(socket)) { logger.warn('[message:react] Not identified'); return; }
    const parsed = validatePayload(socket, messageReactSchema, data);
    if (!parsed) return;
    if (!checkSocketRateLimit(socket, 'message:react')) return;
    try {
      const actor = socketActor(socket);
      if (!actor) {
        logger.warn({ ticketId: parsed.ticketId }, '[message:react] Missing actor');
        return;
      }

      const result = await ctx.bus.dispatch(
        {
          type: 'message:react',
          partnerId: actor.partnerId,
          actor,
          ticketId: parsed.ticketId,
          messageId: parsed.messageId,
          emoji: parsed.emoji,
        },
        socket.id,
      );
      applyCommandResult(socket, ctx.io, result);
    } catch (err: unknown) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, '[message:react] error');
    }
  });
}
