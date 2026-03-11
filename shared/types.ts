export type UserRole = 'agent' | 'expert' | 'admin';

export interface User {
  id: string;
  name: string;
  role: UserRole;
  dept?: string;
  lang?: string;
}

export type TicketStatus = 'open' | 'active' | 'closed';

export interface Ticket {
  id: string;
  dept: string;
  agentId: string;
  agentName: string;
  agentLang: string;
  status: TicketStatus;
  createdAt: string;
  expertId?: string | null;
  expertName?: string | null;
  expertJoinedAt?: string | null;
  closedAt?: string | null;
  summary?: string | null;
  labels?: string[];
}

export interface TicketUpdate {
  ticketId: string;
  status?: TicketStatus;
  expertId?: string;
  expertName?: string;
  labels?: string[];
  summary?: string;
}

export interface MessagePayload {
  ticketId: string;
  senderId: string;
  text: string;
  mediaUrl?: string;
  whisper?: boolean;
}

export interface AIStatus {
  online: boolean;
  lastCheck: string;
}
