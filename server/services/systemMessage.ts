import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/postgres.js';
import { messages } from '../db/schema.js';

/**
 * Inserts a system-generated message into a ticket's message history
 * and returns the fully-formed message object ready for socket emission.
 *
 * Replaces duplicated raw SQL inserts scattered across socket handlers.
 * Uses Drizzle ORM for type-safe insertion.
 */
export async function insertSystemMessage(
  ticketId: string,
  text: string,
): Promise<{
  id: string;
  ticketId: string;
  senderId: string;
  senderName: string;
  senderRole: string;
  senderLang: string;
  text: string;
  originalText: string;
  whisper: boolean;
  system: boolean;
  timestamp: string;
  createdAt: string;
  reactions: Record<string, never>;
}> {
  const id = uuidv4();
  const now = new Date().toISOString();

  await db.insert(messages).values({
    id,
    ticketId,
    senderId: '__system__',
    senderName: 'System',
    senderRole: 'admin',
    senderLang: 'en',
    text,
    whisper: 0,
    system: 1,
    createdAt: now,
    reactions: {},
  });

  return {
    id,
    ticketId,
    senderId: '__system__',
    senderName: 'System',
    senderRole: 'admin',
    senderLang: 'en',
    text,
    originalText: text,
    whisper: false,
    system: true,
    timestamp: now,
    createdAt: now,
    reactions: {},
  };
}
