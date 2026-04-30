// server/services/availability/ports.ts
import type { AgentStatus, DailyStats, OnlineUser } from './types.js';

export interface LiveStatePort {
  /** Add socketId to the user's per-user socket set. Returns the new SCARD. */
  attachSocket(partnerId: string, userId: string, socketId: string): Promise<{ socketCount: number }>;
  /** Remove socketId from the user's per-user socket set. Returns the new SCARD.
   *  When the SCARD reaches 0 the adapter MUST drop the user hash + per-partner set member. */
  detachSocket(partnerId: string, userId: string, socketId: string): Promise<{ socketCount: number }>;
  socketCount(partnerId: string, userId: string): Promise<number>;
  /** Upsert identity fields. Status is set to 'online' on first seen, preserved on reconnect.
   *  ALSO adds the user to the per-partner online set (`SET_PREFIX` in Redis) — this is the
   *  point at which the user becomes visible to listOnline. Symmetric with detachSocket which
   *  removes them on SCARD=0. */
  upsertIdentity(input: {
    partnerId: string;
    userId: string;
    role: string;
    name: string;
    isPlatformOperator: boolean;
  }): Promise<void>;
  readStatus(partnerId: string, userId: string): Promise<AgentStatus | null>;
  /** Returns false if the user hash does not exist (never-identified guard). */
  writeStatus(partnerId: string, userId: string, status: AgentStatus): Promise<boolean>;
  markOfflineAt(partnerId: string, userId: string, at: Date): Promise<void>;
  readOfflineAt(partnerId: string, userId: string): Promise<Date | null>;
  clearOfflineAt(partnerId: string, userId: string): Promise<void>;
  listOnline(partnerId: string): Promise<OnlineUser[]>;
  flushAll(): Promise<{ deleted: number }>;
}

export interface TransitionLogPort {
  /** Close any open row for (userId, partnerId) with endedAt=now, duration=round((now-startedAt)/1000). */
  closeOpenRow(input: { userId: string; partnerId: string; endedAt: Date }): Promise<void>;
  /** Insert a new open row. */
  openRow(input: { userId: string; partnerId: string; status: AgentStatus; startedAt: Date }): Promise<void>;
  /** Atomically: closeOpenRow + openRow inside a single transaction. */
  closeAndOpen(input: {
    userId: string;
    partnerId: string;
    nextStatus: AgentStatus;
    at: Date;
  }): Promise<void>;
  /** Compensating action: delete the most recent open row for (userId, partnerId)
   *  inserted at `at`, AND reopen any row whose endedAt === `at` (i.e. the prior
   *  row that closeAndOpen just closed). Used by the orchestrator if the Redis
   *  write fails after the PG transaction commits. */
  rollbackTransition(input: { userId: string; partnerId: string; at: Date }): Promise<void>;
  rollupDay(partnerId: string, date: string): Promise<{ rowsWritten: number }>;
  agentDaily(userId: string, partnerId: string, fromDate: string, toDate: string): Promise<DailyStats[]>;
  teamDaily(partnerId: string, fromDate: string, toDate: string): Promise<DailyStats[]>;
}

export interface BroadcastPort {
  /** Emit the support roster to `partner:{partnerId}` room as event `support:online`. */
  supportOnline(partnerId: string, roster: { userId: string; name: string; status: AgentStatus }[]): void;
  /** Emit the agent id list to `partner:{partnerId}:staff` room as event `agents:online`. */
  agentsOnline(partnerId: string, ids: string[]): void;
}

export interface Clock {
  now(): Date;
}
