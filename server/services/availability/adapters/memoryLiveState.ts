// server/services/availability/adapters/memoryLiveState.ts
import type { LiveStatePort } from '../ports.js';
import type { AgentStatus, OnlineUser } from '../types.js';

interface UserHash {
  userId: string;
  name: string;
  role: string;
  partnerId: string;
  isPlatformOperator: boolean;
  status: AgentStatus;
  statusChangedAt: string;
}

export class MemoryLiveState implements LiveStatePort {
  private hashes = new Map<string, UserHash>();           // key: `${partnerId}:${userId}`
  private sockets = new Map<string, Set<string>>();       // key: `${partnerId}:${userId}` -> set of socketIds
  private partnerSets = new Map<string, Set<string>>();   // key: partnerId -> set of userIds
  private offlineAt = new Map<string, Date>();            // key: `${partnerId}:${userId}`
  /** Persists status across socket disconnections so reconnect sees prior status. */
  private lastStatus = new Map<string, AgentStatus>();    // key: `${partnerId}:${userId}`

  /** Tunable Redis-failure simulation for atomicity tests. */
  public failNextWrite = false;

  private k(partnerId: string, userId: string) { return `${partnerId}:${userId}`; }

  async attachSocket(partnerId: string, userId: string, socketId: string) {
    const key = this.k(partnerId, userId);
    const set = this.sockets.get(key) ?? new Set();
    set.add(socketId);
    this.sockets.set(key, set);
    return { socketCount: set.size };
  }

  async detachSocket(partnerId: string, userId: string, socketId: string) {
    const key = this.k(partnerId, userId);
    const set = this.sockets.get(key);
    if (!set) return { socketCount: 0 };
    set.delete(socketId);
    if (set.size === 0) {
      this.sockets.delete(key);
      // Preserve the last-known status before dropping the hash so reconnect can restore it.
      const hash = this.hashes.get(key);
      if (hash) this.lastStatus.set(key, hash.status);
      this.hashes.delete(key);
      this.partnerSets.get(partnerId)?.delete(userId);
    }
    return { socketCount: set.size };
  }

  async socketCount(partnerId: string, userId: string) {
    return this.sockets.get(this.k(partnerId, userId))?.size ?? 0;
  }

  async upsertIdentity(input: { partnerId: string; userId: string; role: string; name: string; isPlatformOperator: boolean }) {
    if (this.failNextWrite) { this.failNextWrite = false; throw new Error('memory-live-state: simulated failure'); }
    const key = this.k(input.partnerId, input.userId);
    const existing = this.hashes.get(key);
    if (existing) {
      this.hashes.set(key, { ...existing, name: input.name, role: input.role, partnerId: input.partnerId, isPlatformOperator: input.isPlatformOperator });
    } else {
      // Seed from last-known status on reconnect; default to 'online' for first-ever identify.
      const status = this.lastStatus.get(key) ?? 'online';
      this.hashes.set(key, {
        userId: input.userId,
        name: input.name,
        role: input.role,
        partnerId: input.partnerId,
        isPlatformOperator: input.isPlatformOperator,
        status,
        statusChangedAt: new Date().toISOString(),
      });
    }
    // Add to partner-set — symmetric with detachSocket which removes on SCARD=0.
    // Redis adapter does this inside the Lua of upsertIdentity (SADD sKey userId).
    const partnerSet = this.partnerSets.get(input.partnerId) ?? new Set();
    partnerSet.add(input.userId);
    this.partnerSets.set(input.partnerId, partnerSet);
  }

  async readStatus(partnerId: string, userId: string) {
    return this.hashes.get(this.k(partnerId, userId))?.status ?? null;
  }

  async writeStatus(partnerId: string, userId: string, status: AgentStatus) {
    if (this.failNextWrite) { this.failNextWrite = false; throw new Error('memory-live-state: simulated failure'); }
    const key = this.k(partnerId, userId);
    const existing = this.hashes.get(key);
    if (!existing) return false;
    this.hashes.set(key, { ...existing, status, statusChangedAt: new Date().toISOString() });
    return true;
  }

  async markOfflineAt(partnerId: string, userId: string, at: Date) {
    this.offlineAt.set(this.k(partnerId, userId), at);
  }

  async readOfflineAt(partnerId: string, userId: string) {
    return this.offlineAt.get(this.k(partnerId, userId)) ?? null;
  }

  async clearOfflineAt(partnerId: string, userId: string) {
    this.offlineAt.delete(this.k(partnerId, userId));
  }

  async listOnline(partnerId: string): Promise<OnlineUser[]> {
    const users = this.partnerSets.get(partnerId);
    if (!users) return [];
    const out: OnlineUser[] = [];
    for (const userId of users) {
      const hash = this.hashes.get(this.k(partnerId, userId));
      if (!hash) continue;
      out.push({
        userId: hash.userId,
        name: hash.name,
        role: hash.role,
        status: hash.status,
        partnerId: hash.partnerId,
        isPlatformOperator: hash.isPlatformOperator,
      });
    }
    return out;
  }

  async seedTestHash(input: { partnerId: string; userId: string; status: AgentStatus }) {
    // Mirror the Redis adapter's two-step seed: lastStatus (picked up on next attach)
    // + hash status field (visible to currently-attached sockets if any).
    const key = this.k(input.partnerId, input.userId);
    this.lastStatus.set(key, input.status);
    const existing = this.hashes.get(key);
    if (existing) {
      this.hashes.set(key, { ...existing, status: input.status, statusChangedAt: new Date().toISOString() });
    }
  }

  async flushAll() {
    const deleted = this.hashes.size + this.sockets.size + this.partnerSets.size + this.offlineAt.size;
    this.hashes.clear();
    this.sockets.clear();
    this.partnerSets.clear();
    this.offlineAt.clear();
    this.lastStatus.clear();
    return { deleted };
  }
}
