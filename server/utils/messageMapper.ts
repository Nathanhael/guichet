import { Message, UserRole } from '../types/index.js';

/** Accepts both camelCase (Drizzle ORM) and snake_case (raw SQL) row formats */
interface MessageRow {
  id: string;
  text?: string | null;
  whisper?: number | null;
  system?: number | null;
  reactions?: unknown;
  // camelCase (Drizzle)
  ticketId?: string;
  senderId?: string;
  senderName?: string | null;
  senderRole?: string | null;
  senderLang?: string | null;
  mediaUrl?: string | null;
  createdAt?: string | null;
  // snake_case (raw SQL)
  ticket_id?: string;
  sender_id?: string;
  sender_name?: string | null;
  sender_role?: string | null;
  sender_lang?: string | null;
  media_url?: string | null;
  created_at?: string | null;
}

export function mapMessageRow(row: MessageRow): Message {
  // Handle both snake_case (raw SQL) and camelCase (Drizzle) row formats
  const originalText = row.text || '';
  const createdAt = row.created_at ?? row.createdAt ?? '';
  const senderRole = (row.sender_role ?? row.senderRole ?? 'system') as UserRole;
  const senderLang = row.sender_lang ?? row.senderLang ?? 'en';

  let reactions = {};
  try {
    const rawReactions = row.reactions || '{}';
    reactions = typeof rawReactions === 'string' ? JSON.parse(rawReactions) : rawReactions;
  } catch (e) {
    reactions = {};
  }

  return {
    id: row.id,
    ticketId: row.ticket_id ?? row.ticketId ?? '',
    senderId: row.sender_id ?? row.senderId ?? '',
    senderName: row.sender_name ?? row.senderName ?? '',
    senderRole,
    senderLang,
    originalText,
    processedText: originalText,
    improvedText: originalText,
    text: originalText, // Alias for backward compatibility
    mediaUrl: row.media_url ?? row.mediaUrl ?? null,
    whisper: row.whisper ? 1 : 0,
    system: row.system ? 1 : 0,
    translationSkipped: 1,
    fallback: 0,
    timestamp: createdAt,
    createdAt: createdAt, // Alias for backward compatibility
    reactions: JSON.stringify(reactions),
  };
}
