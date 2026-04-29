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
  senderIsExternal?: boolean | null;
  mediaUrl?: string | null;
  createdAt?: string | null;
  editedAt?: string | null;
  deletedAt?: string | null;
  // snake_case (raw SQL)
  ticket_id?: string;
  sender_id?: string;
  sender_name?: string | null;
  sender_role?: string | null;
  sender_lang?: string | null;
  sender_is_external?: boolean | null;
  media_url?: string | null;
  created_at?: string | null;
  delivered_at?: string | null;
  read_at?: string | null;
  edited_at?: string | null;
  deleted_at?: string | null;
  reply_to_id?: string | null;
  link_previews?: Array<{ url: string; title?: string; description?: string; image?: string; siteName?: string }> | null;
  attachments?: Array<{ url: string; name: string; mimeType: string; size: number }> | null;
  // camelCase (Drizzle) — delivery status
  deliveredAt?: string | null;
  readAt?: string | null;
  replyToId?: string | null;
  linkPreviews?: Array<{ url: string; title?: string; description?: string; image?: string; siteName?: string }> | null;
}

export function mapMessageRow(row: MessageRow): Message {
  // Handle both snake_case (raw SQL) and camelCase (Drizzle) row formats
  const originalText = row.text || '';
  const createdAt = row.created_at ?? row.createdAt ?? '';
  const senderRole = (row.sender_role ?? row.senderRole ?? 'system') as UserRole;
  const senderLang = row.sender_lang ?? row.senderLang ?? 'en';

  let reactions: Record<string, string[]>;
  try {
    const rawReactions = row.reactions || '{}';
    reactions = typeof rawReactions === 'string' ? JSON.parse(rawReactions) : rawReactions;
  } catch {
    reactions = {};
  }

  return {
    id: row.id,
    ticketId: row.ticket_id ?? row.ticketId ?? '',
    senderId: row.sender_id ?? row.senderId ?? '',
    senderName: row.sender_name ?? row.senderName ?? '',
    senderRole,
    senderLang,
    // Denormalized GUEST flag from migration 0006 — drives chat/Message's
    // amber guest badge without relying on live presence.
    senderIsExternal: Boolean(row.sender_is_external ?? row.senderIsExternal),
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
    deliveredAt: row.delivered_at ?? row.deliveredAt ?? undefined,
    readAt: row.read_at ?? row.readAt ?? undefined,
    editedAt: row.edited_at ?? row.editedAt ?? undefined,
    deletedAt: row.deleted_at ?? row.deletedAt ?? undefined,
    replyToId: row.reply_to_id ?? row.replyToId ?? undefined,
    reactions,
    linkPreviews: row.link_previews ?? row.linkPreviews ?? undefined,
    attachments: row.attachments ?? undefined,
  };
}
