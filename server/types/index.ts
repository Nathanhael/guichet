export type UserRole = 'agent' | 'support' | 'admin';

export interface User {
  id: string;
  name: string;
  role: UserRole;
  dept?: string;
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
  ref1?: string | null;
  ref2?: string | null;
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
  summary?: string | null;
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
  text?: string; // legacy
  translatedText?: string; // legacy
  mediaUrl?: string | null;
  whisper: number; // 0 or 1
  system: number; // 0 or 1
  translationSkipped: number; // 0 or 1
  fallback: number; // 0 or 1
  timestamp: string;
  reactions: string; // JSON string
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

export interface TranslationResult {
  text: string;
  fromCache: boolean;
}

export interface ProcessedMessageResult {
  processedText: string;
  improvedText: string;
  translationSkipped: boolean;
  fallback: boolean;
}
