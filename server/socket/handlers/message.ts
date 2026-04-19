import { Socket } from 'socket.io';
import logger from '../../utils/logger.js';
import { Rooms } from '../../utils/rooms.js';
import { markFirstStaffResponse } from '../../services/sla.js';
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
import { invalidateSummary, runAiAction } from '../../services/ai/index.js';
import { unfurlLinks } from '../../services/linkPreview.js';
import { getRedisClients } from '../../utils/redis.js';
import { db } from '../../db.js';
import { partners } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { crossLangPickupTotal } from '../../utils/metrics.js';
import {
  MAX_MESSAGE_LENGTH,
  MAX_EDIT_WINDOW_MS,
  MAX_BATCH_DELETE,
  REACTION_EMOJIS,
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
  type SenderInfo,
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
  socket.on('message:send', async (data: unknown) => {
    if (!requireIdentified(socket)) return;
    const parsed = validatePayload(socket, messageSendSchema, data);
    if (!parsed) return;
    if (!checkSocketRateLimit(socket, 'message:send')) return;
    const { ticketId, text, mediaUrl, attachments, whisper, replyToId, localId } = parsed;
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
          // Platform operators are never Azure B2B guests by definition
          // (they authenticate via our staff SSO path with acct=member).
          isExternal: false,
        };
        logger.info({ senderId }, '[message:send] Platform operator fallback — no membership row');
      }

      logger.info({ senderFound: !!sender, role: sender?.role }, '[message:send] Sender lookup');
      if (!sender) return logger.error({ senderId }, '[message:send] sender not found or no membership for ticket partner');

      if (sender.lang && ticket.agentLang && sender.lang !== ticket.agentLang && socket.data.isSupport) {
        crossLangPickupTotal.inc({ partner_id: ticket.partnerId, support_lang: sender.lang, ticket_lang: ticket.agentLang });
      }

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
          // Structured rejection event so the client can remove the matching
          // optimistic message and surface a reason. The legacy 'error' emit
          // is kept for backwards-compat with older clients that haven't
          // wired up the message:rejected handler yet.
          socket.emit('message:rejected', { ticketId, localId, code: syncResult.code });
          socket.emit('error', { message: `Message blocked: ${syncResult.code}` });
          return;
        }
        guardedText = syncResult.text;

        // Redis-dependent repetition guard (fail open if Redis unavailable)
        try {
          const { pubClient } = getRedisClients();
          const repResult = await guardRepetition(pubClient as Parameters<typeof guardRepetition>[0], guardedText, senderId);
          if (!repResult.ok) {
            logger.warn({ senderId, code: repResult.code }, '[message:send] Blocked by content guard');
            socket.emit('message:rejected', { ticketId, localId, code: repResult.code });
            socket.emit('error', { message: `Message blocked: ${repResult.code}` });
            return;
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
        senderIsExternal: sender.isExternal,
        text: guardedText,
        mediaUrl,
        attachments: validAttachments && validAttachments.length > 0 ? validAttachments : null,
        whisper: isWhisper,
        replyToId: replyToId || null,
      });
      const messageId = msgPayload.id;

      // SLA: stamp first staff response if applicable
      try {
        const slaResult = await markFirstStaffResponse({
          ticketId,
          at: msgPayload.createdAt,
          senderRole: sender.role,
          isWhisper: !!isWhisper,
        });
        if (slaResult.resolvedBreach) {
          ctx.io.to(Rooms.ticket(ticketId)).emit('sla:resolved', {
            ticketId,
            partnerId: slaResult.partnerId,
            respondedInMinutes: slaResult.respondedInMinutes,
          });
        }
      } catch (slaErr) {
        logger.error({ err: slaErr instanceof Error ? slaErr.message : String(slaErr), ticketId }, '[message:send] SLA stamp failed (non-fatal)');
      }

      // Resolve reply snippet for broadcast (if replying to a message)
      let broadcastPayload: typeof msgPayload & {
        localId?: string;
        replyTo?: { id: string; senderName: string; text: string; mediaUrl: string | null } | null;
        translations?: Record<string, string>;
      } = localId ? { ...msgPayload, localId } : msgPayload;
      if (replyToId) {
        const snippet = await resolveReplySnippet(replyToId);
        broadcastPayload = { ...broadcastPayload, replyTo: snippet };
      }

      // Pre-warm cross-lang translations for the agent(s) watching this
      // ticket in a different language. Gated on partner aiFeatures so
      // non-translating tenants skip the AI call entirely. Non-fatal: on
      // any provider error, client-side useAutoTranslation still catches
      // up on render (old behavior, minus the pre-warm).
      try {
        const partnerRow = await db
          .select({ aiFeatures: partners.aiFeatures })
          .from(partners)
          .where(eq(partners.id, ticket.partnerId))
          .limit(1);
        const aiFeatures = (partnerRow[0]?.aiFeatures as Record<string, unknown>) || {};
        const roomSockets = await ctx.io.in(Rooms.ticket(ticketId)).fetchSockets();
        const viewerLangs = new Set<string>();
        for (const s of roomSockets) {
          if (s.id === socket.id) continue;
          const lg = (s.data.lang as string) || '';
          if (lg) viewerLangs.add(lg);
        }
        const targets = computePrewarmTargets({
          senderLang: sender.lang,
          ticketAgentLang: ticket.agentLang ?? null,
          viewerLangs,
          aiFeatures: aiFeatures as { translation?: boolean; queueLangAwareness?: boolean },
        });
        if (targets.length > 0 && guardedText) {
          const translations: Record<string, string> = {};
          const langLabel = (l: string) =>
            l === 'nl' ? 'Dutch' : l === 'fr' ? 'French' : 'English';
          await Promise.all(targets.map(async (tl) => {
            try {
              const res = await runAiAction({
                partnerId: ticket.partnerId,
                userId: senderId,
                feature: 'translation',
                action: 'translate',
                vars: { text: guardedText, targetLang: langLabel(tl) },
                temperature: 0.3,
                maxTokens: 1024,
              });
              if (res.content) translations[tl] = res.content.trim();
            } catch (err) {
              logger.debug({ err: err instanceof Error ? err.message : String(err), tl }, '[message:send] pre-warm translate failed (non-fatal)');
            }
          }));
          if (Object.keys(translations).length > 0) {
            broadcastPayload = { ...broadcastPayload, translations };
          }
        }
      } catch (err) {
        logger.debug({ err: err instanceof Error ? err.message : String(err) }, '[message:send] pre-warm skipped (non-fatal)');
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
      // Invalidate cached AI summary for this ticket (fire-and-forget)
      invalidateSummary(ticketId).catch(() => {});
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
  socket.on('message:delivered', async (data: unknown) => {
    if (!requireIdentified(socket)) return;
    const parsed = validatePayload(socket, messageDeliveredSchema, data);
    if (!parsed) return;
    const { ticketId, messageId } = parsed;
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
  socket.on('message:read', async (data: unknown) => {
    if (!requireIdentified(socket)) return;
    const parsed = validatePayload(socket, messageReadSchema, data);
    if (!parsed) return;
    const { ticketId, messageIds } = parsed;
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
  socket.on('message:edit', async (data: unknown) => {
    if (!requireIdentified(socket)) return;
    const parsed = validatePayload(socket, messageEditSchema, data);
    if (!parsed) return;
    if (!checkSocketRateLimit(socket, 'message:edit')) return;
    const { ticketId, messageId, text: newText } = parsed;
    socketioEventsTotal.inc({ event: 'message:edit' });
    try {
      const senderId = socket.data.userId;
      if (!senderId) return;
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
  socket.on('message:delete', async (data: unknown) => {
    if (!requireIdentified(socket)) return;
    const parsed = validatePayload(socket, messageDeleteSchema, data);
    if (!parsed) return;
    const { ticketId, messageId } = parsed;
    socketioEventsTotal.inc({ event: 'message:delete' });
    try {
      const senderId = socket.data.userId;
      if (!senderId) return;

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
  socket.on('message:react', async (data: unknown) => {
    if (!requireIdentified(socket)) { logger.warn('[message:react] Not identified'); return; }
    const parsed = validatePayload(socket, messageReactSchema, data);
    if (!parsed) return;
    if (!checkSocketRateLimit(socket, 'message:react')) return;
    const { ticketId, messageId, emoji } = parsed;
    logger.info({ ticketId, messageId, emoji }, '[message:react] Received');
    socketioEventsTotal.inc({ event: 'message:react' });
    try {
      const userId = socket.data.userId;
      if (!userId) { logger.warn({ userId, ticketId, messageId, emoji }, '[message:react] Missing userId'); return; }

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
