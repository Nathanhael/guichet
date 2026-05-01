# Availability Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify `presence.ts` (Redis live state) + `statusTracking.ts` (PG transition log) behind one `Availability` module with ports & adapters; migrate all callers; delete the old modules.

**Architecture:** Class-based orchestrator (`Availability`) wired through an `AiContext`-style boot accessor (`initAvailability` / `getAvailability` in `services/availability/context.ts`). Three injected ports (`LiveStatePort`, `TransitionLogPort`, `BroadcastPort`) plus a `Clock`. Production adapters extract today's Redis Lua scripts, Drizzle SQL, and Socket.io emits verbatim. Memory adapters back boundary tests with no Redis/PG containers. Each slice is one PR; old modules live in parallel with the new one until slice 9.

**Tech Stack:** TypeScript 5 / Node 20 / Drizzle ORM / `redis` v4 / Socket.io 4 / Vitest / Playwright.

---

## RFC Source

GitHub issue [Nathanhael/guichet#88](https://github.com/Nathanhael/guichet/issues/88). Interface frozen by RFC; this plan only mechanizes it.

## Conventions (every slice)

- Docker only — never run `npm`/`node`/`npx` on the host. Use `docker compose exec server …`.
- After every server file edit: `docker compose restart server` (tsx watch unreliable on Windows bind mount).
- No preview server (port 3001 blocked + X-Frame-Options DENY).
- Verify with `powershell -File scripts/ci.ps1` before declaring a slice done; `-Skip e2e` is acceptable for intra-slice loops, full run before merge.
- Prefer editing existing files over creating new ones (the only new directory is `server/services/availability/`).
- Match the `AiContext` precedent: `initAvailability(deps)` at boot, `getAvailability()` at call sites.

## File Structure (locked at slice 1)

```
server/services/availability/
├── index.ts                           # Barrel — re-exports class, types, init/get
├── context.ts                         # initAvailability / getAvailability (AiContext shape)
├── availability.ts                    # class Availability — orchestrator
├── ports.ts                           # LiveStatePort, TransitionLogPort, BroadcastPort, Clock
├── types.ts                           # AgentStatus, SupportEntry, AvailabilitySnapshot, DailyStats, OnlineUser
├── adapters/
│   ├── redisLiveState.ts              # production LiveStatePort (Lua scripts from presence.ts)
│   ├── drizzleTransitionLog.ts        # production TransitionLogPort (SQL from statusTracking.ts)
│   ├── socketIoBroadcast.ts           # production BroadcastPort (rooms + emits from presence.ts)
│   ├── memoryLiveState.ts             # in-memory test adapter
│   ├── memoryTransitionLog.ts         # in-memory test adapter
│   └── recordingBroadcast.ts          # in-memory test adapter
└── __tests__/
    ├── availability.boundary.test.ts          # class against memory adapters
    ├── redisLiveState.adapter.test.ts         # adapter-level vs real Redis
    └── drizzleTransitionLog.adapter.test.ts   # adapter-level vs real PG
```

The legacy files (`server/services/presence.ts`, `server/services/statusTracking.ts`) remain untouched until slice 9.

## Migration Order (RFC §"How callers should migrate")

| Slice | Scope | Files migrated |
|---|---|---|
| 1 | Foundation | New module + adapters + boundary tests, no caller migrated |
| 2 | Hottest socket path | `server/socket/handlers/presence.ts` (`status:set`, `support:join` ghost-heal, `support:leave`) |
| 3 | Identify path | `server/socket/handlers/auth.ts` |
| 4 | Disconnect path | `server/socket/handlers/disconnect.ts` |
| 5 | Reclaim service | `server/services/ticketReclaim.ts` |
| 6 | tRPC reads/writes | `server/trpc/routers/status.ts`, `server/trpc/routers/presence.ts`, `server/trpc/routers/support.ts` |
| 7 | Dashboard reads | `server/services/dashboard/staffingHeatmapQueries.ts` |
| 8 | Boot wiring | `server/app.ts` boot flush + daily rollup cron |
| 9 | Demolition | Delete `presence.ts`, `statusTracking.ts`, obsolete unit tests; reconcile `testFixtures.ts` |

---

## Atomicity Policy (referenced from slice 1)

When `setStatus(userId, partnerId, status)` is called:

1. **PG transition log** — open transaction. Close any open row for `(userId, partnerId)` with `endedAt = now`, `duration = round((now - startedAt)/1000)`. Insert a new open row with `startedAt = now, status, userId, partnerId`. Commit.
2. **Redis live state** — `HSET` the user hash with `status` and `statusChangedAt = now.toISOString()` IFF `HEXISTS userId` (skip silently for never-identified users).
3. **Broadcast** — emit `support:online` roster to `partner:{id}` room.

If step 2 throws: open a compensating transaction that deletes the new PG row inserted in step 1 and reopens the prior row (sets `endedAt = NULL`, `duration = NULL`). The boundary test `setStatus rolls back PG row when Redis fails` asserts this. If step 3 throws: log and continue; broadcast is best-effort.

`socket.attach` and `socket.detach` follow the same precedence (live-state mutation first since the socket-set membership is the source of truth, then PG row open/close on full-online / full-offline edges, then broadcast).

---

# Slice 1: Foundation — module + adapters + boundary tests, no caller migrated

**PR title:** `feat(availability): module skeleton + production adapters + boundary tests`

**Why first:** Stand up the new system in parallel with the old one. CI must pass with the new module wired into `app.ts` boot but not yet called by any handler. This proves the wiring before any migration risk.

### Task 1.1: Add types

**Files:**
- Create: `server/services/availability/types.ts`

- [ ] **Step 1: Create the types file**

```ts
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
```

- [ ] **Step 2: Commit**

```bash
git add server/services/availability/types.ts
git commit -m "feat(availability): types module — AgentStatus, SupportEntry, DailyStats"
```

### Task 1.2: Add ports

**Files:**
- Create: `server/services/availability/ports.ts`

- [ ] **Step 1: Create the ports file**

```ts
// server/services/availability/ports.ts
import type { AgentStatus, DailyStats, OnlineUser } from './types.js';

export interface LiveStatePort {
  /** Add socketId to the user's per-user socket set. Returns the new SCARD. */
  attachSocket(partnerId: string, userId: string, socketId: string): Promise<{ socketCount: number }>;
  /** Remove socketId from the user's per-user socket set. Returns the new SCARD.
   *  When the SCARD reaches 0 the adapter MUST drop the user hash + per-partner set member. */
  detachSocket(partnerId: string, userId: string, socketId: string): Promise<{ socketCount: number }>;
  socketCount(partnerId: string, userId: string): Promise<number>;
  /** Upsert identity fields. Status is set to 'online' on first seen, preserved on reconnect. */
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
```

- [ ] **Step 2: Commit**

```bash
git add server/services/availability/ports.ts
git commit -m "feat(availability): port interfaces — LiveState / TransitionLog / Broadcast / Clock"
```

### Task 1.3: Memory adapters (test-only)

**Files:**
- Create: `server/services/availability/adapters/memoryLiveState.ts`
- Create: `server/services/availability/adapters/memoryTransitionLog.ts`
- Create: `server/services/availability/adapters/recordingBroadcast.ts`

- [ ] **Step 1: Memory live state**

```ts
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

  /** Tunable Redis-failure simulation for atomicity tests. */
  public failNextWrite = false;

  private k(partnerId: string, userId: string) { return `${partnerId}:${userId}`; }

  async attachSocket(partnerId: string, userId: string, socketId: string) {
    const key = this.k(partnerId, userId);
    const set = this.sockets.get(key) ?? new Set();
    set.add(socketId);
    this.sockets.set(key, set);
    const partnerSet = this.partnerSets.get(partnerId) ?? new Set();
    partnerSet.add(userId);
    this.partnerSets.set(partnerId, partnerSet);
    return { socketCount: set.size };
  }

  async detachSocket(partnerId: string, userId: string, socketId: string) {
    const key = this.k(partnerId, userId);
    const set = this.sockets.get(key);
    if (!set) return { socketCount: 0 };
    set.delete(socketId);
    if (set.size === 0) {
      this.sockets.delete(key);
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
      this.hashes.set(key, {
        userId: input.userId,
        name: input.name,
        role: input.role,
        partnerId: input.partnerId,
        isPlatformOperator: input.isPlatformOperator,
        status: 'online',
        statusChangedAt: new Date().toISOString(),
      });
    }
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

  async flushAll() {
    const deleted = this.hashes.size + this.sockets.size + this.partnerSets.size + this.offlineAt.size;
    this.hashes.clear();
    this.sockets.clear();
    this.partnerSets.clear();
    this.offlineAt.clear();
    return { deleted };
  }
}
```

- [ ] **Step 2: Memory transition log**

```ts
// server/services/availability/adapters/memoryTransitionLog.ts
import type { TransitionLogPort } from '../ports.js';
import type { AgentStatus, DailyStats } from '../types.js';

interface Row {
  id: number;
  userId: string;
  partnerId: string;
  status: AgentStatus;
  startedAt: Date;
  endedAt: Date | null;
  duration: number | null;
}

export class MemoryTransitionLog implements TransitionLogPort {
  public rows: Row[] = [];
  private nextId = 1;
  public failNextWrite = false;

  async closeOpenRow(input: { userId: string; partnerId: string; endedAt: Date }) {
    const open = this.rows.find(r => r.userId === input.userId && r.partnerId === input.partnerId && r.endedAt === null);
    if (!open) return;
    open.endedAt = input.endedAt;
    open.duration = Math.round((input.endedAt.getTime() - open.startedAt.getTime()) / 1000);
  }

  async openRow(input: { userId: string; partnerId: string; status: AgentStatus; startedAt: Date }) {
    if (this.failNextWrite) { this.failNextWrite = false; throw new Error('memory-transition-log: simulated failure'); }
    this.rows.push({
      id: this.nextId++,
      userId: input.userId,
      partnerId: input.partnerId,
      status: input.status,
      startedAt: input.startedAt,
      endedAt: null,
      duration: null,
    });
  }

  async closeAndOpen(input: { userId: string; partnerId: string; nextStatus: AgentStatus; at: Date }) {
    await this.closeOpenRow({ userId: input.userId, partnerId: input.partnerId, endedAt: input.at });
    await this.openRow({ userId: input.userId, partnerId: input.partnerId, status: input.nextStatus, startedAt: input.at });
  }

  async rollbackTransition(input: { userId: string; partnerId: string; at: Date }) {
    // Drop the row we just opened (startedAt === at, endedAt === null).
    const newIdx = this.rows.findIndex(r =>
      r.userId === input.userId
      && r.partnerId === input.partnerId
      && r.startedAt.getTime() === input.at.getTime()
      && r.endedAt === null);
    if (newIdx >= 0) this.rows.splice(newIdx, 1);
    // Reopen the prior row that closeAndOpen closed (endedAt === at).
    const prior = this.rows.find(r =>
      r.userId === input.userId
      && r.partnerId === input.partnerId
      && r.endedAt?.getTime() === input.at.getTime());
    if (prior) {
      prior.endedAt = null;
      prior.duration = null;
    }
  }

  async rollupDay(partnerId: string, date: string) {
    // Stub: returns 0 rows. Adapter-level test exercises the real rollup.
    return { rowsWritten: 0 };
  }

  async agentDaily(userId: string, partnerId: string, _fromDate: string, _toDate: string): Promise<DailyStats[]> {
    return [];
  }

  async teamDaily(partnerId: string, _fromDate: string, _toDate: string): Promise<DailyStats[]> {
    return [];
  }
}
```

- [ ] **Step 3: Recording broadcast**

```ts
// server/services/availability/adapters/recordingBroadcast.ts
import type { BroadcastPort } from '../ports.js';
import type { AgentStatus } from '../types.js';

type Event =
  | { kind: 'support:online'; partnerId: string; roster: { userId: string; name: string; status: AgentStatus }[] }
  | { kind: 'agents:online'; partnerId: string; ids: string[] };

export class RecordingBroadcast implements BroadcastPort {
  public events: Event[] = [];

  supportOnline(partnerId: string, roster: { userId: string; name: string; status: AgentStatus }[]) {
    this.events.push({ kind: 'support:online', partnerId, roster });
  }

  agentsOnline(partnerId: string, ids: string[]) {
    this.events.push({ kind: 'agents:online', partnerId, ids });
  }

  reset() { this.events = []; }
}
```

- [ ] **Step 4: Commit**

```bash
git add server/services/availability/adapters/memoryLiveState.ts \
        server/services/availability/adapters/memoryTransitionLog.ts \
        server/services/availability/adapters/recordingBroadcast.ts
git commit -m "feat(availability): in-memory test adapters for all three ports"
```

### Task 1.4: Boundary tests against memory adapters (TDD)

**Files:**
- Create: `server/services/availability/__tests__/availability.boundary.test.ts`

- [ ] **Step 1: Write failing boundary tests**

```ts
// server/services/availability/__tests__/availability.boundary.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Availability } from '../availability.js';
import { MemoryLiveState } from '../adapters/memoryLiveState.js';
import { MemoryTransitionLog } from '../adapters/memoryTransitionLog.js';
import { RecordingBroadcast } from '../adapters/recordingBroadcast.js';

describe('Availability — boundary contract', () => {
  let live: MemoryLiveState;
  let log: MemoryTransitionLog;
  let bc: RecordingBroadcast;
  let now: Date;
  let av: Availability;

  beforeEach(() => {
    live = new MemoryLiveState();
    log = new MemoryTransitionLog();
    bc = new RecordingBroadcast();
    now = new Date('2026-04-29T12:00:00.000Z');
    av = new Availability({ live, log, broadcast: bc, clock: { now: () => now } });
  });

  async function attachAsSupport(userId: string, partnerId: string, socketId = 's-1') {
    await av.socket.attach({ userId, partnerId, socketId, role: 'support', name: 'Test User' });
  }

  it('setStatus writes Redis hash, opens new PG row, broadcasts roster', async () => {
    await attachAsSupport('u1', 'p1');
    bc.reset();
    await av.setStatus('u1', 'p1', 'away');
    expect(await live.readStatus('p1', 'u1')).toBe('away');
    const open = log.rows.find(r => r.userId === 'u1' && r.endedAt === null);
    expect(open?.status).toBe('away');
    const ev = bc.events.at(-1);
    expect(ev?.kind).toBe('support:online');
  });

  it('setStatus rolls back PG row when Redis fails', async () => {
    await attachAsSupport('u1', 'p1');
    const rowsBefore = JSON.parse(JSON.stringify(log.rows));
    live.failNextWrite = true;
    await expect(av.setStatus('u1', 'p1', 'away')).rejects.toThrow();
    expect(log.rows).toEqual(rowsBefore); // PG state unchanged
    expect(await live.readStatus('p1', 'u1')).toBe('online'); // Redis unchanged
  });

  it('socket.attach preserves status on reconnect (away -> reconnect -> still away)', async () => {
    await attachAsSupport('u1', 'p1', 's-1');
    await av.setStatus('u1', 'p1', 'away');
    await av.socket.detach({ userId: 'u1', partnerId: 'p1', socketId: 's-1' });
    await attachAsSupport('u1', 'p1', 's-2'); // reconnect
    expect(await live.readStatus('p1', 'u1')).toBe('away');
  });

  it('socket.detach only marks offline when last socket leaves', async () => {
    await attachAsSupport('u1', 'p1', 's-1');
    await attachAsSupport('u1', 'p1', 's-2');
    expect(await av.advanced.offlineSince('u1', 'p1')).toBeNull();
    await av.socket.detach({ userId: 'u1', partnerId: 'p1', socketId: 's-1' });
    expect(await av.advanced.offlineSince('u1', 'p1')).toBeNull();
    await av.socket.detach({ userId: 'u1', partnerId: 'p1', socketId: 's-2' });
    expect(await av.advanced.offlineSince('u1', 'p1')).toEqual(now);
  });

  it('socket.detach writes offlineSince only on full-offline transition', async () => {
    await attachAsSupport('u1', 'p1', 's-1');
    await attachAsSupport('u1', 'p1', 's-2');
    await av.socket.detach({ userId: 'u1', partnerId: 'p1', socketId: 's-1' });
    expect(await live.readOfflineAt('p1', 'u1')).toBeNull();
    await av.socket.detach({ userId: 'u1', partnerId: 'p1', socketId: 's-2' });
    expect(await live.readOfflineAt('p1', 'u1')).toEqual(now);
  });

  it('isOnline reflects multi-socket SCARD>0 invariant', async () => {
    expect(await av.isOnline('u1', 'p1')).toBe(false);
    await attachAsSupport('u1', 'p1', 's-1');
    expect(await av.isOnline('u1', 'p1')).toBe(true);
    await attachAsSupport('u1', 'p1', 's-2');
    await av.socket.detach({ userId: 'u1', partnerId: 'p1', socketId: 's-1' });
    expect(await av.isOnline('u1', 'p1')).toBe(true);
    await av.socket.detach({ userId: 'u1', partnerId: 'p1', socketId: 's-2' });
    expect(await av.isOnline('u1', 'p1')).toBe(false);
  });

  it('flushOnBoot clears live state without touching transition log', async () => {
    await attachAsSupport('u1', 'p1');
    await av.setStatus('u1', 'p1', 'away');
    const rowsBefore = log.rows.length;
    await av.flushOnBoot();
    expect(await live.readStatus('p1', 'u1')).toBeNull();
    expect(log.rows.length).toBe(rowsBefore);
  });

  it('setStatus is a no-op when user has no live-state hash (never identified)', async () => {
    await av.setStatus('ghost', 'p1', 'away');
    expect(log.rows.length).toBe(0);
    expect(bc.events.length).toBe(0);
  });

  it('advanced.offlineSince returns null while online; offlineAt when fully offline', async () => {
    await attachAsSupport('u1', 'p1', 's-1');
    expect(await av.advanced.offlineSince('u1', 'p1')).toBeNull();
    await av.socket.detach({ userId: 'u1', partnerId: 'p1', socketId: 's-1' });
    expect(await av.advanced.offlineSince('u1', 'p1')).toEqual(now);
  });

  it('onlineSupport excludes platform operators', async () => {
    await av.socket.attach({ userId: 'op', partnerId: 'p1', socketId: 's-1', role: 'support', name: 'Op', isPlatformOperator: true });
    await av.socket.attach({ userId: 'u1', partnerId: 'p1', socketId: 's-2', role: 'support', name: 'Real' });
    const roster = await av.onlineSupport('p1');
    expect(roster.map(r => r.userId)).toEqual(['u1']);
  });

  it('socket.attach broadcasts support:online when role can use support workflows', async () => {
    bc.reset();
    await attachAsSupport('u1', 'p1');
    expect(bc.events.some(e => e.kind === 'support:online')).toBe(true);
  });

  it('socket.attach broadcasts agents:online when role is agent', async () => {
    bc.reset();
    await av.socket.attach({ userId: 'a1', partnerId: 'p1', socketId: 's-1', role: 'agent', name: 'Agent' });
    expect(bc.events.some(e => e.kind === 'agents:online')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails because `Availability` is not yet implemented**

```bash
docker compose exec server npx vitest run server/services/availability/__tests__/availability.boundary.test.ts
```

Expected: all tests fail with import error `Cannot find module '../availability.js'`.

- [ ] **Step 3: Commit the failing test**

```bash
git add server/services/availability/__tests__/availability.boundary.test.ts
git commit -m "test(availability): boundary contract — atomicity, multi-socket, status-on-reconnect"
```

### Task 1.5: Implement the Availability orchestrator

**Files:**
- Create: `server/services/availability/availability.ts`

- [ ] **Step 1: Write the orchestrator**

```ts
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
```

- [ ] **Step 2: Run boundary tests, verify pass**

```bash
docker compose exec server npx vitest run server/services/availability/__tests__/availability.boundary.test.ts
```

Expected: all 12 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add server/services/availability/availability.ts
git commit -m "feat(availability): orchestrator class — hot path + socket lifecycle + advanced + reports"
```

### Task 1.6: Production adapter — RedisLiveState

**Files:**
- Create: `server/services/availability/adapters/redisLiveState.ts`

- [ ] **Step 1: Implement RedisLiveState**

The Lua scripts and key layout are extracted verbatim from `server/services/presence.ts`. Specifically:
- Key constants `HASH_PREFIX`, `SET_PREFIX`, `SOCKETS_SUFFIX`, `OFFLINE_AT_PREFIX`, `TTL_SECONDS` — copy from `presence.ts:24-28`.
- Helper functions `hashKey`, `socketsKey`, `setKey`, `offlineAtKey` — copy from `presence.ts:30-44`.
- `attachSocket` / `upsertIdentity` Lua — copy from `presence.ts:177-218` (the `identifyUser` body), split into the two methods. `attachSocket` only does `SADD sockKey + EXPIRE`; `upsertIdentity` does the `HSET key + SADD sKey + EXPIRE`.
- `detachSocket` Lua — copy from `presence.ts:296-322` (the `decrementUserCount` body).
- `writeStatus` — copy from `presence.ts:255-264` (`hExists` guard + `hSet`).
- `readStatus` — copy from `presence.ts:271-282` (`hGet status`).
- `listOnline` — copy from `presence.ts:351-385` (`getOnlineUsersForPartner`), drop the `count` field (not in `OnlineUser` shape — RFC swapped `count` for the SCARD-derived `online` boolean), and filter `data.userId` for non-empty rows.
- `markOfflineAt` / `readOfflineAt` / `clearOfflineAt` — copy from `presence.ts:51-85` (`setOfflineAt`, `getOfflineAt`, `clearOfflineAt`).
- `flushAll` — copy from `presence.ts:396-429` (`flushPresenceOnStartup`).
- `socketCount` — new: `pubClient.sCard(socketsKey(partnerId, userId))`.

```ts
// server/services/availability/adapters/redisLiveState.ts
import type { RedisClientType } from 'redis';
import type { LiveStatePort } from '../ports.js';
import type { AgentStatus, OnlineUser } from '../types.js';

const HASH_PREFIX = 'presence:';
const SET_PREFIX = 'partner:presence:';
const SOCKETS_SUFFIX = ':sockets';
const OFFLINE_AT_PREFIX = 'presence:offline_at:';
const TTL_SECONDS = 86400;

function hashKey(partnerId: string, userId: string) { return `${HASH_PREFIX}${partnerId}:${userId}`; }
function socketsKey(partnerId: string, userId: string) { return `${HASH_PREFIX}${partnerId}:${userId}${SOCKETS_SUFFIX}`; }
function setKey(partnerId: string) { return `${SET_PREFIX}${partnerId}`; }
function offlineAtKey(partnerId: string, userId: string) { return `${OFFLINE_AT_PREFIX}${partnerId}:${userId}`; }

interface Deps {
  redis: RedisClientType | null;
  logger: { error: (obj: unknown, msg?: string) => void; debug: (obj: unknown, msg?: string) => void };
}

export class RedisLiveState implements LiveStatePort {
  constructor(private deps: Deps) {}

  private get r() { return this.deps.redis; }

  async attachSocket(partnerId: string, userId: string, socketId: string) {
    if (!this.r) return { socketCount: 0 };
    try {
      await this.r.sAdd(socketsKey(partnerId, userId), socketId);
      await this.r.expire(socketsKey(partnerId, userId), TTL_SECONDS);
      const socketCount = await this.r.sCard(socketsKey(partnerId, userId));
      return { socketCount };
    } catch (err) {
      this.deps.logger.error({ err, userId }, 'RedisLiveState.attachSocket failed');
      throw err;
    }
  }

  async detachSocket(partnerId: string, userId: string, socketId: string) {
    if (!this.r) return { socketCount: 0 };
    const lua = `
      local key = KEYS[1]
      local sKey = KEYS[2]
      local sockKey = KEYS[3]
      local userId = ARGV[1]
      local socketId = ARGV[2]
      if redis.call('EXISTS', key) == 0 then return 0 end
      if socketId and socketId ~= '' then redis.call('SREM', sockKey, socketId) end
      local remaining = redis.call('SCARD', sockKey)
      if remaining <= 0 then
        redis.call('DEL', key, sockKey)
        redis.call('SREM', sKey, userId)
        return 0
      end
      return remaining
    `;
    try {
      const remaining = await this.r.eval(lua, {
        keys: [hashKey(partnerId, userId), setKey(partnerId), socketsKey(partnerId, userId)],
        arguments: [userId, socketId],
      }) as number;
      return { socketCount: Number(remaining) || 0 };
    } catch (err) {
      this.deps.logger.error({ err, userId }, 'RedisLiveState.detachSocket failed');
      throw err;
    }
  }

  async socketCount(partnerId: string, userId: string) {
    if (!this.r) return 0;
    return this.r.sCard(socketsKey(partnerId, userId));
  }

  async upsertIdentity(input: { partnerId: string; userId: string; role: string; name: string; isPlatformOperator: boolean }) {
    if (!this.r) return;
    const lua = `
      local key = KEYS[1]
      local sKey = KEYS[2]
      local userId = ARGV[1]
      local name = ARGV[2]
      local role = ARGV[3]
      local partnerId = ARGV[4]
      local isPlatformOp = ARGV[5]
      local ttl = tonumber(ARGV[6])
      local statusChangedAt = ARGV[7]
      local exists = redis.call('EXISTS', key)
      if exists == 0 then
        redis.call('HSET', key,
          'userId', userId, 'name', name, 'role', role, 'partnerId', partnerId,
          'isPlatformOperator', isPlatformOp, 'status', 'online', 'statusChangedAt', statusChangedAt)
      else
        redis.call('HSET', key,
          'userId', userId, 'name', name, 'role', role, 'partnerId', partnerId,
          'isPlatformOperator', isPlatformOp)
      end
      redis.call('EXPIRE', key, ttl)
      redis.call('SADD', sKey, userId)
      redis.call('EXPIRE', sKey, ttl)
      return exists
    `;
    try {
      await this.r.eval(lua, {
        keys: [hashKey(input.partnerId, input.userId), setKey(input.partnerId)],
        arguments: [
          input.userId, input.name, input.role, input.partnerId,
          input.isPlatformOperator ? '1' : '0', String(TTL_SECONDS), new Date().toISOString(),
        ],
      });
    } catch (err) {
      this.deps.logger.error({ err, userId: input.userId }, 'RedisLiveState.upsertIdentity failed');
      throw err;
    }
  }

  async readStatus(partnerId: string, userId: string): Promise<AgentStatus | null> {
    if (!this.r) return null;
    const v = await this.r.hGet(hashKey(partnerId, userId), 'status');
    if (v === 'online' || v === 'away') return v;
    return null;
  }

  async writeStatus(partnerId: string, userId: string, status: AgentStatus): Promise<boolean> {
    if (!this.r) return false;
    const exists = await this.r.hExists(hashKey(partnerId, userId), 'userId');
    if (!exists) return false;
    await this.r.hSet(hashKey(partnerId, userId), {
      status,
      statusChangedAt: new Date().toISOString(),
    });
    return true;
  }

  async markOfflineAt(partnerId: string, userId: string, at: Date) {
    if (!this.r) return;
    await this.r.set(offlineAtKey(partnerId, userId), at.toISOString(), { EX: TTL_SECONDS });
  }

  async readOfflineAt(partnerId: string, userId: string): Promise<Date | null> {
    if (!this.r) return null;
    const v = await this.r.get(offlineAtKey(partnerId, userId));
    if (!v) return null;
    const d = new Date(v);
    return Number.isFinite(d.getTime()) ? d : null;
  }

  async clearOfflineAt(partnerId: string, userId: string) {
    if (!this.r) return;
    await this.r.del(offlineAtKey(partnerId, userId));
  }

  async listOnline(partnerId: string): Promise<OnlineUser[]> {
    if (!this.r) return [];
    const memberIds = await this.r.sMembers(setKey(partnerId));
    if (memberIds.length === 0) return [];
    const pipeline = this.r.multi();
    for (const uid of memberIds) pipeline.hGetAll(hashKey(partnerId, uid));
    const results = await pipeline.exec();
    const out: OnlineUser[] = [];
    for (const result of results) {
      const data = result as unknown as Record<string, string>;
      if (data && data.userId) {
        const status = data.status === 'away' ? 'away' : 'online';
        out.push({
          userId: data.userId,
          name: data.name,
          role: data.role,
          status,
          partnerId: data.partnerId,
          isPlatformOperator: data.isPlatformOperator === '1',
        });
      }
    }
    return out;
  }

  async flushAll() {
    if (!this.r) return { deleted: 0 };
    let deleted = 0;
    let cursor: string | number = 0;
    do {
      const result = await this.r.scan(String(cursor), { MATCH: `${HASH_PREFIX}*`, COUNT: 200 });
      cursor = result.cursor;
      if (result.keys.length > 0) { await this.r.del(result.keys); deleted += result.keys.length; }
    } while (Number(cursor) !== 0);
    cursor = 0;
    do {
      const result = await this.r.scan(String(cursor), { MATCH: `${SET_PREFIX}*`, COUNT: 200 });
      cursor = result.cursor;
      if (result.keys.length > 0) { await this.r.del(result.keys); deleted += result.keys.length; }
    } while (Number(cursor) !== 0);
    return { deleted };
  }
}
```

- [ ] **Step 2: Restart server, run typecheck**

```bash
docker compose restart server
docker compose exec server npx tsc --noEmit
```

Expected: typecheck passes.

- [ ] **Step 3: Commit**

```bash
git add server/services/availability/adapters/redisLiveState.ts
git commit -m "feat(availability): RedisLiveState adapter — Lua scripts + key layout from presence.ts"
```

### Task 1.7: Production adapter — DrizzleTransitionLog

**Files:**
- Create: `server/services/availability/adapters/drizzleTransitionLog.ts`

- [ ] **Step 1: Implement**

Extracts SQL from `server/services/statusTracking.ts:9-184`. The new method `closeAndOpen` wraps `closeOpenRow + openRow` in a single Drizzle transaction (`db.transaction(...)`). The new `rollbackTransition` is a compensating transaction.

```ts
// server/services/availability/adapters/drizzleTransitionLog.ts
import { eq, and, isNull, sql, gte, lte, desc } from 'drizzle-orm';
import type { TransitionLogPort } from '../ports.js';
import type { AgentStatus, DailyStats } from '../types.js';

interface Deps {
  db: typeof import('../../../db/postgres.js').db;
  schema: {
    agentStatusLog: typeof import('../../../db/schema.js').agentStatusLog;
    dailyAgentStatus: typeof import('../../../db/schema.js').dailyAgentStatus;
  };
  logger: { error: (obj: unknown, msg?: string) => void; info: (obj: unknown, msg?: string) => void };
}

export class DrizzleTransitionLog implements TransitionLogPort {
  constructor(private deps: Deps) {}

  async closeOpenRow(input: { userId: string; partnerId: string; endedAt: Date }) {
    const { db, schema } = this.deps;
    const open = await db
      .select()
      .from(schema.agentStatusLog)
      .where(and(
        eq(schema.agentStatusLog.userId, input.userId),
        eq(schema.agentStatusLog.partnerId, input.partnerId),
        isNull(schema.agentStatusLog.endedAt),
      ))
      .limit(1);
    if (open.length === 0) return;
    const row = open[0];
    const startedAt = new Date(row.startedAt);
    const duration = Math.round((input.endedAt.getTime() - startedAt.getTime()) / 1000);
    await db
      .update(schema.agentStatusLog)
      .set({ endedAt: input.endedAt.toISOString(), duration })
      .where(eq(schema.agentStatusLog.id, row.id));
  }

  async openRow(input: { userId: string; partnerId: string; status: AgentStatus; startedAt: Date }) {
    const { db, schema } = this.deps;
    await db.insert(schema.agentStatusLog).values({
      userId: input.userId,
      partnerId: input.partnerId,
      status: input.status,
      startedAt: input.startedAt.toISOString(),
    });
  }

  async closeAndOpen(input: { userId: string; partnerId: string; nextStatus: AgentStatus; at: Date }) {
    const { db, schema } = this.deps;
    await db.transaction(async tx => {
      const open = await tx
        .select()
        .from(schema.agentStatusLog)
        .where(and(
          eq(schema.agentStatusLog.userId, input.userId),
          eq(schema.agentStatusLog.partnerId, input.partnerId),
          isNull(schema.agentStatusLog.endedAt),
        ))
        .limit(1);
      if (open.length > 0) {
        const row = open[0];
        const startedAt = new Date(row.startedAt);
        const duration = Math.round((input.at.getTime() - startedAt.getTime()) / 1000);
        await tx.update(schema.agentStatusLog)
          .set({ endedAt: input.at.toISOString(), duration })
          .where(eq(schema.agentStatusLog.id, row.id));
      }
      await tx.insert(schema.agentStatusLog).values({
        userId: input.userId,
        partnerId: input.partnerId,
        status: input.nextStatus,
        startedAt: input.at.toISOString(),
      });
    });
  }

  async rollbackTransition(input: { userId: string; partnerId: string; at: Date }) {
    const { db, schema } = this.deps;
    const atIso = input.at.toISOString();
    await db.transaction(async tx => {
      // Drop the open row inserted at `at`.
      await tx.delete(schema.agentStatusLog).where(and(
        eq(schema.agentStatusLog.userId, input.userId),
        eq(schema.agentStatusLog.partnerId, input.partnerId),
        eq(schema.agentStatusLog.startedAt, atIso),
        isNull(schema.agentStatusLog.endedAt),
      ));
      // Reopen the prior row whose endedAt === at.
      await tx.update(schema.agentStatusLog)
        .set({ endedAt: null, duration: null })
        .where(and(
          eq(schema.agentStatusLog.userId, input.userId),
          eq(schema.agentStatusLog.partnerId, input.partnerId),
          eq(schema.agentStatusLog.endedAt, atIso),
        ));
    });
  }

  async rollupDay(partnerId: string, dateStr: string) {
    // Body extracted verbatim from server/services/statusTracking.ts:126-184 — no changes.
    const { db, schema, logger } = this.deps;
    const dayStart = `${dateStr}T00:00:00.000Z`;
    const dayEnd = `${dateStr}T23:59:59.999Z`;

    const rows = await db.select().from(schema.agentStatusLog).where(and(
      eq(schema.agentStatusLog.partnerId, partnerId),
      lte(schema.agentStatusLog.startedAt, dayEnd),
      gte(sql`COALESCE(${schema.agentStatusLog.endedAt}, NOW()::text)`, dayStart),
    ));

    const userTotals = new Map<string, Record<string, number>>();
    for (const row of rows) {
      const start = new Date(Math.max(new Date(row.startedAt).getTime(), new Date(dayStart).getTime()));
      const end = row.endedAt
        ? new Date(Math.min(new Date(row.endedAt).getTime(), new Date(dayEnd).getTime()))
        : new Date(Math.min(Date.now(), new Date(dayEnd).getTime()));
      const seconds = Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
      if (!userTotals.has(row.userId)) userTotals.set(row.userId, { online: 0, away: 0 });
      const t = userTotals.get(row.userId)!;
      if (t[row.status] !== undefined) t[row.status] += seconds;
    }

    let rowsWritten = 0;
    for (const [userId, totals] of userTotals) {
      await db.insert(schema.dailyAgentStatus).values({
        date: dateStr, userId, partnerId,
        onlineSeconds: totals.online, awaySeconds: totals.away,
      }).onConflictDoUpdate({
        target: [schema.dailyAgentStatus.date, schema.dailyAgentStatus.userId, schema.dailyAgentStatus.partnerId],
        set: { onlineSeconds: sql`EXCLUDED.online_seconds`, awaySeconds: sql`EXCLUDED.away_seconds` },
      });
      rowsWritten++;
    }
    logger.info({ partnerId, dateStr, rowsWritten }, '[availability] rollupDay complete');
    return { rowsWritten };
  }

  async agentDaily(userId: string, partnerId: string, fromDate: string, toDate: string): Promise<DailyStats[]> {
    const { db, schema } = this.deps;
    const rows = await db.select().from(schema.dailyAgentStatus).where(and(
      eq(schema.dailyAgentStatus.userId, userId),
      eq(schema.dailyAgentStatus.partnerId, partnerId),
      gte(schema.dailyAgentStatus.date, fromDate),
      lte(schema.dailyAgentStatus.date, toDate),
    )).orderBy(schema.dailyAgentStatus.date);
    return rows.map(r => ({
      date: r.date, userId: r.userId, partnerId: r.partnerId,
      onlineSeconds: r.onlineSeconds, awaySeconds: r.awaySeconds,
    }));
  }

  async teamDaily(partnerId: string, fromDate: string, toDate: string): Promise<DailyStats[]> {
    const { db, schema } = this.deps;
    const rows = await db.select().from(schema.dailyAgentStatus).where(and(
      eq(schema.dailyAgentStatus.partnerId, partnerId),
      gte(schema.dailyAgentStatus.date, fromDate),
      lte(schema.dailyAgentStatus.date, toDate),
    )).orderBy(schema.dailyAgentStatus.date);
    return rows.map(r => ({
      date: r.date, userId: r.userId, partnerId: r.partnerId,
      onlineSeconds: r.onlineSeconds, awaySeconds: r.awaySeconds,
    }));
  }
}
```

- [ ] **Step 2: Restart, typecheck**

```bash
docker compose restart server
docker compose exec server npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add server/services/availability/adapters/drizzleTransitionLog.ts
git commit -m "feat(availability): DrizzleTransitionLog adapter — closeAndOpen txn + rollupDay SQL"
```

### Task 1.8: Production adapter — SocketIoBroadcast

**Files:**
- Create: `server/services/availability/adapters/socketIoBroadcast.ts`

- [ ] **Step 1: Implement**

```ts
// server/services/availability/adapters/socketIoBroadcast.ts
import type { Server } from 'socket.io';
import type { BroadcastPort } from '../ports.js';
import type { AgentStatus } from '../types.js';

interface Deps {
  io: Server;
  logger: { debug: (obj: unknown, msg?: string) => void };
}

export class SocketIoBroadcast implements BroadcastPort {
  constructor(private deps: Deps) {}

  supportOnline(partnerId: string, roster: { userId: string; name: string; status: AgentStatus }[]) {
    this.deps.io.to(`partner:${partnerId}`).emit('support:online', roster);
    this.deps.logger.debug({ partnerId, count: roster.length }, '[availability] supportOnline broadcast');
  }

  agentsOnline(partnerId: string, ids: string[]) {
    this.deps.io.to(`partner:${partnerId}:staff`).emit('agents:online', ids);
    this.deps.logger.debug({ partnerId, count: ids.length }, '[availability] agentsOnline broadcast');
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add server/services/availability/adapters/socketIoBroadcast.ts
git commit -m "feat(availability): SocketIoBroadcast adapter — partner room emits"
```

### Task 1.9: Context module + barrel exports

**Files:**
- Create: `server/services/availability/context.ts`
- Create: `server/services/availability/index.ts`

- [ ] **Step 1: Context module**

```ts
// server/services/availability/context.ts
import type { Availability } from './availability.js';

let instance: Availability | null = null;

/** Initialize the singleton. Called once from app.ts after DB, Redis, and Socket.io are ready. */
export function initAvailability(av: Availability): void {
  instance = av;
}

/** Get the singleton. Throws if not initialized. */
export function getAvailability(): Availability {
  if (!instance) throw new Error('Availability not initialized. Call initAvailability() first.');
  return instance;
}

/** Test-only: reset for unit tests that mount their own instance. */
export function __resetAvailabilityForTests(): void {
  instance = null;
}
```

- [ ] **Step 2: Barrel index**

```ts
// server/services/availability/index.ts
export { Availability } from './availability.js';
export { initAvailability, getAvailability, __resetAvailabilityForTests } from './context.js';
export type {
  AgentStatus,
  SupportEntry,
  AvailabilitySnapshot,
  DailyStats,
  OnlineUser,
  AttachInput,
  DetachInput,
  DetachResult,
} from './types.js';
export type { LiveStatePort, TransitionLogPort, BroadcastPort, Clock } from './ports.js';
export { RedisLiveState } from './adapters/redisLiveState.js';
export { DrizzleTransitionLog } from './adapters/drizzleTransitionLog.js';
export { SocketIoBroadcast } from './adapters/socketIoBroadcast.js';
```

- [ ] **Step 3: Commit**

```bash
git add server/services/availability/context.ts server/services/availability/index.ts
git commit -m "feat(availability): context accessor + barrel exports (AiContext shape)"
```

### Task 1.10: Wire into app.ts boot — parallel with legacy

**Files:**
- Modify: `server/app.ts`

The new module is constructed AFTER Redis init and AFTER `setPresenceIo(io)` (legacy stays). No legacy call site is removed.

- [ ] **Step 1: Add import**

In `server/app.ts` near the AI imports (around line 27-40), add:

```ts
import {
  Availability,
  RedisLiveState,
  DrizzleTransitionLog,
  SocketIoBroadcast,
  initAvailability,
} from './services/availability/index.js';
```

- [ ] **Step 2: Initialize after `setPresenceIo(io)`**

Locate `setPresenceIo(io);` (currently `server/app.ts:534`). After it, add:

```ts
// Initialize the availability module — parallel with presence/statusTracking
// during the migration. Callers will be flipped over slice-by-slice (RFC #88).
const availability = new Availability({
  live: new RedisLiveState({ redis: pubClient, logger }),
  log: new DrizzleTransitionLog({
    db,
    schema: { agentStatusLog: schema.agentStatusLog, dailyAgentStatus: schema.dailyAgentStatus },
    logger,
  }),
  broadcast: new SocketIoBroadcast({ io, logger }),
  clock: { now: () => new Date() },
});
initAvailability(availability);
logger.info('Availability module initialized (parallel with legacy presence/statusTracking)');
```

Note: `pubClient` must be in scope. The current `initRedis().then(...)` block at line 105-129 captures `pubClient`; you'll need to either (a) hoist the availability init into that `.then()` callback alongside `initAiContext`, or (b) export `pubClient` from `utils/redis.ts` (already done — `getRedisClients().pubClient`). Use approach (b) — call `getRedisClients().pubClient` inline so the construction happens synchronously after `setPresenceIo(io)`.

Adjusted block:

```ts
const { pubClient: avPub } = getRedisClients();
const availability = new Availability({
  live: new RedisLiveState({ redis: avPub, logger }),
  // ... rest as above
});
```

Add `import { getRedisClients } from './utils/redis.js';` at top of `app.ts` if not already imported.

- [ ] **Step 3: Restart server, run full CI**

```bash
docker compose restart server
docker compose exec server npx tsc --noEmit
docker compose exec server npx vitest run server/services/availability/__tests__/availability.boundary.test.ts
powershell -File scripts/ci.ps1 -Skip e2e
```

Expected: typecheck passes; boundary tests pass; existing tests still pass (legacy presence/statusTracking untouched).

- [ ] **Step 4: Commit**

```bash
git add server/app.ts
git commit -m "feat(availability): wire module into app.ts boot (parallel with legacy presence/statusTracking)"
```

### Task 1.11: (Optional) Adapter-level integration tests

**Files:**
- Create: `server/services/availability/__tests__/redisLiveState.adapter.test.ts`
- Create: `server/services/availability/__tests__/drizzleTransitionLog.adapter.test.ts`

These run against the real Redis + PG containers and are slower than the boundary suite. They guard the SQL/Lua extracted from the legacy modules. If the boundary suite gives you confidence the orchestration is right, the adapter tests prove the I/O is right.

- [ ] **Step 1: RedisLiveState adapter test**

```ts
// server/services/availability/__tests__/redisLiveState.adapter.test.ts
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { createClient } from 'redis';
import { RedisLiveState } from '../adapters/redisLiveState.js';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

describe('RedisLiveState adapter', () => {
  let client: Awaited<ReturnType<typeof createClient>>;
  let live: RedisLiveState;

  beforeAll(async () => {
    client = createClient({ url: REDIS_URL });
    await client.connect();
  });

  afterAll(async () => { await client.quit(); });

  beforeEach(async () => {
    await live?.flushAll();
    live = new RedisLiveState({ redis: client as never, logger: { error: () => {}, debug: () => {} } });
  });

  it('attachSocket then detachSocket transitions full-online -> full-offline', async () => {
    await live.upsertIdentity({ partnerId: 'p1', userId: 'u1', role: 'support', name: 'X', isPlatformOperator: false });
    expect((await live.attachSocket('p1', 'u1', 's1')).socketCount).toBe(1);
    expect((await live.attachSocket('p1', 'u1', 's2')).socketCount).toBe(2);
    expect((await live.detachSocket('p1', 'u1', 's1')).socketCount).toBe(1);
    expect((await live.detachSocket('p1', 'u1', 's2')).socketCount).toBe(0);
    expect(await live.readStatus('p1', 'u1')).toBeNull(); // hash dropped
  });

  it('upsertIdentity preserves status across reconnect', async () => {
    await live.upsertIdentity({ partnerId: 'p1', userId: 'u1', role: 'support', name: 'X', isPlatformOperator: false });
    await live.writeStatus('p1', 'u1', 'away');
    await live.upsertIdentity({ partnerId: 'p1', userId: 'u1', role: 'support', name: 'X', isPlatformOperator: false }); // reconnect
    expect(await live.readStatus('p1', 'u1')).toBe('away');
  });

  it('flushAll clears all presence keys', async () => {
    await live.upsertIdentity({ partnerId: 'p1', userId: 'u1', role: 'support', name: 'X', isPlatformOperator: false });
    await live.attachSocket('p1', 'u1', 's1');
    const { deleted } = await live.flushAll();
    expect(deleted).toBeGreaterThan(0);
    expect(await live.readStatus('p1', 'u1')).toBeNull();
  });
});
```

- [ ] **Step 2: DrizzleTransitionLog adapter test**

```ts
// server/services/availability/__tests__/drizzleTransitionLog.adapter.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../../db/postgres.js';
import { agentStatusLog, dailyAgentStatus } from '../../../db/schema.js';
import { DrizzleTransitionLog } from '../adapters/drizzleTransitionLog.js';

describe('DrizzleTransitionLog adapter', () => {
  let log: DrizzleTransitionLog;

  beforeEach(async () => {
    log = new DrizzleTransitionLog({
      db,
      schema: { agentStatusLog, dailyAgentStatus },
      logger: { error: () => {}, info: () => {} },
    });
    // Clean test partner
    await db.delete(agentStatusLog);
    await db.delete(dailyAgentStatus);
  });

  it('closeAndOpen closes prior open row and inserts new one atomically', async () => {
    const t1 = new Date('2026-04-29T10:00:00Z');
    const t2 = new Date('2026-04-29T11:00:00Z');
    await log.openRow({ userId: 'u1', partnerId: 'p1', status: 'online', startedAt: t1 });
    await log.closeAndOpen({ userId: 'u1', partnerId: 'p1', nextStatus: 'away', at: t2 });
    const rows = await db.select().from(agentStatusLog);
    expect(rows).toHaveLength(2);
    expect(rows.find(r => r.endedAt !== null)?.duration).toBe(3600);
    expect(rows.find(r => r.endedAt === null)?.status).toBe('away');
  });

  it('rollbackTransition undoes a closeAndOpen', async () => {
    const t1 = new Date('2026-04-29T10:00:00Z');
    const t2 = new Date('2026-04-29T11:00:00Z');
    await log.openRow({ userId: 'u1', partnerId: 'p1', status: 'online', startedAt: t1 });
    await log.closeAndOpen({ userId: 'u1', partnerId: 'p1', nextStatus: 'away', at: t2 });
    await log.rollbackTransition({ userId: 'u1', partnerId: 'p1', at: t2 });
    const rows = await db.select().from(agentStatusLog);
    expect(rows).toHaveLength(1);
    expect(rows[0].endedAt).toBeNull();
    expect(rows[0].status).toBe('online');
  });

  it('rollupDay aggregates seconds and is idempotent', async () => {
    const dayStart = new Date('2026-04-29T00:00:00Z');
    const dayMid = new Date('2026-04-29T12:00:00Z');
    const dayEnd = new Date('2026-04-29T23:00:00Z');
    await log.openRow({ userId: 'u1', partnerId: 'p1', status: 'online', startedAt: dayStart });
    await log.closeAndOpen({ userId: 'u1', partnerId: 'p1', nextStatus: 'away', at: dayMid });
    await log.closeOpenRow({ userId: 'u1', partnerId: 'p1', endedAt: dayEnd });
    await log.rollupDay('p1', '2026-04-29');
    await log.rollupDay('p1', '2026-04-29'); // idempotent
    const daily = await log.agentDaily('u1', 'p1', '2026-04-29', '2026-04-29');
    expect(daily).toHaveLength(1);
    expect(daily[0].onlineSeconds).toBe(12 * 3600);
    expect(daily[0].awaySeconds).toBe(11 * 3600);
  });
});
```

- [ ] **Step 3: Run adapter tests**

```bash
docker compose exec server npx vitest run server/services/availability/__tests__/redisLiveState.adapter.test.ts
docker compose exec server npx vitest run server/services/availability/__tests__/drizzleTransitionLog.adapter.test.ts
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add server/services/availability/__tests__/redisLiveState.adapter.test.ts \
        server/services/availability/__tests__/drizzleTransitionLog.adapter.test.ts
git commit -m "test(availability): adapter-level tests against real Redis + PG"
```

### Task 1.12: Final slice-1 CI gate

- [ ] **Step 1: Full CI**

```bash
powershell -File scripts/ci.ps1
```

Expected: PASS.

- [ ] **Step 2: PR**

```bash
git push -u origin <slice-1-branch>
gh pr create --title "feat(availability): module skeleton + adapters + boundary tests (slice 1/9)" \
  --body "$(cat <<'EOF'
RFC: #88

Slice 1 of 9. Lands the new `Availability` module + production adapters + memory test adapters + boundary contract tests. **No callers migrated yet** — `presence.ts` and `statusTracking.ts` continue serving traffic. The new module is wired into `app.ts` boot in parallel.

## Test plan
- [ ] Boundary tests pass (12 tests against memory adapters)
- [ ] Adapter-level tests pass (Redis + PG)
- [ ] Full `scripts/ci.ps1` clean
- [ ] No behavioral change observable to E2E
EOF
)"
```

---

# Slice 2: Migrate `socket/handlers/presence.ts` (status:set + support:join ghost-heal + support:leave)

**PR title:** `refactor(socket): presence handler uses Availability — atomic status:set`

**Why this caller first:** `status:set` is the single most surface-changing path — it's where the original divergence bug lives (Redis says online, PG says away 3h ago). Atomicity from the new module is the immediate payoff. `support:join` and `support:leave` consume `presenceService.getUserStatus` for ghost-heal decisions; both flip to `availability.advanced.getStatus`.

### Task 2.1: Update imports

**Files:**
- Modify: `server/socket/handlers/presence.ts`

- [ ] **Step 1: Replace imports**

Replace lines 4-5:

```ts
import * as presenceService from '../../services/presence.js';
import * as statusTracking from '../../services/statusTracking.js';
```

With:

```ts
import { getAvailability } from '../../services/availability/index.js';
```

### Task 2.2: Migrate `status:set`

**Files:**
- Modify: `server/socket/handlers/presence.ts:175-186`

- [ ] **Step 1: Replace handler body**

Before (lines 175-186):

```ts
socket.on('status:set', async (data: unknown) => {
  if (!requireIdentified(socket)) return;
  const statusParsed = validatePayload(socket, statusSetSchema, data);
  if (!statusParsed) return;
  const { status } = statusParsed;
  const actor = socketActor(socket);
  if (!actor) return;
  await presenceService.setUserStatus(actor.userId, actor.partnerId, status);
  await statusTracking.logTransition(actor.userId, actor.partnerId, status);
  // Re-broadcast online support list so viewer UIs (chat header avatars, queue sidebar) reflect the new status immediately.
  await presenceService.broadcastOnlineSupport(actor.partnerId);
});
```

After:

```ts
socket.on('status:set', async (data: unknown) => {
  if (!requireIdentified(socket)) return;
  const statusParsed = validatePayload(socket, statusSetSchema, data);
  if (!statusParsed) return;
  const { status } = statusParsed;
  const actor = socketActor(socket);
  if (!actor) return;
  // setStatus does PG transition log + Redis hash + broadcast atomically.
  await getAvailability().setStatus(actor.userId, actor.partnerId, status);
});
```

Note: `statusSetSchema` already constrains `status` to `'online' | 'away'`, so the cast to `AgentStatus` is type-safe (verify `server/socket/handlers/types.ts` defines the same closed enum).

### Task 2.3: Migrate `support:join` ghost-heal

**Files:**
- Modify: `server/socket/handlers/presence.ts:90-94`

- [ ] **Step 1: Replace ghost-heal Redis read**

Before:

```ts
const status = await presenceService.getUserStatus(
  ticket.supportId,
  callerPartnerId,
);
primaryValid = status !== null;
```

After:

```ts
const status = await getAvailability().advanced.getStatus(
  ticket.supportId,
  callerPartnerId,
);
primaryValid = status !== null;
```

### Task 2.4: Migrate `support:leave` ghost-primary check

**Files:**
- Modify: `server/socket/handlers/presence.ts:217-222`

- [ ] **Step 1: Replace Redis read**

Before:

```ts
const primaryValid =
  storedPrimary !== supportId
  && remaining.some((p: Participant) => p.id === storedPrimary)
  && (await presenceService.getUserStatus(storedPrimary, actor.partnerId)) !== null;
```

After:

```ts
const primaryValid =
  storedPrimary !== supportId
  && remaining.some((p: Participant) => p.id === storedPrimary)
  && (await getAvailability().advanced.getStatus(storedPrimary, actor.partnerId)) !== null;
```

### Task 2.5: Existing test compatibility

**Files:**
- Search: `server/**/__tests__/**/*presence*` and `server/**/*.test.ts`

- [ ] **Step 1: Run all presence-handler-adjacent tests**

```bash
docker compose exec server npx vitest run server/socket/handlers
```

Expected: any test that mocks `services/presence.js` or `services/statusTracking.js` for the presence handler now needs to mock `services/availability/index.js`. Update the `vi.mock` targets:

For each affected test, replace:
```ts
vi.mock('../../services/presence.js', () => ({ ... }));
vi.mock('../../services/statusTracking.js', () => ({ ... }));
```

With:
```ts
const mockAvailability = {
  setStatus: vi.fn().mockResolvedValue(undefined),
  advanced: { getStatus: vi.fn().mockResolvedValue(null) },
};
vi.mock('../../services/availability/index.js', () => ({
  getAvailability: () => mockAvailability,
}));
```

Then update assertion lines accordingly (e.g. `expect(setUserStatusMock).toHaveBeenCalled` → `expect(mockAvailability.setStatus).toHaveBeenCalled`).

### Task 2.6: Verify

- [ ] **Step 1: Restart, typecheck, vitest**

```bash
docker compose restart server
docker compose exec server npx tsc --noEmit
docker compose exec server npx vitest run server/socket/handlers
docker compose exec server npx vitest run server/services/availability
```

- [ ] **Step 2: E2E smoke (status flow)**

Run only the e2e specs that exercise status changes; full e2e is fine before PR merge.

```bash
powershell -File scripts/ci.ps1
```

- [ ] **Step 3: Commit**

```bash
git add server/socket/handlers/presence.ts server/socket/handlers/__tests__/  # adjust paths
git commit -m "refactor(socket): presence handler uses availability.setStatus + advanced.getStatus"
```

### Task 2.7: PR

```bash
gh pr create --title "refactor(socket): presence handler uses Availability (slice 2/9)" \
  --body "$(cat <<'EOF'
RFC: #88

Migrates `server/socket/handlers/presence.ts` to the new `Availability` module.

- `status:set` — single `availability.setStatus()` call replaces 3 sequential calls (PG log, Redis hash, broadcast). Atomic per RFC §"Atomicity Policy".
- `support:join` ghost-heal — `availability.advanced.getStatus`.
- `support:leave` ghost-primary check — `availability.advanced.getStatus`.

`presence.ts` and `statusTracking.ts` remain alive for other callers; they will be deleted in slice 9.

## Test plan
- [ ] Boundary suite still green
- [ ] Handler-unit tests rewritten to mock `availability` (see PR diff)
- [ ] E2E status-and-transfer suite passes
EOF
)"
```

---

# Slice 3: Migrate `socket/handlers/auth.ts` (identify path)

**PR title:** `refactor(socket): identify uses availability.socket.attach`

**Why now:** Identify is the entry point. Once `socket.attach` is wired, every new connection produces consistent live-state + transition-log openings.

### Task 3.1: Replace identify body

**Files:**
- Modify: `server/socket/handlers/auth.ts:9, 14, 260-287`

- [ ] **Step 1: Imports**

Replace:
```ts
import * as presenceService from '../../services/presence.js';
import * as statusTracking from '../../services/statusTracking.js';
```

With:
```ts
import { getAvailability } from '../../services/availability/index.js';
```

- [ ] **Step 2: Replace identify body (lines 260-287)**

Before:

```ts
await presenceService.identifyUser(userId, effectiveRole, name, partnerId, isPlatformOp, socket.id);

// Join partner-wide room ...
socket.join(Rooms.partner(partnerId));
if (isSupport) {
  socket.join(Rooms.staff(partnerId));
  await presenceService.broadcastOnlineSupport(partnerId);
}

socket.join(Rooms.user(userId));

if (effectiveRole === 'agent') {
  broadcastAgentStatus(userId, true);
  presenceService.broadcastOnlineAgents(partnerId);
}

if (isSupport) {
  const persistedStatus = await presenceService.getUserStatus(userId, partnerId);
  await statusTracking.logTransition(userId, partnerId, persistedStatus || 'online');
  if (persistedStatus && persistedStatus !== 'online') {
    socket.emit('status:restored', { status: persistedStatus });
  }
}
```

After:

```ts
const availability = getAvailability();

// socket.attach: SADD socket id, upsertIdentity (preserves status on reconnect),
// clear offlineAt, broadcast support:online (if support) or agents:online (if agent).
await availability.socket.attach({
  userId,
  partnerId,
  socketId: socket.id,
  role: effectiveRole,
  name,
  isPlatformOperator: isPlatformOp,
});

// Join partner-wide room (broadcasts handled by socket.attach above for support/agent).
socket.join(Rooms.partner(partnerId));
if (isSupport) socket.join(Rooms.staff(partnerId));
socket.join(Rooms.user(userId));

if (effectiveRole === 'agent') {
  broadcastAgentStatus(userId, true);
  // socket.attach already fired agents:online — no second broadcast needed.
}

// Open a fresh transition-log row for this connection (status preserved across reconnect).
if (isSupport) {
  const persistedStatus = await availability.advanced.getStatus(userId, partnerId);
  // Note: socket.attach already opened a presence hash with status='online' on first
  // connect. We log the persisted status (or 'online' fallback) so the transition log
  // gets a fresh row tied to this socket session.
  if (persistedStatus && persistedStatus !== 'online') {
    socket.emit('status:restored', { status: persistedStatus });
  }
}
```

**Important:** the legacy `statusTracking.logTransition` call after identify opened a new PG row on every connect. The new `availability.socket.attach` does NOT open a transition-log row — only `setStatus` does. This is intentional: a transition-log row should mark a status *change*, not a connect event. To preserve the legacy "row per connect" behavior (used by daily rollups), the orchestrator's `socket.attach` MUST open a row on the first attach (when `socketCount` was 0 before this attach). Update the orchestrator:

- [ ] **Step 3: Refine `Availability.socket.attach` to open a transition-log row on first connect**

Modify `server/services/availability/availability.ts` `socket.attach`:

```ts
attach: async (p: AttachInput): Promise<void> => {
  const { socketCount } = await this.deps.live.attachSocket(p.partnerId, p.userId, p.socketId);
  const wasFullyOffline = socketCount === 1; // we just added the first one

  await this.deps.live.upsertIdentity({
    partnerId: p.partnerId,
    userId: p.userId,
    role: p.role,
    name: p.name,
    isPlatformOperator: !!p.isPlatformOperator,
  });
  await this.deps.live.clearOfflineAt(p.partnerId, p.userId);

  // Open a transition-log row on first connect, preserving any previously-set status.
  if (wasFullyOffline) {
    const status = (await this.deps.live.readStatus(p.partnerId, p.userId)) ?? 'online';
    await this.deps.log.openRow({
      userId: p.userId,
      partnerId: p.partnerId,
      status,
      startedAt: this.deps.clock.now(),
    });
  }

  if (canUseSupportWorkflows(p.role, !!p.isPlatformOperator)) {
    await this.broadcastSupportRoster(p.partnerId);
  }
  if (p.role === 'agent') {
    await this.broadcastAgentRoster(p.partnerId);
  }
},
```

- [ ] **Step 4: Add boundary test for the open-row-on-first-connect invariant**

Add to `availability.boundary.test.ts`:

```ts
it('socket.attach opens a transition-log row on first connect (not on reconnect)', async () => {
  await attachAsSupport('u1', 'p1', 's-1');
  expect(log.rows.filter(r => r.userId === 'u1' && r.endedAt === null)).toHaveLength(1);
  await attachAsSupport('u1', 'p1', 's-2'); // second connect, same user
  expect(log.rows.filter(r => r.userId === 'u1' && r.endedAt === null)).toHaveLength(1); // still 1
});

it('socket.detach closes the transition-log row on last disconnect', async () => {
  await attachAsSupport('u1', 'p1', 's-1');
  await av.socket.detach({ userId: 'u1', partnerId: 'p1', socketId: 's-1' });
  const last = log.rows[log.rows.length - 1];
  expect(last.endedAt).toEqual(now);
});
```

- [ ] **Step 5: Update `Availability.socket.detach` to close the row on last disconnect**

```ts
detach: async (p: DetachInput): Promise<DetachResult> => {
  const before = await this.deps.live.listOnline(p.partnerId);
  const userBefore = before.find(u => u.userId === p.userId);

  const { socketCount } = await this.deps.live.detachSocket(p.partnerId, p.userId, p.socketId);
  const fullyOffline = socketCount === 0;

  const role = userBefore?.role ?? '';
  const isPlatformOperator = userBefore?.isPlatformOperator ?? false;

  if (fullyOffline) {
    const at = this.deps.clock.now();
    await this.deps.live.markOfflineAt(p.partnerId, p.userId, at);
    await this.deps.log.closeOpenRow({ userId: p.userId, partnerId: p.partnerId, endedAt: at });
    if (canUseSupportWorkflows(role, isPlatformOperator)) {
      await this.broadcastSupportRoster(p.partnerId);
    }
    if (role === 'agent') {
      await this.broadcastAgentRoster(p.partnerId);
    }
  }

  return { fullyOffline, role, partnerId: p.partnerId, isPlatformOperator };
},
```

### Task 3.2: Verify

- [ ] **Step 1: Run boundary + handler tests**

```bash
docker compose restart server
docker compose exec server npx tsc --noEmit
docker compose exec server npx vitest run server/services/availability
docker compose exec server npx vitest run server/socket/handlers
```

- [ ] **Step 2: Full CI**

```bash
powershell -File scripts/ci.ps1
```

- [ ] **Step 3: Commit + PR**

```bash
git add server/socket/handlers/auth.ts server/services/availability/availability.ts \
        server/services/availability/__tests__/availability.boundary.test.ts
git commit -m "refactor(socket): identify uses availability.socket.attach (slice 3/9)"
```

---

# Slice 4: Migrate `socket/handlers/disconnect.ts`

**PR title:** `refactor(socket): disconnect uses availability.socket.detach`

### Task 4.1: Replace disconnect body

**Files:**
- Modify: `server/socket/handlers/disconnect.ts:3-4, 39-54`

- [ ] **Step 1: Imports**

Replace:
```ts
import * as presenceService from '../../services/presence.js';
import * as statusTracking from '../../services/statusTracking.js';
```

With:
```ts
import { getAvailability } from '../../services/availability/index.js';
```

- [ ] **Step 2: Replace presence/statusTracking calls**

Before:

```ts
if (userId && partnerId) {
  try {
    const result = await presenceService.decrementUserCount(userId, partnerId, socket.id);
    if (result && result.removed) {
      if (result.role === 'agent') {
        broadcastAgentStatus(userId, false);
        presenceService.broadcastOnlineAgents(partnerId);
      }
      // Close status tracking row when user fully disconnects (all roles)
      await statusTracking.closeOpenRow(userId, partnerId);
    }
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err), userId }, '[socket] Presence decrement error on disconnect');
  }
}
```

After:

```ts
if (userId && partnerId) {
  try {
    const result = await getAvailability().socket.detach({ userId, partnerId, socketId: socket.id });
    if (result.fullyOffline && result.role === 'agent') {
      broadcastAgentStatus(userId, false);
      // socket.detach already broadcast agents:online — no second broadcast needed.
    }
    // Note: closeOpenRow on full-offline is handled inside availability.socket.detach.
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err), userId }, '[socket] availability.detach error on disconnect');
  }
}
```

### Task 4.2: Verify

- [ ] **Step 1: Restart + tests + CI**

```bash
docker compose restart server
docker compose exec server npx tsc --noEmit
docker compose exec server npx vitest run server/socket/handlers
powershell -File scripts/ci.ps1
```

- [ ] **Step 2: Commit + PR**

```bash
git add server/socket/handlers/disconnect.ts
git commit -m "refactor(socket): disconnect uses availability.socket.detach (slice 4/9)"
```

---

# Slice 5: Migrate `services/ticketReclaim.ts`

**PR title:** `refactor(reclaim): ticketReclaim uses availability snapshot`

### Task 5.1: Replace presence reads

**Files:**
- Modify: `server/services/ticketReclaim.ts:6, 76-80`

- [ ] **Step 1: Imports**

Replace:
```ts
import { getOfflineAt, getUserStatus } from './presence.js';
```

With:
```ts
import { getAvailability } from './availability/index.js';
```

- [ ] **Step 2: Replace the per-ticket online check**

Before (lines 76-80):

```ts
// Only reclaim if the agent is fully offline (no sockets at all)
const status = await getUserStatus(ticket.supportId, ticket.partnerId);
if (status !== null) continue; // agent is online/away/busy — don't reclaim

// Primary check: how long has the agent actually been offline?
const offlineAt = await getOfflineAt(ticket.supportId, ticket.partnerId);
```

After:

```ts
const availability = getAvailability();
// Only reclaim if the agent is fully offline (no sockets at all).
// `getStatus` returns null iff the live-state hash has been deleted, which happens
// only when the last socket disconnects (Lua DEL in detachSocket).
const status = await availability.advanced.getStatus(ticket.supportId, ticket.partnerId);
if (status !== null) continue;

// Primary check: how long has the agent actually been offline?
const offlineAt = await availability.advanced.offlineSince(ticket.supportId, ticket.partnerId);
```

Note: the legacy `getOfflineAt` returned the marker without checking online state. The new `advanced.offlineSince` returns null when online — but we already gated on `status !== null`, so by the time we reach this line the agent IS offline, and `offlineSince` returns the marker (or null if Redis lost it — restart fallback path applies, unchanged from legacy).

### Task 5.2: Verify

- [ ] **Step 1: Restart + tests + CI**

```bash
docker compose restart server
docker compose exec server npx vitest run server/services/ticketReclaim.test.ts
powershell -File scripts/ci.ps1
```

Note: `ticketReclaim.test.ts` exists per CLAUDE.md ("Crash-recovery path for tickets left mid-assign; behavioral coverage in `ticketReclaim` test"). Update its mocks: replace `vi.mock('./presence.js', ...)` with `vi.mock('./availability/index.js', () => ({ getAvailability: () => ({ advanced: { getStatus: vi.fn(), offlineSince: vi.fn() } }) }))`.

- [ ] **Step 2: Commit + PR**

```bash
git add server/services/ticketReclaim.ts server/services/ticketReclaim.test.ts
git commit -m "refactor(reclaim): ticketReclaim uses availability.advanced (slice 5/9)"
```

---

# Slice 6: Migrate tRPC routers (status, presence, support)

**PR title:** `refactor(trpc): status/presence/support routers use Availability`

### Task 6.1: Migrate `server/trpc/routers/status.ts`

**Files:**
- Modify: `server/trpc/routers/status.ts:7-8, 18, 55, 72`

- [ ] **Step 1: Replace imports + calls**

Replace lines 7-8:

```ts
import * as statusTracking from '../../services/statusTracking.js';
import * as presenceService from '../../services/presence.js';
```

With:

```ts
import { getAvailability } from '../../services/availability/index.js';
```

Replace line 18 (`const onlineUsers = await presenceService.getOnlineUsersForPartner(partnerId);`) with:

```ts
const onlineUsers = await getAvailability().advanced.onlineUsers(partnerId);
```

Replace line 55 (`return statusTracking.getAgentDailyStats(input.userId, partnerId, input.fromDate, input.toDate);`) with:

```ts
return getAvailability().reports.agentDaily(input.userId, partnerId, input.fromDate, input.toDate);
```

Replace line 72 (`return statusTracking.getTeamDailyStats(partnerId, input.fromDate, input.toDate);`) with:

```ts
return getAvailability().reports.teamDaily(partnerId, input.fromDate, input.toDate);
```

### Task 6.2: Migrate `server/trpc/routers/presence.ts`

**Files:**
- Modify: `server/trpc/routers/presence.ts:3, 13, 33`

- [ ] **Step 1: Replace import + body**

Replace import:
```ts
import * as presenceService from '../../services/presence.js';
```

With:
```ts
import { getAvailability } from '../../services/availability/index.js';
```

Line 13 (`const onlineUsers = await presenceService.getOnlineUsersForPartner(ctx.user.partnerId);`):

```ts
const onlineUsers = await getAvailability().advanced.onlineUsers(ctx.user.partnerId);
```

Line 33 (`const updated = await presenceService.setUserStatus(input.userId, partnerId, input.status);`) — this admin-set-status path needs a slightly different shape. The legacy `setUserStatus` returned `boolean` (false if user has no Redis hash). The new `availability.setStatus` does the full atomic transition AND returns void. Use it:

```ts
// setStatus is a no-op if the target user has no live-state hash (never identified).
// To preserve the legacy NOT_FOUND error UX, check getStatus first.
const exists = (await getAvailability().advanced.getStatus(input.userId, partnerId)) !== null;
if (!exists) {
  throw new TRPCError({ code: 'NOT_FOUND', message: 'User not online' });
}
await getAvailability().setStatus(input.userId, partnerId, input.status);
```

- [ ] **Step 2: Update `presence.test.ts` mocks**

`server/trpc/routers/presence.test.ts` mocks `services/presence.js`. Change to:

```ts
const mockAvailability = {
  advanced: { onlineUsers: vi.fn(), getStatus: vi.fn() },
  setStatus: vi.fn(),
};
vi.mock('../../services/availability/index.js', () => ({ getAvailability: () => mockAvailability }));
```

Update assertions: `expect(getOnlineUsersForPartnerMock).toHaveBeenCalledWith('partner-a')` → `expect(mockAvailability.advanced.onlineUsers).toHaveBeenCalledWith('partner-a')`.

### Task 6.3: Migrate `server/trpc/routers/support.ts`

**Files:**
- Modify: `server/trpc/routers/support.ts:7, 67`

- [ ] **Step 1: Replace import + call**

Replace:
```ts
import { getOnlineUsersForPartner } from '../../services/presence.js';
```

With:
```ts
import { getAvailability } from '../../services/availability/index.js';
```

Line 67:
```ts
const online = await getOnlineUsersForPartner(input.partnerId);
```

becomes:

```ts
const online = await getAvailability().advanced.onlineUsers(input.partnerId);
```

### Task 6.4: Verify

- [ ] **Step 1: Restart + tests + CI**

```bash
docker compose restart server
docker compose exec server npx tsc --noEmit
docker compose exec server npx vitest run server/trpc
powershell -File scripts/ci.ps1
```

- [ ] **Step 2: Commit + PR**

```bash
git add server/trpc/routers/status.ts server/trpc/routers/presence.ts \
        server/trpc/routers/presence.test.ts server/trpc/routers/support.ts
git commit -m "refactor(trpc): status/presence/support routers use availability (slice 6/9)"
```

---

# Slice 7: Migrate `services/dashboard/staffingHeatmapQueries.ts`

**PR title:** `refactor(dashboard): staffing heatmap reads via availability.reports.teamDaily`

### Task 7.1: Replace direct Drizzle read

**Files:**
- Modify: `server/services/dashboard/staffingHeatmapQueries.ts`

- [ ] **Step 1: Replace `dailyAgentStatus` query with `availability.reports.teamDaily`**

The legacy file selects raw `dailyAgentStatus` rows and maps them into `AgentStatusRow[]`. The new module exposes `reports.teamDaily(partnerId, fromDate, toDate): DailyStats[]` which already has `userId`, `date`, `onlineSeconds`, `awaySeconds`. Map `DailyStats[]` → `AgentStatusRow[]` (drop `awaySeconds`, `partnerId`).

Replace lines 14-17:

```ts
import { and, eq, gte, lte } from 'drizzle-orm';
import { db } from '../../db.js';
import { dailyAgentStatus, dailyStats } from '../../db/schema.js';
import type {
  AgentStatusRow,
  DailyStatsRow,
} from './staffingHeatmap.js';
```

With:

```ts
import { and, eq, gte, lte } from 'drizzle-orm';
import { db } from '../../db.js';
import { dailyStats } from '../../db/schema.js';
import { getAvailability } from '../availability/index.js';
import type {
  AgentStatusRow,
  DailyStatsRow,
} from './staffingHeatmap.js';
```

Replace the `Promise.all` body in `fetchStaffingHeatmapData` (lines 56-81):

```ts
const [statsRows, agentRowsRaw] = await Promise.all([
  db.select({ date: dailyStats.date, hourly: dailyStats.hourly }).from(dailyStats).where(and(
    eq(dailyStats.partnerId, partnerId),
    gte(dailyStats.date, fromDate),
    lte(dailyStats.date, toDate),
  )),
  getAvailability().reports.teamDaily(partnerId, fromDate, toDate),
]);

return {
  dailyStats: statsRows.map((r) => ({ date: r.date, hourly: coerceHourly(r.hourly) })),
  agentStatus: agentRowsRaw.map((r) => ({
    date: r.date,
    userId: r.userId,
    onlineSeconds: r.onlineSeconds,
  })),
};
```

### Task 7.2: Verify

- [ ] **Step 1: Restart + tests + CI**

```bash
docker compose restart server
docker compose exec server npx tsc --noEmit
docker compose exec server npx vitest run server/services/dashboard
powershell -File scripts/ci.ps1
```

- [ ] **Step 2: Commit + PR**

```bash
git add server/services/dashboard/staffingHeatmapQueries.ts
git commit -m "refactor(dashboard): staffing heatmap reads via availability.reports.teamDaily (slice 7/9)"
```

---

# Slice 8: Migrate `app.ts` boot flush + daily rollup cron

**PR title:** `refactor(boot): flush + rollup cron use Availability`

### Task 8.1: Replace boot flush

**Files:**
- Modify: `server/app.ts:27, 29, 434, 509-520`

- [ ] **Step 1: Drop legacy imports (slice 9 will delete the modules; this slice stops calling them)**

Replace line 27:
```ts
import { setIo as setPresenceIo, flushPresenceOnStartup } from './services/presence.js';
```

With:
```ts
import { setIo as setPresenceIo } from './services/presence.js'; // legacy — slice 9 removes
```

Drop line 29:
```ts
import { rollupDay } from './services/statusTracking.js';
```

(Will be replaced by `availability.reports.rollupDay` below.)

- [ ] **Step 2: Replace boot flush call (line 434)**

Before:
```ts
flushPresenceOnStartup().catch((err) => logger.warn({ err }, '[presence] Startup flush failed (non-fatal)'));
```

After:
```ts
getAvailability().flushOnBoot().catch((err) => logger.warn({ err }, '[availability] Startup flush failed (non-fatal)'));
```

Note: `getAvailability()` is callable here only after `initAvailability(...)` has been called. Verify ordering — slice 1 added `initAvailability` after `setPresenceIo(io)` at line 534. The `flushPresenceOnStartup` at line 434 runs BEFORE that. Move the `flushOnBoot()` call to after `initAvailability(availability);`.

Updated location: in the block that begins at line 530 (`registerSocketHandlers(io, ...)`), after `initAvailability(availability)`:

```ts
registerSocketHandlers(io, { lifecycle, messageLifecycle });
setBusinessHoursIo(io);
setPresenceIo(io);

const availability = new Availability({ /* … */ });
initAvailability(availability);

// Now safe to flush — adapters wired.
availability.flushOnBoot().catch((err) =>
  logger.warn({ err }, '[availability] Startup flush failed (non-fatal)'));
```

Delete the old `flushPresenceOnStartup().catch(...)` line at 434.

- [ ] **Step 3: Replace daily rollup cron (lines 509-520)**

Before:
```ts
setInterval(async () => {
  try {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const allPartners = await db.select({ id: schema.partners.id }).from(schema.partners);
    for (const p of allPartners) {
      await rollupDay(p.id, yesterday);
    }
    logger.info({ date: yesterday }, '[statusTracking] Hourly rollup complete');
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, '[statusTracking] Rollup error');
  }
}, 60 * 60 * 1000).unref();
```

After:
```ts
setInterval(async () => {
  try {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const allPartners = await db.select({ id: schema.partners.id }).from(schema.partners);
    const av = getAvailability();
    for (const p of allPartners) {
      await av.reports.rollupDay(p.id, yesterday);
    }
    logger.info({ date: yesterday }, '[availability] Hourly rollup complete');
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, '[availability] Rollup error');
  }
}, 60 * 60 * 1000).unref();
```

- [ ] **Step 4: Add `getAvailability` import**

At top of `app.ts`, ensure:
```ts
import {
  Availability,
  RedisLiveState,
  DrizzleTransitionLog,
  SocketIoBroadcast,
  initAvailability,
  getAvailability,
} from './services/availability/index.js';
```

### Task 8.2: Verify

- [ ] **Step 1: Restart + boot integration check**

```bash
docker compose restart server
docker logs guichet-server-1 --tail=80
```

Expected: `[availability] Startup flush complete — stale entries cleared` and `Availability module initialized`. No reference to `[statusTracking] Hourly rollup` (replaced by `[availability] Hourly rollup`).

- [ ] **Step 2: Full CI**

```bash
powershell -File scripts/ci.ps1
```

- [ ] **Step 3: Commit + PR**

```bash
git add server/app.ts
git commit -m "refactor(boot): flushOnBoot + daily rollup cron use availability (slice 8/9)"
```

---

# Slice 9: Demolition — delete legacy + reconcile testFixtures

**PR title:** `refactor(availability): delete legacy presence + statusTracking modules`

**Why now:** All callers migrated. Final sweep verifies no remaining importers, deletes the legacy files, and rewrites the e2e fixture writer to use the new module.

### Task 9.1: Find remaining importers

**Files:**
- Search: any `import.*services/(presence|statusTracking)`

- [ ] **Step 1: Sweep for stragglers**

```bash
docker compose exec server bash -c "grep -rn -E 'services/(presence|statusTracking)' --include='*.ts' /app/server"
```

Expected:
- `server/app.ts:27` — the `setIo as setPresenceIo` (still legacy — but the function is now a no-op since the new module owns broadcasts; verify by reading `presence.ts:setIo` usage). The `setIo(io)` shim was used by `broadcastOnlineSupport` / `broadcastOnlineAgents` inside `presence.ts`. Since slices 2/3/4/6 stopped calling those legacy broadcast helpers, removing `setIo` is safe.
- `server/trpc/routers/testFixtures.ts:251-255` — writes raw Redis presence hash for the `resetAgentStatus` test fixture. Reconcile in step 9.3.
- Any test file mocking `services/presence.js` or `services/statusTracking.js` — should already have been updated in slices 2-7. Confirm zero stragglers.

If any remain that aren't `testFixtures.ts` or test-file mocks, fix them before continuing.

### Task 9.2: Delete legacy modules

- [ ] **Step 1: Delete files**

```bash
rm server/services/presence.ts
rm server/services/statusTracking.ts
```

- [ ] **Step 2: Delete now-orphaned tests**

Run the existing test files referenced in slice prep:

```bash
docker compose exec server bash -c "ls server/__tests__/presence*.test.ts 2>/dev/null"
```

Files to delete (RFC §"Old tests to delete"):
- `server/__tests__/presenceStatusEnum.test.ts` (status enum coverage now lives in `availability.boundary.test.ts`)
- `server/__tests__/presenceReconnect.test.ts` (reconnect coverage now lives in boundary tests `socket.attach preserves status on reconnect`)

```bash
git rm server/__tests__/presenceStatusEnum.test.ts server/__tests__/presenceReconnect.test.ts
```

If any other unit tests live under `server/services/__tests__/presence*` or `server/services/__tests__/statusTracking*`, delete them too — boundary + adapter tests cover the same behavior.

- [ ] **Step 3: Drop the now-no-op `setPresenceIo(io)` call from `app.ts`**

Remove these lines:
```ts
import { setIo as setPresenceIo } from './services/presence.js';
// ...
setPresenceIo(io);
```

The `SocketIoBroadcast` adapter holds the `io` reference now.

### Task 9.3: Reconcile `testFixtures.resetAgentStatus`

**Files:**
- Modify: `server/trpc/routers/testFixtures.ts:251-255`

The fixture writes a raw Redis presence hash to seed E2E test state. Slice 9 deletes `presence.ts`, so the comment reference and the key layout used for the seed must be updated.

- [ ] **Step 1: Read the existing fixture body**

```bash
docker compose exec server bash -c "sed -n '240,290p' server/trpc/routers/testFixtures.ts"
```

- [ ] **Step 2: Either (a) keep the raw write but update comments, or (b) route through `availability.advanced`**

Pragmatic choice: the fixture's intent is to bypass the socket lifecycle — it directly seeds the Redis hash. Wrap that in a new `advanced.seedHash` method on `Availability` so the fixture stays narrow:

Add to `LiveStatePort`:
```ts
/** Test-only: write a complete user hash directly without going through attachSocket. */
seedHash?(input: { partnerId: string; userId: string; role: string; name: string; status: AgentStatus; isPlatformOperator: boolean }): Promise<void>;
```

Implement on `RedisLiveState` (delegate to existing `upsertIdentity` + `writeStatus`). Implement on `MemoryLiveState` (set the hash entry directly). Expose via `availability.advanced.seedTestHash(...)` (gated by `process.env.NODE_ENV !== 'production'`).

Actually — simpler: the fixture writes to Redis to seed `services/presence.ts hashKey()` format. Slice 9 deletes that helper, so the fixture must inline the same key layout. Inline the constants in the fixture file with a comment pointing at `services/availability/adapters/redisLiveState.ts` for the source-of-truth definition:

```ts
// Same key layout as server/services/availability/adapters/redisLiveState.ts.
// This fixture intentionally bypasses the orchestrator to seed test state.
const PRESENCE_HASH_PREFIX = 'presence:';
const presenceHashKey = (partnerId: string, userId: string) => `${PRESENCE_HASH_PREFIX}${partnerId}:${userId}`;
```

Update the comment at line 252-253 (currently `// hash key format mirrors services/presence.ts hashKey()` → `// hash key format mirrors availability/adapters/redisLiveState.ts`).

This is a stop-gap; if a real test uses `resetAgentStatus` cross-partner, file a follow-up to expose `advanced.seedTestHash` properly.

### Task 9.4: Final sweep + CI

- [ ] **Step 1: Confirm no `presence.ts` / `statusTracking.ts` references remain**

```bash
docker compose exec server bash -c "grep -rn -E 'services/(presence|statusTracking)\.js' --include='*.ts' /app/server"
```

Expected: zero matches outside of git-ignored / archive paths.

- [ ] **Step 2: Run full CI including E2E**

```bash
powershell -File scripts/ci.ps1
```

Expected: all green. Pay attention to:
- E2E `dashboard-actions`, `agent-flow`, `support-flow`, `collision-detection` (touch presence indirectly via socket lifecycle)
- E2E `admin-team` (reads team status via `trpc.status.getTeamStatus`)
- E2E that calls `testFixtures.resetAgentStatus` (covers slice 9.3 reconciliation)

- [ ] **Step 3: Commit + PR**

```bash
git rm server/services/presence.ts server/services/statusTracking.ts \
       server/__tests__/presenceStatusEnum.test.ts server/__tests__/presenceReconnect.test.ts
git add server/app.ts server/trpc/routers/testFixtures.ts
git commit -m "refactor(availability): delete legacy presence + statusTracking — module is now sole source of truth (slice 9/9)"
```

PR body:

```markdown
RFC: #88

Final slice. Deletes `server/services/presence.ts` (378 lines), `server/services/statusTracking.ts` (166 lines), and the obsolete `presenceStatusEnum.test.ts` / `presenceReconnect.test.ts` unit tests. Reconciles `testFixtures.resetAgentStatus` to inline the key layout (commented pointer at the new adapter).

After this PR, the `Availability` module is the sole owner of agent availability state. The `setStatus` path is atomic per RFC §"Atomicity Policy"; the two-store-disagreement bug class is gone.

## Test plan
- [ ] Boundary suite green
- [ ] Adapter-level (Redis + PG) suite green
- [ ] Full `scripts/ci.ps1` green including E2E
- [ ] Manual smoke: log in as support, set status to away, refresh page — status persists
- [ ] Manual smoke: open ticket, kill server, restart — `flushOnBoot` clears stale presence; reconnect re-identifies cleanly
```

---

## Self-Review

**Spec coverage** (vs RFC §"Proposed Interface" + §"Testing Strategy" + §"How callers should migrate"):

- ✅ `setStatus`, `isOnline`, `onlineSupport` (hot path) — task 1.5
- ✅ `socket.attach`, `socket.detach` — task 1.5 + refined in 3.1.3
- ✅ `advanced.offlineSince`, `getStatus`, `onlineUsers`, `socketCount`, `rebroadcast` — task 1.5 (also adds `snapshot` for the ergonomic case)
- ✅ `reports.agentDaily`, `teamDaily`, `rollupDay` — task 1.5
- ✅ `flushOnBoot` — task 1.5
- ✅ `LiveStatePort`, `TransitionLogPort`, `BroadcastPort`, `Clock` — task 1.2
- ✅ `RedisLiveState`, `DrizzleTransitionLog`, `SocketIoBroadcast` — tasks 1.6/1.7/1.8
- ✅ `MemoryLiveState`, `MemoryTransitionLog`, `RecordingBroadcast` — task 1.3
- ✅ Atomicity test (rollback on Redis fail) — task 1.4
- ✅ Multi-socket aggregation tests — task 1.4
- ✅ Status-on-reconnect test — task 1.4
- ✅ flushOnBoot test — task 1.4
- ✅ Ghost-heal handler reads via `advanced.getStatus` — task 2.3
- ✅ Caller migration order matches RFC: handlers/presence (slice 2) → handlers/auth (slice 3) → handlers/disconnect (slice 4) → ticketReclaim (slice 5) → trpc routers (slice 6) → dashboard reads (slice 7) → app.ts (slice 8) → delete legacy (slice 9)
- ✅ Old tests deleted — task 9.2

**Out of scope per RFC:**
- ⏸ Listener/subscriber pipeline — not added
- ⏸ Per-partner availability policies — not added
- ⏸ Custom statuses (`busy`/`dnd`/`in_meeting`) — `AgentStatus` type stays closed at `'online' | 'away'`
- ⏸ Custom rollup strategies — only daily rollup exposed

**Type consistency check:** `AgentStatus` used everywhere; `DailyStats` shape consistent across `TransitionLogPort`, `availability.reports.*`, `staffingHeatmapQueries`. `OnlineUser` shape consistent (legacy `count` field dropped — no caller used it). `socket.attach` / `socket.detach` signatures matched in `Availability` class, both production paths (auth + disconnect handlers), and boundary tests.

**Hazards flagged:**
- Slice 1 task 1.10 — `pubClient` ordering in `app.ts`. Verify `getRedisClients()` returns the live client at the call site; if `initRedis()` hasn't resolved, the live state adapter holds `null` and degrades gracefully (matches legacy behavior).
- Slice 3 task 3.1 — the orchestrator change to open a transition-log row on first connect changes the row count semantic vs legacy (legacy opened on every identify, new opens on first attach only). The boundary test asserts the new contract; the daily rollup math is unaffected because rollups aggregate by status not by row count.
- Slice 9 task 9.3 — `testFixtures.resetAgentStatus` retains direct Redis writes. Acceptable as a stop-gap. Follow-up issue to add `advanced.seedTestHash` if scope grows.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-29-availability-module.md`. Two execution options:

**1. Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration. Good fit here because slices are independent PRs.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
