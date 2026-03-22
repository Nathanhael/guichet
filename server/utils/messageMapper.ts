import { Message } from '../types';

export function mapMessageRow(row: any): Message {
  // Handle both snake_case (raw SQL) and camelCase (Drizzle) row formats
  const originalText = row.text || '';
  const createdAt = row.created_at || row.createdAt;
  const senderRole = row.sender_role || row.senderRole || 'system';
  const senderLang = row.sender_lang || row.senderLang || 'en';

  let reactions = {};
  try {
    const rawReactions = row.reactions || '{}';
    reactions = typeof rawReactions === 'string' ? JSON.parse(rawReactions) : rawReactions;
  } catch (e) {
    reactions = {};
  }

  return {
    id: row.id,
    ticketId: row.ticket_id || row.ticketId,
    senderId: row.sender_id || row.senderId,
    senderName: row.sender_name || row.senderName || '',
    senderRole,
    senderLang,
    originalText,
    processedText: originalText,
    improvedText: originalText,
    text: originalText, // Alias for backward compatibility
    mediaUrl: row.media_url || row.mediaUrl || null,
    whisper: row.whisper ? 1 : 0,
    system: row.system ? 1 : 0,
    translationSkipped: 1,
    fallback: 0,
    timestamp: createdAt,
    createdAt: createdAt, // Alias for backward compatibility
    reactions: typeof reactions === 'string' ? reactions : JSON.stringify(reactions),
  };
}
