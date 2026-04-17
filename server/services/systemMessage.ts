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
    // System messages are not attributed to a human — they never bear a
    // GUEST badge regardless of who triggered the underlying action.
    senderIsExternal: false,
    text,
    system: true,
  });
}

/**
 * Inserts a whisper message (visible only to support staff) into a ticket.
 * Used for context handoff during department transfers.
 *
 * `senderIsExternal` defaults to false for backward compatibility — callers
 * that have resolved the real flag (e.g. ticket:transfer via findSenderInfo)
 * should pass it so MessageBubble can render the GUEST marker on the
 * whisper. See docs/superpowers/specs/partner-sso-b2b-guest.md.
 */
export async function insertWhisperMessage(
  ticketId: string,
  senderId: string,
  senderName: string,
  senderRole: string,
  senderLang: string,
  text: string,
  senderIsExternal = false,
) {
  return insertMessage({
    ticketId,
    senderId,
    senderName,
    senderRole,
    senderLang,
    senderIsExternal,
    text,
    whisper: true,
  });
}
