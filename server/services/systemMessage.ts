import { insertMessage } from './messageQueries.js';

/**
 * Inserts a system-generated message into a ticket's message history
 * and returns the fully-formed message object ready for socket emission.
 *
 * Delegates to insertMessage to avoid duplicating the insert+return pattern.
 * Replaces duplicated raw SQL inserts scattered across socket handlers.
 */
export async function insertSystemMessage(ticketId: string, text: string) {
  return insertMessage({
    ticketId,
    senderId: '__system__',
    senderName: 'System',
    senderRole: 'admin',
    senderLang: 'en',
    text,
    system: true,
  });
}
