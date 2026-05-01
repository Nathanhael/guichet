// server/services/availability/types.ts

/** Closed enum — RFC explicitly defers `busy`/`dnd`/`in_meeting`. */
export type AgentStatus = 'online' | 'away';

export interface SupportEntry {
  userId: string;
  name: string;
  status: AgentStatus;
}

export interface AvailabilitySnapshot {
  status: AgentStatus | null;
  online: boolean;
  offlineSince: Date | null;
}

export interface DailyStats {
  date: string;
  userId: string;
  partnerId: string;
  onlineSeconds: number;
  awaySeconds: number;
}

/** Used by `advanced.onlineUsers` for legacy callers (presence.getOnlineUsersForPartner). */
export interface OnlineUser {
  userId: string;
  name: string;
  role: string;
  status: AgentStatus;
  partnerId: string;
  isPlatformOperator: boolean;
}

export interface AttachInput {
  userId: string;
  partnerId: string;
  socketId: string;
  role: string;
  name: string;
  isPlatformOperator?: boolean;
}

export interface DetachInput {
  userId: string;
  partnerId: string;
  socketId: string;
}

/** Result returned by `socket.detach` so the disconnect handler can decide
 *  whether to fan out role-specific broadcasts (e.g. `agents:online`). */
export interface DetachResult {
  /** True iff the user has zero remaining sockets after this detach. */
  fullyOffline: boolean;
  /** Role read from the live-state hash; empty string if hash was missing. */
  role: string;
  /** Partner read from the live-state hash; empty string if hash was missing. */
  partnerId: string;
  /** Whether the user was a platform operator. */
  isPlatformOperator: boolean;
}
