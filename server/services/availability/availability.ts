// server/services/availability/availability.ts
import type { LiveStatePort, TransitionLogPort, BroadcastPort, Clock } from './ports.js';
import type { AgentStatus, AvailabilitySnapshot, DailyStats, OnlineUser, AttachInput, DetachInput, DetachResult, SupportEntry } from './types.js';

interface Deps {
  live: LiveStatePort;
  log: TransitionLogPort;
  broadcast: BroadcastPort;
  clock: Clock;
}

const SUPPORT_ROLES = new Set(['support', 'admin', 'platform_operator']);

function canUseSupportWorkflows(role: string, isPlatformOperator: boolean): boolean {
  if (isPlatformOperator) return true;
  return SUPPORT_ROLES.has(role);
}

export class Availability {
  constructor(private deps: Deps) {}

  // ── Hot path ──────────────────────────────────────────────────────────────

  async setStatus(userId: string, partnerId: string, status: AgentStatus): Promise<void> {
    const at = this.deps.clock.now();

    // Skip never-identified users early (matches presence.setUserStatus's hExists guard).
    const exists = (await this.deps.live.readStatus(partnerId, userId)) !== null;
    if (!exists) return;

    // 1. PG transaction: close prior row + open new row.
    await this.deps.log.closeAndOpen({ userId, partnerId, nextStatus: status, at });

    // 2. Redis write — compensate PG on failure.
    try {
      const written = await this.deps.live.writeStatus(partnerId, userId, status);
      if (!written) {
        // The hash was deleted between the readStatus check and writeStatus
        // (e.g. last socket disconnected). Compensate the PG row so the
        // transition log doesn't show a status that the live state never reflected.
        await this.deps.log.rollbackTransition({ userId, partnerId, at });
        return;
      }
    } catch (err) {
      await this.deps.log.rollbackTransition({ userId, partnerId, at });
      throw err;
    }

    // 3. Broadcast — best-effort; failures don't roll back state.
    await this.broadcastSupportRoster(partnerId);
  }

  async isOnline(userId: string, partnerId: string): Promise<boolean> {
    return (await this.deps.live.socketCount(partnerId, userId)) > 0;
  }

  async onlineSupport(partnerId: string): Promise<SupportEntry[]> {
    const users = await this.deps.live.listOnline(partnerId);
    return users
      .filter(u => u.role === 'support' && !u.isPlatformOperator)
      .map(u => ({ userId: u.userId, name: u.name, status: u.status }));
  }

  // ── Socket lifecycle ──────────────────────────────────────────────────────

  socket = {
    attach: async (p: AttachInput): Promise<void> => {
      await this.deps.live.attachSocket(p.partnerId, p.userId, p.socketId);
      await this.deps.live.upsertIdentity({
        partnerId: p.partnerId,
        userId: p.userId,
        role: p.role,
        name: p.name,
        isPlatformOperator: !!p.isPlatformOperator,
      });
      await this.deps.live.clearOfflineAt(p.partnerId, p.userId);

      if (canUseSupportWorkflows(p.role, !!p.isPlatformOperator)) {
        await this.broadcastSupportRoster(p.partnerId);
      }
      if (p.role === 'agent') {
        await this.broadcastAgentRoster(p.partnerId);
      }
    },

    detach: async (p: DetachInput): Promise<DetachResult> => {
      const before = await this.deps.live.listOnline(p.partnerId);
      const userBefore = before.find(u => u.userId === p.userId);

      const { socketCount } = await this.deps.live.detachSocket(p.partnerId, p.userId, p.socketId);
      const fullyOffline = socketCount === 0;

      const role = userBefore?.role ?? '';
      const isPlatformOperator = userBefore?.isPlatformOperator ?? false;

      if (fullyOffline) {
        await this.deps.live.markOfflineAt(p.partnerId, p.userId, this.deps.clock.now());
        if (canUseSupportWorkflows(role, isPlatformOperator)) {
          await this.broadcastSupportRoster(p.partnerId);
        }
        if (role === 'agent') {
          await this.broadcastAgentRoster(p.partnerId);
        }
      }

      return { fullyOffline, role, partnerId: p.partnerId, isPlatformOperator };
    },
  };

  // ── Escape hatches ────────────────────────────────────────────────────────

  advanced = {
    offlineSince: async (userId: string, partnerId: string): Promise<Date | null> => {
      if (await this.isOnline(userId, partnerId)) return null;
      return this.deps.live.readOfflineAt(partnerId, userId);
    },
    getStatus: (userId: string, partnerId: string): Promise<AgentStatus | null> =>
      this.deps.live.readStatus(partnerId, userId),
    onlineUsers: (partnerId: string): Promise<OnlineUser[]> =>
      this.deps.live.listOnline(partnerId),
    socketCount: (userId: string, partnerId: string): Promise<number> =>
      this.deps.live.socketCount(partnerId, userId),
    rebroadcast: (partnerId: string): Promise<void> =>
      this.broadcastSupportRoster(partnerId),
    snapshot: async (userId: string, partnerId: string): Promise<AvailabilitySnapshot> => {
      const [status, online, offlineSince] = await Promise.all([
        this.deps.live.readStatus(partnerId, userId),
        this.isOnline(userId, partnerId),
        this.deps.live.readOfflineAt(partnerId, userId),
      ]);
      return { status, online, offlineSince };
    },
  };

  // ── Reports (PG-only) ─────────────────────────────────────────────────────

  reports = {
    agentDaily: (userId: string, partnerId: string, fromDate: string, toDate: string): Promise<DailyStats[]> =>
      this.deps.log.agentDaily(userId, partnerId, fromDate, toDate),
    teamDaily: (partnerId: string, fromDate: string, toDate: string): Promise<DailyStats[]> =>
      this.deps.log.teamDaily(partnerId, fromDate, toDate),
    rollupDay: async (partnerId: string, dateStr: string): Promise<void> => {
      await this.deps.log.rollupDay(partnerId, dateStr);
    },
  };

  // ── Boot ──────────────────────────────────────────────────────────────────

  async flushOnBoot(): Promise<void> {
    await this.deps.live.flushAll();
    // Note: PG transition log is NOT flushed — it's the historical record.
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async broadcastSupportRoster(partnerId: string): Promise<void> {
    const roster = await this.onlineSupport(partnerId);
    this.deps.broadcast.supportOnline(partnerId, roster);
  }

  private async broadcastAgentRoster(partnerId: string): Promise<void> {
    const users = await this.deps.live.listOnline(partnerId);
    const ids = users.filter(u => u.role === 'agent').map(u => u.userId);
    this.deps.broadcast.agentsOnline(partnerId, ids);
  }
}
