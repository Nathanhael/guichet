/**
 * Implementation of `lifecycle.send()`. The hot path. Encapsulates:
 *  - tenant-scope check + ticket-status check (`TICKET_NOT_FOUND` /
 *    `TICKET_CLOSED`)
 *  - empty-message check (no text + no mediaUrl + no attachments → `EMPTY_MESSAGE`)
 *  - mediaUrl validation via `isValidMediaUrl`
 *  - sync content guards (fail-closed → `GUARD_REJECTED`)
 *  - repetition guard via port (fail-open on infra error)
 *  - attachment validation (filter to `/uploads/`, slice to 5)
 *  - whisper authz clamp (silent + warn for non-support actors — preserves
 *    legacy behavior)
 *  - sender denormalization from the actor
 *  - INSERT message
 *  - SLA first-staff-response stamp (synchronous try/catch, non-fatal);
 *    produces conditional `slaResolved` effect
 *  - reply snippet resolution (when `replyToId` is set)
 *  - 250ms AI translation prewarm race per viewer language
 *  - effect array assembled in documented order: emit (or whisperEmit)
 *    → slaResolved? → notifyPreviewers → invalidateSummary → unfurlLinks
 */
import crypto from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import { isNull } from 'drizzle-orm';

import { messages, partners, slaBreaches, tickets } from '../../db/schema.js';
import { isSupportLike } from '../roles.js';
import logger from '../../utils/logger.js';
import { isValidMediaUrl } from '../../utils/security.js';
import { Rooms } from '../../utils/rooms.js';

import { recordGuardBlock } from './guardAudit.js';
import type { Effect } from '../ticketLifecycle/index.js';
import type {
  MessageLifecycleDeps,
  MessageLifecycleResult,
  SendArgs,
  SendMessage,
  SendOk,
} from './types.js';
import type { AiTranslationPort, ModerationPort } from './ports.js';

export interface SendDeps {
  db: MessageLifecycleDeps['db'];
  moderation: ModerationPort;
  aiTranslation: AiTranslationPort;
}

export async function runSend(
  deps: SendDeps,
  args: SendArgs,
): Promise<MessageLifecycleResult<SendOk>> {
  // Tenant scope + ticket-status check
  const [ticket] = await deps.db
    .select({ id: tickets.id, status: tickets.status })
    .from(tickets)
    .where(and(eq(tickets.id, args.ticketId), eq(tickets.partnerId, args.partnerId)));
  if (!ticket) return { ok: false, code: 'TICKET_NOT_FOUND' };
  if (ticket.status === 'closed') return { ok: false, code: 'TICKET_CLOSED' };

  // Empty-message check (no text, no mediaUrl, no attachments)
  const hasText = !!(args.text && args.text.trim().length > 0);
  const hasMedia = !!args.mediaUrl;
  const hasAttachments = !!(args.attachments && args.attachments.length > 0);
  if (!hasText && !hasMedia && !hasAttachments) {
    return { ok: false, code: 'EMPTY_MESSAGE' };
  }

  // mediaUrl validation
  if (args.mediaUrl && !isValidMediaUrl(args.mediaUrl)) {
    return { ok: false, code: 'INVALID_MEDIA_URL' };
  }

  // Attachment validation: filter to /uploads/ and cap at 5
  const validAttachments = Array.isArray(args.attachments)
    ? args.attachments
        .filter(a => a && typeof a.url === 'string' && a.url.startsWith('/uploads/')
          && typeof a.name === 'string' && typeof a.size === 'number')
        .slice(0, 5)
    : undefined;

  // Content moderation on text. Skipped for attachment-only sends — matches
  // the legacy handler. Attachment-only = mediaUrl present and text is empty
  // / `[attachment]` placeholder. The moderator owns guard order, per-scope
  // dispatch (here: message:send runs all 7 guards), and the multi-trigger
  // reporting that lands in audit_log on block.
  const isAttachmentOnly = !!args.mediaUrl && (!args.text || args.text === '[attachment]');
  let text = args.text ?? '';
  if (!isAttachmentOnly) {
    const result = await deps.moderation.moderate(text, {
      senderId: args.actor.userId,
      partnerId: args.partnerId,
      scope: 'message:send',
    });
    if (result.decision === 'block') {
      await recordGuardBlock({
        db: deps.db,
        actorId: args.actor.userId,
        partnerId: args.partnerId,
        ticketId: args.ticketId,
        scope: 'message:send',
        original: result.original,
        sanitized: result.sanitized,
        triggered: result.triggered,
        blockingCode: result.blockingCode!,
      });
      return { ok: false, code: 'GUARD_REJECTED' };
    }
    text = result.sanitized;
  }

  // Whisper authz clamp — silently drop whisper:true for non-support
  // actors (preserves legacy behavior). Log at warn so client bugs leave
  // a trail.
  const isWhisper = !!args.whisper && isSupportLike(args.actor.role);
  if (args.whisper && !isWhisper) {
    logger.warn(
      { senderId: args.actor.userId, role: args.actor.role },
      '[messageLifecycle.send] non-support actor attempted whisper — clamped to public',
    );
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await deps.db.insert(messages).values({
    id,
    ticketId: args.ticketId,
    senderId: args.actor.userId,
    senderName: args.actor.name,
    senderRole: args.actor.role,
    senderLang: args.actor.lang,
    senderIsExternal: args.actor.isExternal,
    text,
    mediaUrl: args.mediaUrl ?? null,
    attachments: validAttachments && validAttachments.length > 0 ? validAttachments : null,
    whisper: isWhisper ? 1 : 0,
    createdAt: now,
    reactions: {},
  });

  const message: SendMessage = {
    id,
    ticketId: args.ticketId,
    senderId: args.actor.userId,
    senderName: args.actor.name,
    senderRole: args.actor.role,
    senderLang: args.actor.lang,
    senderIsExternal: args.actor.isExternal,
    text,
    originalText: text,
    mediaUrl: args.mediaUrl,
    attachments: validAttachments && validAttachments.length > 0 ? validAttachments : null,
    whisper: isWhisper,
    system: false,
    timestamp: now,
    createdAt: now,
    reactions: {},
    replyToId: args.replyToId ?? null,
    ...(args.localId ? { localId: args.localId } : {}),
  };

  // Reply snippet — fetch + truncate. Matches legacy `resolveReplySnippet`.
  if (args.replyToId) {
    const [ref] = await deps.db
      .select({
        id: messages.id, senderName: messages.senderName,
        text: messages.text, mediaUrl: messages.mediaUrl, deletedAt: messages.deletedAt,
      })
      .from(messages).where(eq(messages.id, args.replyToId)).limit(1);
    if (ref) {
      message.replyTo = {
        id: ref.id,
        senderName: ref.senderName ?? 'Unknown',
        text: ref.deletedAt ? '' : (ref.text ?? '[Attachment]').slice(0, 100),
        mediaUrl: ref.mediaUrl ?? null,
      };
    }
  }

  // Translation prewarm — racing per-viewer-lang against a 250ms budget.
  if (!isWhisper && text && args.viewerLangs && args.viewerLangs.size > 0) {
    try {
      const [partnerRow] = await deps.db
        .select({ aiFeatures: partners.aiFeatures })
        .from(partners).where(eq(partners.id, args.partnerId)).limit(1);
      const aiFeatures = (partnerRow?.aiFeatures as Record<string, unknown> | null) || {};
      if (aiFeatures.translation && aiFeatures.queueLangAwareness) {
        const targets = Array.from(args.viewerLangs).filter(l => l && l !== args.actor.lang);
        if (targets.length > 0) {
          const translations: Record<string, string> = {};
          const PREWARM_BUDGET_MS = 250;
          const work = Promise.all(targets.map(async (tl) => {
            try {
              const res = await deps.aiTranslation.translate({
                partnerId: args.partnerId,
                userId: args.actor.userId,
                text,
                targetLang: tl,
                budgetMs: PREWARM_BUDGET_MS,
              });
              if (res) translations[tl] = res;
            } catch {
              // Per-lang failure is silent — prewarm is best-effort.
            }
          }));
          await Promise.race([
            work,
            new Promise<void>((r) => setTimeout(r, PREWARM_BUDGET_MS)),
          ]);
          if (Object.keys(translations).length > 0) {
            message.translations = translations;
          }
        }
      }
    } catch (err) {
      logger.debug(
        { err: err instanceof Error ? err.message : String(err) },
        '[messageLifecycle.send] prewarm skipped (non-fatal)',
      );
    }
  }

  const broadcastEffect: Effect = isWhisper
    ? {
        type: 'whisperEmit',
        ticketId: args.ticketId,
        event: 'message:new',
        payload: message,
      }
    : {
        type: 'emit',
        rooms: [Rooms.ticket(args.ticketId)],
        event: 'message:new',
        payload: message,
      };

  const effects: Effect[] = [broadcastEffect];

  // SLA first-staff-response stamp. Synchronous + try/catch — non-fatal.
  // Mirrors the legacy `markFirstStaffResponse` semantics but inlined so
  // the lifecycle owns its writes top-to-bottom and the test substrate
  // (PGLite) sees them.
  if (!isWhisper && STAFF_ROLES.has(args.actor.role)) {
    try {
      const updated = await deps.db.update(tickets)
        .set({ firstStaffResponseAt: now })
        .where(and(eq(tickets.id, args.ticketId), isNull(tickets.firstStaffResponseAt)))
        .returning({ partnerId: tickets.partnerId, dept: tickets.dept, createdAt: tickets.createdAt });
      if (updated.length > 0) {
        const { partnerId, createdAt } = updated[0];
        const resolvedRows = await deps.db.update(slaBreaches)
          .set({ resolvedAt: now, resolvedReason: 'first_response' })
          .where(and(eq(slaBreaches.ticketId, args.ticketId), isNull(slaBreaches.resolvedAt)))
          .returning({ id: slaBreaches.id });
        if (resolvedRows.length > 0) {
          const respondedInMinutes = Math.max(0, Math.round(
            (new Date(now).getTime() - new Date(createdAt).getTime()) / 60_000,
          ));
          effects.push({
            type: 'slaResolved',
            ticketId: args.ticketId,
            partnerId,
            respondedInMinutes,
          });
        }
      }
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), ticketId: args.ticketId },
        '[messageLifecycle.send] SLA stamp failed (non-fatal)',
      );
    }
  }

  effects.push({ type: 'notifyPreviewers', ticketId: args.ticketId });
  effects.push({ type: 'invalidateSummary', ticketId: args.ticketId });

  // Background unfurl link previews (only for non-whisper public sends).
  if (!isWhisper && text && URL_REGEX.test(text)) {
    effects.push({
      type: 'unfurlLinks',
      ticketId: args.ticketId,
      messageId: id,
      text,
    });
  }

  return { ok: true, data: { message, isWhisper }, effects };
}

const URL_REGEX = /https?:\/\/[^\s<]+/i;

const STAFF_ROLES = new Set(['support', 'admin', 'platform_operator']);
