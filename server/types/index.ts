export type UserRole = 'agent' | 'support' | 'admin' | 'platform_operator';

export interface User {
  id: string;
  name: string;
  role: UserRole;
  lang?: string;
  password?: string;
  avatarUrl?: string | null;
  isPlatformOperator?: boolean;
}

export type TicketStatus = 'open' | 'active' | 'closed';

export interface Ticket {
  id: string;
  dept: string;
  agentId: string;
  agentName: string;
  agentLang: string;
  references?: Array<{ label: string; value: string }>;
  status: TicketStatus;
  supportId?: string | null;
  supportName?: string | null;
  supportLang?: string | null;
  supportJoinedAt?: string | null;
  createdAt: string;
  closedAt?: string | null;
  closingNotes?: string | null;
  closedBy?: string | null;
  participants: string; // JSON string
  slaResponseDueAt?: string | null;
  slaResolutionDueAt?: string | null;
  slaBreached?: boolean;
}

export interface Message {
  id: string;
  ticketId: string;
  senderId: string;
  senderName: string;
  senderRole: UserRole;
  senderLang: string;
  originalText: string;
  improvedText: string;
  processedText: string;
  text?: string; // Alias for backward compatibility
  mediaUrl?: string | null;
  attachments?: Array<{ url: string; name: string; mimeType: string; size: number }> | null;
  whisper: number; // 0 or 1
  system: number; // 0 or 1
  translationSkipped: number; // 0 or 1
  fallback: number; // 0 or 1
  timestamp: string;
  createdAt?: string; // Alias for backward compatibility
  deliveredAt?: string;
  readAt?: string;
  editedAt?: string;
  deletedAt?: string;
  replyToId?: string;
  reactions: Record<string, string[]>;
  linkPreviews?: Array<{ url: string; title?: string; description?: string; image?: string; siteName?: string }> | null;
}

export interface Rating {
  id: string;
  ticketId: string;
  rating: number;
  createdAt?: string;
}

export interface GuardResult {
  ok: boolean;
  code: string;
  sanitized?: string | null;
  text?: string;
}

