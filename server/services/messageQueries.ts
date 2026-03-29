// server/services/messageQueries.ts
import { eq, and, asc, isNull, inArray } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/postgres.js';
import { messages, ticketLabels } from '../db/schema.js';

export interface InsertMessageData {
  ticketId: string;
  senderId: string;
  senderName: string;
  senderRole: string;
  senderLang: string;
  text: string;
  mediaUrl?: string | null;
  whisper?: boolean;
  system?: boolean;
}

/**
 * Inserts a chat message and returns a socket-ready message object.
 * Used by: message:send, ticket:new
 */
export async function insertMessage(data: InsertMessageData) {
  const id = uuidv4();
  const now = new Date().toISOString();

  await db.insert(messages).values({
    id,
    ticketId: data.ticketId,
    senderId: data.senderId,
    senderName: data.senderName,
    senderRole: data.senderRole,
    senderLang: data.senderLang,
    text: data.text,
    mediaUrl: data.mediaUrl || null,
    whisper: data.whisper ? 1 : 0,
    system: data.system ? 1 : 0,
    createdAt: now,
    reactions: {},
  });

  return {
    id,
    ticketId: data.ticketId,
    senderId: data.senderId,
    senderName: data.senderName,
    senderRole: data.senderRole,
    senderLang: data.senderLang,
    text: data.text,
    originalText: data.text,
    mediaUrl: data.mediaUrl || undefined,
    whisper: !!data.whisper,
    system: !!data.system,
    timestamp: now,
    createdAt: now,
    reactions: {},
  };
}

/**
 * Fetches all messages for a ticket, ordered by creation time.
 * Used by: support:join (ticket history)
 */
export async function findTicketMessages(ticketId: string) {
  return db
    .select()
    .from(messages)
    .where(eq(messages.ticketId, ticketId))
    .orderBy(asc(messages.createdAt));
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
 * Soft-deletes a message (sets deletedAt, clears text).
 * Used by: message:delete
 */
export async function softDeleteMessage(messageId: string) {
  const now = new Date().toISOString();
  await db
    .update(messages)
    .set({ deletedAt: now, text: '' })
    .where(eq(messages.id, messageId));
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
