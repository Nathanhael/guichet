// server/services/availability/test-stubs.ts
import type {
  AgentStatus,
  DailyStats,
  SupportEntry,
} from './index.js';
import type {
  BroadcastPort,
  Clock,
  LiveStatePort,
  OnlineUserRow,
  TransitionLogPort,
} from './ports.js';

interface UserState {
  name: string;
  role: string;
  isPlatformOperator: boolean;
  status: AgentStatus;
  sockets: Set<string>;
  offlineAt: Date | null;
}

export class MemoryLiveState implements LiveStatePort {
  private readonly users = new Map<string, UserState>();
  private key(partnerId: string, userId: string): string {
    return `${partnerId}:${userId}`;
  }

  async attachSocket(partnerId: string, userId: string, socketId: string): Promise<{ socketCount: number }> {
    const state = this.users.get(this.key(partnerId, userId));
    if (!state) return { socketCount: 0 };
    state.sockets.add(socketId);
    return { socketCount: state.sockets.size };
  }

  async detachSocket(partnerId: string, userId: string, socketId: string): Promise<{ socketCount: number }> {
    const state = this.users.get(this.key(partnerId, userId));
    if (!state) return { socketCount: 0 };
    state.sockets.delete(socketId);
    return { socketCount: state.sockets.size };
  }

  async socketCount(partnerId: string, userId: string): Promise<number> {
    return this.users.get(this.key(partnerId, userId))?.sockets.size ?? 0;
  }

  async readStatus(partnerId: string, userId: string): Promise<AgentStatus | null> {
    return this.users.get(this.key(partnerId, userId))?.status ?? null;
  }

  async writeStatus(partnerId: string, userId: string, status: AgentStatus): Promise<void> {
    const state = this.users.get(this.key(partnerId, userId));
    if (!state) return; // no-op: caller never identified
    state.status = status;
  }

  async upsertIdentity(input: {
    partnerId: string;
    userId: string;
    name: string;
    role: string;
    isPlatformOperator: boolean;
    initialStatus: AgentStatus;
  }): Promise<void> {
    const k = this.key(input.partnerId, input.userId);
    const existing = this.users.get(k);
    if (existing) {
      existing.name = input.name;
      existing.role = input.role;
      existing.isPlatformOperator = input.isPlatformOperator;
      // Preserve existing status on reconnect
      return;
    }
    this.users.set(k, {
      name: input.name,
      role: input.role,
      isPlatformOperator: input.isPlatformOperator,
      status: input.initialStatus,
      sockets: new Set(),
      offlineAt: null,
    });
  }

  async markOfflineAt(partnerId: string, userId: string, at: Date): Promise<void> {
    const state = this.users.get(this.key(partnerId, userId));
    if (state) state.offlineAt = at;
  }

  async readOfflineAt(partnerId: string, userId: string): Promise<Date | null> {
    return this.users.get(this.key(partnerId, userId))?.offlineAt ?? null;
  }

  async clearOfflineAt(partnerId: string, userId: string): Promise<void> {
    const state = this.users.get(this.key(partnerId, userId));
    if (state) state.offlineAt = null;
  }

  async listOnline(partnerId: string): Promise<OnlineUserRow[]> {
    const out: OnlineUserRow[] = [];
    for (const [key, state] of this.users) {
      if (!key.startsWith(`${partnerId}:`)) continue;
      if (state.sockets.size === 0) continue;
      const userId = key.slice(partnerId.length + 1);
      out.push({
        userId,
        name: state.name,
        role: state.role,
        status: state.status,
        isPlatformOperator: state.isPlatformOperator,
      });
    }
    return out;
  }

  async flushAll(): Promise<void> {
    this.users.clear();
  }

  /** Test helper — read raw state. */
  __peek(partnerId: string, userId: string): UserState | undefined {
    return this.users.get(this.key(partnerId, userId));
  }
}

interface LogRow {
  id: string;
  userId: string;
  partnerId: string;
  status: AgentStatus;
  startedAt: Date;
  endedAt: Date | null;
  duration: number | null;
}

export class MemoryTransitionLog implements TransitionLogPort {
  rows: LogRow[] = [];
  private nextId = 1;

  async openRow(input: { userId: string; partnerId: string; status: AgentStatus; startedAt: Date }): Promise<void> {
    // Close any open row first
    await this.closeOpenRow({
      userId: input.userId,
      partnerId: input.partnerId,
      endedAt: input.startedAt,
    });
    this.rows.push({
      id: String(this.nextId++),
      userId: input.userId,
      partnerId: input.partnerId,
      status: input.status,
      startedAt: input.startedAt,
      endedAt: null,
      duration: null,
    });
  }

  async closeOpenRow(input: { userId: string; partnerId: string; endedAt: Date }): Promise<void> {
    const open = this.rows.find(
      (r) => r.userId === input.userId && r.partnerId === input.partnerId && r.endedAt === null,
    );
    if (!open) return;
    open.endedAt = input.endedAt;
    open.duration = Math.round((input.endedAt.getTime() - open.startedAt.getTime()) / 1000);
  }

  async rollupDay(_partnerId: string, _dateStr: string): Promise<{ rowsWritten: number }> {
    return { rowsWritten: 0 };
  }

  async agentDaily(): Promise<DailyStats[]> {
    return [];
  }

  async teamDaily(): Promise<DailyStats[]> {
    return [];
  }
}

interface RecordedBroadcast {
  type: 'supportOnline' | 'agentsOnline';
  partnerId: string;
  payload: SupportEntry[] | string[];
}

export class RecordingBroadcast implements BroadcastPort {
  events: RecordedBroadcast[] = [];

  supportOnline(partnerId: string, roster: SupportEntry[]): void {
    this.events.push({ type: 'supportOnline', partnerId, payload: roster });
  }

  agentsOnline(partnerId: string, ids: string[]): void {
    this.events.push({ type: 'agentsOnline', partnerId, payload: ids });
  }
}

export class FixedClock implements Clock {
  constructor(private current: Date) {}
  now(): Date {
    return this.current;
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}
