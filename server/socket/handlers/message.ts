import { Socket } from 'socket.io';
import logger from '../../utils/logger.js';
import { Rooms } from '../../utils/rooms.js';
import { isValidMediaUrl } from '../../utils/security.js';
import { mapMessageRow } from '../../utils/messageMapper.js';
import { requirePartnerScope, requirePartnerScopeWith } from '../partnerScope.js';
import { findTicketForMessage } from '../../services/ticketQueries.js';
import { findSenderInfo } from '../../services/userQueries.js';
import {
  insertMessage,
  findTicketMessagesPaginated,
  findMessageForEdit,
  findMessageForDelete,
  findMessageForReact,
  updateMessageText,
  updateMessageReactions,
  softDeleteMessage,
  markDelivered,
  markRead,
  resolveReplySnippet,
  updateMessageLinkPreviews,
} from '../../services/messageQueries.js';
import { runSyncGuards, guardRepetition } from '../../services/guards.js';
import { invalidateSummary, scoreSentiment } from '../../services/ai/index.js';
import { unfurlLinks } from '../../services/linkPreview.js';
import { sendPush } from '../../services/pushNotification.js';
import { getRedisClients } from '../../utils/redis.js';
import {
  MAX_MESSAGE_LENGTH,
  MAX_EDIT_WINDOW_MS,
  MAX_BATCH_DELETE,
  REACTION_EMOJIS,
} from '../../constants.js';
import {
  requireIdentified,
  socketioEventsTotal,
  type HandlerContext,
  type MessageSendPayload,
  type SenderInfo,
} from './types.js';

export function register(socket: Socket, ctx: HandlerContext): void {
  // ── message:loadMore ────────────────────────────────────────────────────────
  socket.on('message:loadMore', async ({ ticketId, cursor }: { ticketId: string; cursor: string }) => {
    if (!requireIdentified(socket)) return;
    if (!ticketId || !cursor) return;

    try {
      const ticket = await requirePartnerScope(socket, ticketId);
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
  socket.on('message:send', async ({ ticketId, text, mediaUrl, attachments, whisper, replyToId, localId }: Omit<MessageSendPayload, 'senderId'>) => {
    if (!requireIdentified(socket)) return;
    socketioEventsTotal.inc({ event: 'message:send' });
    try {
      const senderId = socket.data.userId;
      if (!senderId) return socket.emit('error', { message: 'Not authenticated' });
      logger.info({ ticketId, senderId }, '[message:send] Received');
      if (!ticketId || (!text && !mediaUrl && (!attachments || attachments.length === 0))) return;
      if (mediaUrl && !isValidMediaUrl(mediaUrl)) return socket.emit('error', { message: 'Invalid media URL' });
      const ticket = await requirePartnerScopeWith(socket, ticketId, findTicketForMessage);
      logger.info({ ticketFound: !!ticket, status: ticket?.status }, '[message:send] Ticket lookup');
      if (!ticket || ticket.status === 'closed') return;

      let sender = await findSenderInfo(senderId, ticket.partnerId) as SenderInfo | undefined;

      // CR-03 fix: Platform operators have no membership row — fall back to socket.data
      if (!sender && socket.data.authedIsPlatformOperator) {
        sender = {
          name: socket.data.name as string || senderId,
          role: 'platform_operator',
          lang: (socket.data.lang as string) || 'en',
        };
        logger.info({ senderId }, '[message:send] Platform operator fallback — no membership row');
      }

      logger.info({ senderFound: !!sender, role: sender?.role }, '[message:send] Sender lookup');
      if (!sender) return logger.error({ senderId }, '[message:send] sender not found or no membership for ticket partner');

      // Authorization: only support/admin can send whispers
      const isWhisper = whisper && socket.data.isSupport;
      if (whisper && !isWhisper) {
        logger.warn({ senderId, role: sender.role }, '[message:send] Non-support user attempted whisper');
      }

      // CR-02: Run content moderation guards (skip for whispers and attachment-only messages)
      let guardedText = text;
      const isAttachmentOnly = !!mediaUrl && (!text || text === '[attachment]');
      if (!isWhisper && !isAttachmentOnly) {
        // Synchronous guards always run (fail closed — no try/catch bypass)
        const syncResult = runSyncGuards(text);
        if (!syncResult.ok) {
          logger.warn({ senderId, code: syncResult.code }, '[message:send] Blocked by content guard');
          return socket.emit('error', { message: `Message blocked: ${syncResult.code}` });
        }
        guardedText = syncResult.text;

        // Redis-dependent repetition guard (fail open if Redis unavailable)
        try {
          const { pubClient } = getRedisClients();
          const repResult = await guardRepetition(pubClient as Parameters<typeof guardRepetition>[0], guardedText, senderId);
          if (!repResult.ok) {
            logger.warn({ senderId, code: repResult.code }, '[message:send] Blocked by content guard');
            return socket.emit('error', { message: `Message blocked: ${repResult.code}` });
          }
        } catch (guardErr) {
          // Fail open for Redis-dependent guard only — sync guards already passed
          logger.error({ err: guardErr instanceof Error ? guardErr.message : String(guardErr) }, '[message:send] Repetition guard error (Redis)');
        }
      }

      // Validate attachments: max 5, each must have a valid upload URL
      const validAttachments = Array.isArray(attachments)
        ? attachments.filter(a => a && typeof a.url === 'string' && a.url.startsWith('/uploads/') && typeof a.name === 'string' && typeof a.size === 'number').slice(0, 5)
        : undefined;

      const msgPayload = await insertMessage({
        ticketId,
        senderId,
        senderName: sender.name,
        senderRole: sender.role,
        senderLang: sender.lang,
        text: guardedText,
        mediaUrl,
        attachments: validAttachments && validAttachments.length > 0 ? validAttachments : null,
        whisper: isWhisper,
        replyToId: replyToId || null,
      });
      const messageId = msgPayload.id;

      // Resolve reply snippet for broadcast (if replying to a message)
      let broadcastPayload: typeof msgPayload & { localId?: string; replyTo?: { id: string; senderName: string; text: string; mediaUrl: string | null } | null } = localId ? { ...msgPayload, localId } : msgPayload;
      if (replyToId) {
        const snippet = await resolveReplySnippet(replyToId);
        broadcastPayload = { ...broadcastPayload, replyTo: snippet };
      }

      if (isWhisper) {
        // CR-01: Whisper messages must only be sent to support/admin sockets, never to end-users
        const roomSockets = await ctx.io.in(Rooms.ticket(ticketId)).fetchSockets();
        for (const s of roomSockets) {
          if (s.data.isSupport) {
            s.emit('message:new', broadcastPayload);
          }
        }
      } else {
        ctx.io.to(Rooms.ticket(ticketId)).emit('message:new', broadcastPayload);
      }
      logger.info({ messageId, whisper: !!isWhisper }, '[message:send] Emitted message:new');
      // Push notification to agent when support replies (fire-and-forget)
      if (socket.data.isSupport && !isWhisper && ticket.agentId) {
        sendPush(ticket.agentId, {
          title: 'New message from support',
          body: `${sender.name}: ${guardedText.slice(0, 100)}`,
          ticketId,
          type: 'reply',
          tag: `ticket-${ticketId}`,
        });
      }
      // Invalidate cached AI summary for this ticket (fire-and-forget)
      invalidateSummary(ticketId).catch(() => {});
      // Fire-and-forget sentiment scoring (skip whispers — internal notes shouldn't affect sentiment)
      // ME-01 fix: Score on guardedText (what's stored/displayed), not raw pre-guard text
      if (!isWhisper) {
        scoreSentiment(ticket.partnerId, senderId, messageId, guardedText).catch(() => {});
      }
      // Fire-and-forget: unfurl link previews
      if (guardedText && !isWhisper) {
        unfurlLinks(guardedText).then(async (previews) => {
          if (previews.length === 0) return;
          await updateMessageLinkPreviews(messageId, previews);
          ctx.io.to(Rooms.ticket(ticketId)).emit('message:linkPreview', { ticketId, messageId, linkPreviews: previews });
        }).catch(() => {});
      }
    } catch (err: unknown) { logger.error({ err: err instanceof Error ? err.message : String(err) }, '[message:send] error'); }
  });

  // ── message:delivered ───────────────────────────────────────────────────────
  socket.on('message:delivered', async ({ ticketId, messageId }: { ticketId: string, messageId: string }) => {
    if (!requireIdentified(socket)) return;
    if (!ticketId || !messageId) return;
    try {
      // Tenant isolation: verify ticket belongs to caller's partner
      const ticket = await requirePartnerScope(socket, ticketId);
      if (!ticket) return;

      // Only update messages that belong to this ticket
      const now = await markDelivered(messageId, ticketId);
      ctx.io.to(Rooms.ticket(ticketId)).emit('message:status', { messageId, ticketId, status: 'delivered', timestamp: now });
    } catch (err: unknown) { logger.error({ err: err instanceof Error ? err.message : String(err) }, '[message:delivered] error'); }
  });

  // ── message:read ────────────────────────────────────────────────────────────
  socket.on('message:read', async ({ ticketId, messageIds }: { ticketId: string, messageIds: string[] }) => {
    if (!requireIdentified(socket)) return;
    if (!ticketId || !messageIds?.length) return;
    try {
      // Tenant isolation: verify ticket belongs to caller's partner
      const ticket = await requirePartnerScope(socket, ticketId);
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
  socket.on('message:edit', async ({ ticketId, messageId, text: newText }: { ticketId: string; messageId: string; text: string }) => {
    if (!requireIdentified(socket)) return;
    socketioEventsTotal.inc({ event: 'message:edit' });
    try {
      const senderId = socket.data.userId;
      if (!senderId || !ticketId || !messageId || !newText?.trim()) return;
      if (newText.trim().length > MAX_MESSAGE_LENGTH) return socket.emit('error', { message: 'Message too long' });

      // Verify ticket belongs to caller's partner
      const ticket = await requirePartnerScope(socket, ticketId);
      if (!ticket) return;

      // Only allow editing own messages within 15 minutes
      const msg = await findMessageForEdit(messageId, ticketId);
      if (!msg) return;
      if (msg.senderId !== senderId) return socket.emit('error', { message: 'Can only edit your own messages' });
      if (msg.system) return socket.emit('error', { message: 'Cannot edit system messages' });
      if (msg.deletedAt) return socket.emit('error', { message: 'Cannot edit deleted messages' });

      const ageMs = Date.now() - new Date(msg.createdAt).getTime();
      if (ageMs > MAX_EDIT_WINDOW_MS) return socket.emit('error', { message: 'Edit window has expired (15 min)' });

      // CR-01 fix: Run content moderation guards on edited text (mirrors message:send)
      let guardedText = newText.trim();
      const syncResult = runSyncGuards(guardedText);
      if (!syncResult.ok) {
        logger.warn({ senderId, code: syncResult.code }, '[message:edit] Blocked by content guard');
        return socket.emit('error', { message: `Edit blocked: ${syncResult.code}` });
      }
      guardedText = syncResult.text;

      // Redis-dependent repetition guard (fail open if Redis unavailable)
      try {
        const { pubClient } = getRedisClients();
        const repResult = await guardRepetition(pubClient as Parameters<typeof guardRepetition>[0], guardedText, senderId);
        if (!repResult.ok) {
          logger.warn({ senderId, code: repResult.code }, '[message:edit] Blocked by content guard');
          return socket.emit('error', { message: `Edit blocked: ${repResult.code}` });
        }
      } catch (guardErr) {
        logger.error({ err: guardErr instanceof Error ? guardErr.message : String(guardErr) }, '[message:edit] Repetition guard error (Redis)');
      }

      const now = await updateMessageText(messageId, guardedText);

      ctx.io.to(Rooms.ticket(ticketId)).emit('message:edited', { ticketId, messageId, text: guardedText, editedAt: now });
    } catch (err: unknown) { logger.error({ err: err instanceof Error ? err.message : String(err) }, '[message:edit] error'); }
  });

  // ── Message Delete ────────────────────────────────────────────────────────────
  socket.on('message:delete', async ({ ticketId, messageId }: { ticketId: string; messageId: string }) => {
    if (!requireIdentified(socket)) return;
    socketioEventsTotal.inc({ event: 'message:delete' });
    try {
      const senderId = socket.data.userId;
      if (!senderId || !ticketId || !messageId) return;

      const ticket = await requirePartnerScope(socket, ticketId);
      if (!ticket) return;

      const msg = await findMessageForDelete(messageId, ticketId);
      if (!msg) return;

      // Support/admin can delete any non-system message; others only their own
      if (!socket.data.isSupport && msg.senderId !== senderId) {
        return socket.emit('error', { message: 'Can only delete your own messages' });
      }
      if (msg.system) return socket.emit('error', { message: 'Cannot delete system messages' });
      if (msg.deletedAt) return; // Already deleted

      const now = await softDeleteMessage(messageId);

      ctx.io.to(Rooms.ticket(ticketId)).emit('message:deleted', { ticketId, messageId, deletedAt: now });
    } catch (err: unknown) { logger.error({ err: err instanceof Error ? err.message : String(err) }, '[message:delete] error'); }
  });

  // ── Message Reactions ─────────────────────────────────────────────────────
  socket.on('message:react', async ({ ticketId, messageId, emoji }: { ticketId: string; messageId: string; emoji: string }) => {
    logger.info({ ticketId, messageId, emoji }, '[message:react] Received');
    if (!requireIdentified(socket)) { logger.warn('[message:react] Not identified'); return; }
    socketioEventsTotal.inc({ event: 'message:react' });
    try {
      const userId = socket.data.userId;
      if (!userId || !ticketId || !messageId || !emoji) { logger.warn({ userId, ticketId, messageId, emoji }, '[message:react] Missing fields'); return; }

      // Validate emoji is in the allowed set
      if (!REACTION_EMOJIS.includes(emoji as typeof REACTION_EMOJIS[number])) {
        return socket.emit('error', { message: 'Invalid reaction emoji' });
      }

      // Tenant isolation
      const ticket = await requirePartnerScope(socket, ticketId);
      if (!ticket) { logger.warn({ ticketId }, '[message:react] Partner scope failed'); return; }

      // Fetch message and validate
      const msg = await findMessageForReact(messageId, ticketId);
      if (!msg) { logger.warn({ messageId, ticketId }, '[message:react] Message not found'); return; }
      if (msg.system) return socket.emit('error', { message: 'Cannot react to system messages' });
      if (msg.deletedAt) return socket.emit('error', { message: 'Cannot react to deleted messages' });

      // Toggle reaction: add or remove userId
      const reactions: Record<string, string[]> = { ...(msg.reactions || {}) };
      const users = reactions[emoji] || [];
      const idx = users.indexOf(userId);
      if (idx >= 0) {
        users.splice(idx, 1);
        if (users.length === 0) {
          delete reactions[emoji];
        } else {
          reactions[emoji] = users;
        }
      } else {
        reactions[emoji] = [...users, userId];
      }

      await updateMessageReactions(messageId, reactions);

      ctx.io.to(Rooms.ticket(ticketId)).emit('reaction:updated', { ticketId, messageId, reactions });
    } catch (err: unknown) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, '[message:react] error');
    }
  });
}
