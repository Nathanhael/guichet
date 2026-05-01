// server/services/availability/index.ts
import { runSetStatus, runAttach, runDetach } from './policy.js';
import type {
  BroadcastPort,
  Clock,
  LiveStatePort,
  TransitionLogPort,
} from './ports.js';

export type AgentStatus = 'online' | 'away';

export interface SupportEntry {
  userId: string;
  name: string;
  status: AgentStatus;
}

export interface OnlineUser {
  userId: string;
  name: string;
  role: string;
  status: AgentStatus;
  isPlatformOperator: boolean;
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

export interface AvailabilityDeps {
  live: LiveStatePort;
  log: TransitionLogPort;
  broadcast: BroadcastPort;
  clock: Clock;
  logger?: { warn: (obj: unknown, msg?: string) => void; error: (obj: unknown, msg?: string) => void };
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

export interface DetachResult {
  /** True iff this was the last socket and the user fully went offline. */
  removed: boolean;
  /** The user's role at detach time (null if user was never identified). */
  role: string | null;
}

export class Availability {
  constructor(private readonly deps: AvailabilityDeps) {}

  // ─── Hot path ────────────────────────────────────────────────────────────

  async setStatus(userId: string, partnerId: string, status: AgentStatus): Promise<void> {
    return runSetStatus(this.deps, { userId, partnerId, status });
  }

  async isOnline(userId: string, partnerId: string): Promise<boolean> {
    const count = await this.deps.live.socketCount(partnerId, userId);
    return count > 0;
  }

  async onlineSupport(partnerId: string): Promise<SupportEntry[]> {
    const list = await this.deps.live.listOnline(partnerId);
    return list
      .filter((u) => u.role === 'support' && !u.isPlatformOperator)
      .map((u) => ({ userId: u.userId, name: u.name, status: u.status as AgentStatus }));
  }

  // ─── Socket lifecycle ────────────────────────────────────────────────────

  socket = {
    attach: (input: AttachInput): Promise<void> => runAttach(this.deps, input),
    detach: (input: DetachInput): Promise<DetachResult> => runDetach(this.deps, input),
  };

  // ─── Escape hatches ──────────────────────────────────────────────────────

  advanced = {
    offlineSince: (userId: string, partnerId: string): Promise<Date | null> =>
      this.deps.live.readOfflineAt(partnerId, userId),
    getStatus: (userId: string, partnerId: string): Promise<AgentStatus | null> =>
      this.deps.live.readStatus(partnerId, userId),
    onlineUsers: (partnerId: string): Promise<OnlineUser[]> =>
      this.deps.live.listOnline(partnerId).then((rows) =>
        rows.map((r) => ({ ...r, status: r.status as AgentStatus })),
      ),
    socketCount: (userId: string, partnerId: string): Promise<number> =>
      this.deps.live.socketCount(partnerId, userId),
    rebroadcast: async (partnerId: string): Promise<void> => {
      const roster = await this.onlineSupport(partnerId);
      this.deps.broadcast.supportOnline(partnerId, roster);
    },
  };

  // ─── Reports (PG-only) ───────────────────────────────────────────────────

  reports = {
    agentDaily: (
      userId: string,
      partnerId: string,
      from: string,
      to: string,
    ): Promise<DailyStats[]> =>
      this.deps.log.agentDaily(userId, partnerId, from, to),
    teamDaily: (partnerId: string, from: string, to: string): Promise<DailyStats[]> =>
      this.deps.log.teamDaily(partnerId, from, to),
    rollupDay: (partnerId: string, dateStr: string): Promise<{ rowsWritten: number }> =>
      this.deps.log.rollupDay(partnerId, dateStr),
  };

  // ─── Boot ────────────────────────────────────────────────────────────────

  async flushOnBoot(): Promise<void> {
    return this.deps.live.flushAll();
  }
}

export type {
  BroadcastPort,
  Clock,
  LiveStatePort,
  TransitionLogPort,
} from './ports.js';
