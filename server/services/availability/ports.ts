// server/services/availability/ports.ts
import type { AgentStatus, DailyStats, SupportEntry } from './index.js';

export interface OnlineUserRow {
  userId: string;
  name: string;
  role: string;
  status: string;
  isPlatformOperator: boolean;
}

export interface LiveStatePort {
  /** Add a socket to the user's set; return the current count. Idempotent. */
  attachSocket(partnerId: string, userId: string, socketId: string): Promise<{ socketCount: number }>;

  /** Remove a socket; return the remaining count. Idempotent. */
  detachSocket(partnerId: string, userId: string, socketId: string): Promise<{ socketCount: number }>;

  /** Number of attached sockets for the user. 0 means fully offline. */
  socketCount(partnerId: string, userId: string): Promise<number>;

  /** Current persisted status, or null if user never identified. */
  readStatus(partnerId: string, userId: string): Promise<AgentStatus | null>;

  /** Write status. No-op if user hash does not exist (caller never identified). */
  writeStatus(partnerId: string, userId: string, status: AgentStatus): Promise<void>;

  /** Initialize hash on first attach. Used by attach when no prior status exists. */
  upsertIdentity(input: {
    partnerId: string;
    userId: string;
    name: string;
    role: string;
    isPlatformOperator: boolean;
    initialStatus: AgentStatus;
  }): Promise<void>;

  /** Mark the moment the last socket left. Called only on full-offline transition. */
  markOfflineAt(partnerId: string, userId: string, at: Date): Promise<void>;

  /** Read the offline-at marker. Null when online or never tracked. */
  readOfflineAt(partnerId: string, userId: string): Promise<Date | null>;

  /** Clear marker on reconnect. */
  clearOfflineAt(partnerId: string, userId: string): Promise<void>;

  /** All online users in a partner (driven by the partner-presence set). */
  listOnline(partnerId: string): Promise<OnlineUserRow[]>;

  /** Wipe all presence state. Boot-time only. */
  flushAll(): Promise<void>;
}

export interface TransitionLogPort {
  /** Open a new status row. If a prior row is open, close it first. */
  openRow(input: {
    userId: string;
    partnerId: string;
    status: AgentStatus;
    startedAt: Date;
  }): Promise<void>;

  /** Close any currently-open row for the user (called on disconnect). */
  closeOpenRow(input: { userId: string; partnerId: string; endedAt: Date }): Promise<void>;

  /** Idempotent UPSERT into daily_agent_status. */
  rollupDay(partnerId: string, dateStr: string): Promise<{ rowsWritten: number }>;

  /** Daily stats for one agent over a date range. */
  agentDaily(userId: string, partnerId: string, from: string, to: string): Promise<DailyStats[]>;

  /** Daily stats for all agents in a partner. */
  teamDaily(partnerId: string, from: string, to: string): Promise<DailyStats[]>;
}

export interface BroadcastPort {
  /** Emit `support:online` to the partner room with the current roster. */
  supportOnline(partnerId: string, roster: SupportEntry[]): void;

  /** Emit `agents:online` to the partner staff room with current online agent IDs. */
  agentsOnline(partnerId: string, ids: string[]): void;
}

export interface Clock {
  now(): Date;
}
