// server/services/messageQueries.ts
import { eq, and, asc, isNull, inArray, lt, or } from 'drizzle-orm';
import { db } from '../db/postgres.js';
import { messages, ticketLabels, users } from '../db/schema.js';
import logger from '../utils/logger.js';
import { getStorage } from './storage.js';

import type { LinkPreview } from './linkPreview.js';

export interface InsertMessageData {
  ticketId: string;
  senderId: string;
  senderName: string;
  senderRole: string;
  senderLang: string;
  /**
   * Azure B2B guest flag snapshot at send time. Denormalized onto the
   * messages row so MessageBubble can render the GUEST marker on
   * historical messages without a live presence lookup. Omit/`false` for
   * system messages and internal staff; pass `true` for external guests.
   */
  senderIsExternal?: boolean;
  text: string;
  mediaUrl?: string | null;
  attachments?: Array<{ url: string; name: string; mimeType: string; size: number }> | null;
  whisper?: boolean;
  system?: boolean;
  replyToId?: string | null;
}

/** Socket-ready message shape returned by insertMessage. */
export type SocketMessage = Awaited<ReturnType<typeof insertMessage>>;

/**
 * Inserts a chat message and returns a socket-ready message object.
 * Used by: message:send, ticket:new
 */
export async function insertMessage(data: InsertMessageData) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const senderIsExternal = !!data.senderIsExternal;

  await db.insert(messages).values({
    id,
    ticketId: data.ticketId,
    senderId: data.senderId,
    senderName: data.senderName,
    senderRole: data.senderRole,
    senderLang: data.senderLang,
    senderIsExternal,
    text: data.text,
    mediaUrl: data.mediaUrl || null,
    attachments: data.attachments || null,
    whisper: data.whisper ? 1 : 0,
    system: data.system ? 1 : 0,
    createdAt: now,
    reactions: {},
    replyToId: data.replyToId || null,
  });

  return {
    id,
    ticketId: data.ticketId,
    senderId: data.senderId,
    senderName: data.senderName,
    senderRole: data.senderRole,
    senderLang: data.senderLang,
    senderIsExternal,
    text: data.text,
    // Client uses originalText for "revert AI improvement" — set to input text at creation time
    originalText: data.text,
    mediaUrl: data.mediaUrl || undefined,
    attachments: data.attachments || undefined,
    whisper: !!data.whisper,
    system: !!data.system,
    timestamp: now,
    createdAt: now,
    reactions: {},
    replyToId: data.replyToId || null,
  };
}

export interface PaginatedMessages {
  messages: Array<typeof messages.$inferSelect>;
  hasMore: boolean;
  nextCursor?: string; // ISO timestamp|id composite cursor
}

/**
 * Fetches messages for a ticket with cursor-based pagination.
 * Cursor format: "createdAt|id" (composite keyset).
 * Orders oldest-first (ASC) so clients can append.
 *
 * Used by: support:join (initial load + "load more")
 */
export async function findTicketMessagesPaginated(
  ticketId: string,
  opts: { limit?: number; beforeCursor?: string } = {},
): Promise<PaginatedMessages> {
  const limit = Math.min(opts.limit ?? 50, 200);

  const whereClause = opts.beforeCursor
    ? (() => {
        const [cursorTs, cursorId] = opts.beforeCursor.split('|');
        if (!cursorTs || !cursorId) {
          throw new Error('Invalid cursor format — expected "createdAt|id"');
        }
        return and(
          eq(messages.ticketId, ticketId),
          or(
            lt(messages.createdAt, cursorTs),
            and(eq(messages.createdAt, cursorTs), lt(messages.id, cursorId)),
          ),
        );
      })()
    : eq(messages.ticketId, ticketId);

  const rows = await db
    .select()
    .from(messages)
    .where(whereClause)
    .orderBy(asc(messages.createdAt), asc(messages.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const lastRow = page[page.length - 1];
  const nextCursor = hasMore && lastRow ? `${lastRow.createdAt}|${lastRow.id}` : undefined;

  return { messages: page, hasMore, nextCursor };
}

/**
 * Fetches label IDs attached to a ticket.
 * Used by: support:join (ticket history)
 */
export async function findTicketLabelIds(ticketId: string): Promise<string[]> {
  const rows = await db
    .select({ labelId: ticketLabels.labelId })
    .from(ticketLabels)
    .where(eq(ticketLabels.ticketId, ticketId));
  return rows.map((r) => r.labelId);
}

/**
 * Fetches message metadata for edit authorization.
 * Used by: message:edit
 */
export async function findMessageForEdit(messageId: string, ticketId: string) {
  const rows = await db
    .select({
      senderId: messages.senderId,
      createdAt: messages.createdAt,
      system: messages.system,
      deletedAt: messages.deletedAt,
    })
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.ticketId, ticketId)));
  return rows[0];
}

/**
 * Fetches message metadata for delete authorization.
 * Used by: message:delete
 */
export async function findMessageForDelete(messageId: string, ticketId: string) {
  const rows = await db
    .select({
      senderId: messages.senderId,
      system: messages.system,
      deletedAt: messages.deletedAt,
    })
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.ticketId, ticketId)));
  return rows[0];
}

/**
 * Fetches minimal message fields needed for reaction validation.
 * Used by: message:react
 */
export async function findMessageForReact(messageId: string, ticketId: string) {
  const rows = await db
    .select({
      id: messages.id,
      system: messages.system,
      deletedAt: messages.deletedAt,
      reactions: messages.reactions,
    })
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.ticketId, ticketId)));
  return rows[0];
}

/**
 * Writes updated reactions JSONB to the message row.
 * Used by: message:react
 */
export async function updateMessageReactions(messageId: string, reactions: Record<string, string[]>) {
  await db
    .update(messages)
    .set({ reactions })
    .where(eq(messages.id, messageId));
}

/**
 * Updates message text and sets editedAt timestamp.
 * Used by: message:edit
 */
export async function updateMessageText(messageId: string, newText: string) {
  const now = new Date().toISOString();
  await db
    .update(messages)
    .set({ text: newText, editedAt: now })
    .where(eq(messages.id, messageId));
  return now;
}

/**
 * Soft-deletes a message (sets deletedAt, clears text, mediaUrl and attachments)
 * and deletes any uploaded blobs backing the cleared URLs. Blob deletion is
 * fire-and-forget AFTER the DB update commits — a storage outage must not
 * orphan the DB row.
 *
 * Used by: message:delete
 */
export async function softDeleteMessage(messageId: string) {
  const [existing] = await db
    .select({ mediaUrl: messages.mediaUrl, attachments: messages.attachments })
    .from(messages)
    .where(eq(messages.id, messageId));

  const filesToDelete: string[] = [];
  if (existing) {
    if (existing.mediaUrl && existing.mediaUrl.startsWith('/uploads/')) {
      filesToDelete.push(existing.mediaUrl.replace(/^\/uploads\//, ''));
    }
    const attachments = (existing.attachments ?? []) as Array<{ url?: string }>;
    for (const att of attachments) {
      if (att?.url?.startsWith('/uploads/')) {
        filesToDelete.push(att.url.replace(/^\/uploads\//, ''));
      }
    }
  }

  const now = new Date().toISOString();
  await db
    .update(messages)
    .set({ deletedAt: now, text: '', mediaUrl: null, attachments: null })
    .where(eq(messages.id, messageId));

  if (filesToDelete.length > 0) {
    const storage = getStorage();
    for (const filename of filesToDelete) {
      storage.delete(filename).catch((err: unknown) => {
        logger.warn(
          { messageId, filename, err: err instanceof Error ? err.message : String(err) },
          '[msgQueries] soft-delete: storage.delete failed',
        );
      });
    }
  }

  return now;
}

/**
 * Marks a single message as delivered.
 * Used by: message:delivered
 */
export async function markDelivered(messageId: string, ticketId: string) {
  const now = new Date().toISOString();
  await db
    .update(messages)
    .set({ deliveredAt: now })
    .where(and(eq(messages.id, messageId), eq(messages.ticketId, ticketId), isNull(messages.deliveredAt)));
  return now;
}

/**
 * Batch marks messages as read.
 * Used by: message:read
 */
export async function markRead(messageIds: string[], ticketId: string) {
  const now = new Date().toISOString();
  await db
    .update(messages)
    .set({ readAt: now })
    .where(and(eq(messages.ticketId, ticketId), inArray(messages.id, messageIds), isNull(messages.readAt)));
  return now;
}

/**
 * Resolves a reply snippet for inline quote blocks.
 * Returns sender name + truncated text (100 chars) for the referenced message.
 * Used by: message.list (tRPC), message:send (socket)
 */
export async function resolveReplySnippet(replyToId: string) {
  const row = await db
    .select({ id: messages.id, senderName: messages.senderName, text: messages.text, mediaUrl: messages.mediaUrl, deletedAt: messages.deletedAt })
    .from(messages)
    .where(eq(messages.id, replyToId))
    .limit(1);
  if (!row.length) return null;
  const r = row[0];
  return {
    id: r.id,
    senderName: r.senderName || 'Unknown',
    text: r.deletedAt ? '' : (r.text || '[Attachment]').slice(0, 100),
    mediaUrl: r.mediaUrl || null,
  };
}

/**
 * Batch-resolve reply snippets for multiple replyToIds in a single query.
 * Returns a Map keyed by message ID → snippet (or null if not found/deleted).
 */
export async function resolveReplySnippetsBatch(replyToIds: string[]): Promise<Map<string, { id: string; senderName: string; text: string; mediaUrl: string | null }>> {
  if (replyToIds.length === 0) return new Map();

  const rows = await db
    .select({ id: messages.id, senderName: messages.senderName, text: messages.text, mediaUrl: messages.mediaUrl, deletedAt: messages.deletedAt })
    .from(messages)
    .where(inArray(messages.id, replyToIds));

  const map = new Map<string, { id: string; senderName: string; text: string; mediaUrl: string | null }>();
  for (const r of rows) {
    map.set(r.id, {
      id: r.id,
      senderName: r.senderName || 'Unknown',
      text: r.deletedAt ? '' : (r.text || '[Attachment]').slice(0, 100),
      mediaUrl: r.mediaUrl || null,
    });
  }
  return map;
}

/**
 * Batch-resolve avatar URLs for a set of user IDs in a single query.
 * Returned map is keyed by user ID → avatarUrl (null if user has none or no row).
 * Used by message.list to decorate messages with live avatar URLs without
 * denormalizing onto the messages table (photos change; names/roles don't).
 */
export async function resolveUserAvatarsBatch(userIds: string[]): Promise<Map<string, string | null>> {
  if (userIds.length === 0) return new Map();
  const unique = Array.from(new Set(userIds));
  const rows = await db
    .select({ id: users.id, avatarUrl: users.avatarUrl })
    .from(users)
    .where(inArray(users.id, unique));
  const map = new Map<string, string | null>();
  for (const r of rows) map.set(r.id, r.avatarUrl ?? null);
  return map;
}

/**
 * Update link previews for a message (fire-and-forget after OG unfurling).
 */
export async function updateMessageLinkPreviews(messageId: string, linkPreviews: LinkPreview[]): Promise<void> {
  await db.update(messages).set({ linkPreviews }).where(eq(messages.id, messageId));
}
