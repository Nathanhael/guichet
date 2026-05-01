# Availability Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `services/presence.ts` (~430 lines, Redis live state) and `services/statusTracking.ts` (~185 lines, PG transition log) with a single `Availability` deep module that owns the two-store coordination as one atomic concept. Five callers — two socket handlers, one tRPC router, one ticket-reclaim service, one app-boot wiring — collapse to a 1-line invocation each.

**Architecture:** `server/services/availability/` ships an `Availability` class with three injected ports (`LiveStatePort`, `TransitionLogPort`, `BroadcastPort`) plus a `Clock`. Production adapters wrap the existing Redis Lua scripts + Drizzle SQL + Socket.io rooms verbatim; memory adapters in `test-stubs.ts` enable pure-memory boundary tests (~50ms vs. the existing ~30s with Redis spin-up). The class is constructed once at boot and registered via `setAvailability` / `getAvailability` (matches the `Moderator` precedent shipped in PRs #91-95). The atomicity contract — "write PG row first, then Redis, then broadcast; on Redis failure, roll back the PG row" — is owned by the module and enforced by the boundary tests.

**Tech Stack:** TypeScript + Node 20, Vitest + node, PGLite test substrate (existing `createTestDb` harness), Drizzle ORM, redis client, Socket.io. Docker-only commands. `docker compose restart server` after every server edit (tsx watch unreliable on Windows bind mount). Verify via `powershell -File scripts/ci.ps1`.

**Parent issue:** [#88](https://github.com/Nathanhael/guichet/issues/88). Sibling to [#89](https://github.com/Nathanhael/guichet/issues/89) (moderator deepening, shipped in PRs #91-95). Independent work; the `Availability` precedent will mirror the `Moderator` shape.

---

## Pre-flight: Decisions Locked Before Coding

### D1. `Availability` is a class with constructor-injected deps + a small registry — matches `Moderator` precedent.

Constructor: `new Availability({ live, log, broadcast, clock, logger })`. Single instance constructed in `app.ts` after `setIo` runs and Redis is ready. Registry pair (`setAvailability` / `getAvailability`) lives in `services/availability/instance.ts`. Tests construct a `new Availability({ live: new MemoryLiveState(), log: new MemoryTransitionLog(), broadcast: new RecordingBroadcast(), clock: () => fixedDate })` directly and pass it to handler factories.

### D2. Atomicity policy is **PG-first, Redis-second, broadcast-last**.

The current code has a real bug: `setUserStatus()` writes Redis without PG, and `logTransition()` writes PG without Redis. They drift on partial failure. The new policy:

1. `transitionLog.openRow({ status })` — PG insert/update (transactional within Drizzle)
2. `liveState.writeStatus({ status })` — Redis HSET
3. `broadcast.supportOnline(roster)` — Socket.io emit

If step 2 fails, step 3 is skipped AND the open row in step 1 is rolled back via `transitionLog.closeOpenRow + reopen with previous status`. Boundary tests in slice 1 verify this contract.

The reverse order on `socket.detach` (close PG row → mark Redis offline → broadcast) is also enforced. The contract for read-only paths (`isOnline`, `onlineSupport`, reports) reads through the appropriate port without coordination.

### D3. The 11-method public surface is grouped into 4 namespaces.

Per RFC: `setStatus` / `isOnline` / `onlineSupport` are the hot path (top-level). `socket.attach` / `socket.detach` are the lifecycle namespace. `advanced.*` are escape hatches (offlineSince, getStatus, onlineUsers, socketCount, rebroadcast). `reports.*` are PG-only reads (agentDaily, teamDaily, rollupDay). The grouping is enforced by TypeScript: callers cannot accidentally reach `rollupDay` from a hot path because it lives behind `availability.reports.rollupDay`.

### D4. `LiveStatePort` accepts `partnerId` first; key layout stays an internal detail.

Today's `presence.ts` exposes `setUserStatus(userId, partnerId, status)` (userId first, partnerId second). The new port uses `partnerId, userId` because every key in Redis is namespaced by partner — the natural read path is "for this partner, find this user." Boundary tests prove the swap doesn't leak through the public surface (Availability re-orders for callers).

### D5. `RedisLiveState` keeps the two existing Lua scripts verbatim.

Slice 1 cuts and pastes the `identifyUser` and `decrementUserCount` Lua strings into `RedisLiveState.attachSocket()` and `RedisLiveState.detachSocket()`. The Lua text doesn't change; only its location does. Same `presence:` / `partner:presence:` / `presence:offline_at:` key prefixes preserved. Slice 5 deletes `services/presence.ts` once the migration is complete; Lua lives in `availability/adapters/redisLiveState.ts` thereafter.

### D6. `MemoryLiveState` accepts a `BroadcastPort` reference for parity with Redis multi-socket aggregation.

The Redis path uses `SCARD(sockets)` for "online iff at least one socket attached." The memory adapter uses a `Map<userKey, Set<socketId>>` and the same SCARD-shaped invariant. No fake socket connections — just attach/detach pairs that mutate the set.

### D7. `BroadcastPort` is constructor-injected — no `setIo()` mutator.

Today's `services/presence.ts:setIo(io)` is a module-level mutator that handlers can forget to call. The new `BroadcastPort` is passed at construction. `SocketIoBroadcast` wraps the Socket.io server reference; `RecordingBroadcast` (test stub) appends to an array callers can assert against. The boot order in `app.ts` becomes: create `io` → construct `Availability({ broadcast: new SocketIoBroadcast(io), ... })` → `setAvailability(...)`.

### D8. Status preservation on reconnect is **policy in code, not Lua string**.

Today's `identifyUser` Lua has a "preserve status if hash exists" branch. The new `Availability.socket.attach()` reads the existing status (via port), then calls `liveState.writeStatus` only when there's no prior status (else it's a no-op). The Lua script in `RedisLiveState.attachSocket` becomes simpler — it just adds the socket to the set and refreshes TTL — and the preserve-on-reconnect logic is visible in TypeScript. Boundary test asserts: away → reconnect → still away.

### D9. `flushOnBoot()` is a top-level method, not under `advanced.*`.

Per RFC: `availability.flushOnBoot()`. Not nested under `advanced.*` because boot is part of the lifecycle, not an escape hatch. Called once from `app.ts` after `setAvailability(...)`.

### D10. `testFixtures.resetAgentStatus` does NOT migrate to `Availability`.

`server/trpc/routers/testFixtures.ts:resetAgentStatus` writes Redis presence hash + PG status_log row directly to stage test state. Migrating it would force boundary tests for the test fixture itself, plus the fixture's "stage state before identification" semantic doesn't fit `Availability.socket.attach()` (which expects a live socket). Leave testFixtures.resetAgentStatus untouched; it stays a low-level escape hatch that knows the key layout. **Slice 5 adds a comment in testFixtures noting the layout dependency** so a future Redis-key rename catches the file.

### D11. `services/dashboard/staffingHeatmapQueries.ts` is touched in slice 4 only if it imports presence or statusTracking.

Spot-check first: a quick grep confirms whether dashboard reads either service. If not, the RFC's mention of "staffing heatmap" is residual from an earlier draft and the file stays unchanged.

### D12. Behavior preservation: every existing externally-observable property is preserved.

Same as the moderator deepening's intentional-preservation list. Specifically:
- `clearOfflineAt` is called on identify (not removed)
- `setOfflineAt` is called on full disconnect only (last-socket-out)
- `support:online` event payload shape (`SupportEntry[]`) unchanged
- `agents:online` event payload shape (`string[]`) unchanged
- Room names `partner:{id}` and `partner:{id}:staff` unchanged
- Per-partner Redis sets remain TTL'd at 24h
- The 5-minute idle-away client behavior (managed in `useIdleStatus`) is unchanged
- `presence:offline_at:{partnerId}:{userId}` 24h TTL preserved

### D13. The 5-PR sequence: install → status:set + support:leave → socket lifecycle → reads → boot wiring + delete.

| # | Slice | Behavior change |
|---|---|---|
| 1 | Install `services/availability/` + ports + memory adapters + boundary tests. **Zero callers migrated.** | None. |
| 2 | Migrate `socket/handlers/presence.ts` (`status:set`, `support:leave`). **Closes the 2-store atomicity bug.** | Atomicity contract enforced: status updates are either fully visible or fully rolled back. |
| 3 | Migrate `socket/handlers/auth.ts` (identify path) + `socket/handlers/disconnect.ts`. | None — same observable behavior, different orchestration owner. |
| 4 | Migrate `trpc/routers/status.ts` + `trpc/routers/presence.ts` + `services/ticketReclaim.ts` (read-side). | None. |
| 5 | Migrate `app.ts` (boot flush + daily cron) + delete `services/presence.ts` + `services/statusTracking.ts`. | None — pure deletion of legacy. |

---

## File Structure

### Slice 1 — install Availability module

| File | Action | Responsibility |
|---|---|---|
| `server/services/availability/index.ts` | Create | `Availability` class + `AgentStatus` / `SupportEntry` / `AvailabilitySnapshot` / `DailyStats` types + namespace bindings |
| `server/services/availability/instance.ts` | Create | `setAvailability` / `getAvailability` registry (matches `Moderator/instance.ts`) |
| `server/services/availability/ports.ts` | Create | `LiveStatePort`, `TransitionLogPort`, `BroadcastPort`, `Clock` interfaces |
| `server/services/availability/policy.ts` | Create | The atomicity-coordinated logic: `setStatusInternal`, `attachInternal`, `detachInternal`, status preservation on reconnect |
| `server/services/availability/adapters/redisLiveState.ts` | Create | `RedisLiveState` — wraps existing Lua + key layout from `presence.ts` |
| `server/services/availability/adapters/drizzleTransitionLog.ts` | Create | `DrizzleTransitionLog` — wraps existing SQL from `statusTracking.ts` |
| `server/services/availability/adapters/socketIoBroadcast.ts` | Create | `SocketIoBroadcast` — wraps existing room/event names from `presence.ts` broadcasts |
| `server/services/availability/test-stubs.ts` | Create | `MemoryLiveState`, `MemoryTransitionLog`, `RecordingBroadcast`, `FixedClock` |
| `server/services/availability/availability.test.ts` | Create | 12 boundary tests covering atomicity contract, multi-socket aggregation, status preservation, fail-paths |
| `server/app.ts` | Modify | Construct `Availability` after `io` + Redis init, register via `setAvailability`, call `flushOnBoot` |

### Slice 2 — migrate `socket/handlers/presence.ts`

| File | Action | Responsibility |
|---|---|---|
| `socket/handlers/types.ts` | Modify | Add `availability: Availability` to `HandlerContext` |
| `server/socket/handlers.ts` | Modify | Pass the boot-time `Availability` into `HandlerContext` |
| `socket/handlers/presence.ts` | Modify | Replace `status:set` 3-call dance with `availability.setStatus(...)`. Replace `support:leave` ghost-decision Redis read with `availability.isOnline(...)`. Replace `support:join` ghost-decision read with `availability.advanced.getStatus(...)`. |
| `app.ts` | Modify | Pass `availability` into `registerSocketHandlers`. |

### Slice 3 — migrate `socket/handlers/auth.ts` + `socket/handlers/disconnect.ts`

| File | Action | Responsibility |
|---|---|---|
| `socket/handlers/auth.ts` | Modify | Replace `presenceService.identifyUser` + `broadcastOnlineSupport` + `broadcastOnlineAgents` + `getUserStatus` + `statusTracking.logTransition` with one `availability.socket.attach({ ... })`. |
| `socket/handlers/disconnect.ts` | Modify | Replace `presenceService.decrementUserCount` + `broadcastOnlineAgents` + `statusTracking.closeOpenRow` with one `availability.socket.detach({ ... })`. |

### Slice 4 — read-side migrations

| File | Action | Responsibility |
|---|---|---|
| `trpc/routers/status.ts` | Modify | Replace `presenceService.getOnlineUsersForPartner` with `availability.advanced.onlineUsers`. Replace `statusTracking.getAgentDailyStats` / `getTeamDailyStats` with `availability.reports.agentDaily` / `teamDaily`. |
| `trpc/routers/presence.ts` | Modify | Replace `presenceService.getOnlineUsersForPartner` + `setUserStatus` with availability equivalents. |
| `trpc/routers/support.ts` | Modify | Replace `getOnlineUsersForPartner` import with `availability.advanced.onlineUsers`. |
| `services/ticketReclaim.ts` | Modify | Replace `getOfflineAt` + `getUserStatus` from `presence.js` with `availability.advanced.offlineSince` + `getStatus`. |

### Slice 5 — boot wiring + delete legacy

| File | Action | Responsibility |
|---|---|---|
| `app.ts` | Modify | Drop `setPresenceIo`, `flushPresenceOnStartup`, `rollupDay` imports. Replace daily cron's `rollupDay(partnerId, date)` with `availability.reports.rollupDay(partnerId, date)`. |
| `services/presence.ts` | Delete | Replaced by `availability/adapters/redisLiveState.ts` + `availability/adapters/socketIoBroadcast.ts`. |
| `services/statusTracking.ts` | Delete | Replaced by `availability/adapters/drizzleTransitionLog.ts`. |
| `trpc/routers/testFixtures.ts` | Modify | Add comment near `resetAgentStatus` noting the Redis key layout dependency (D10). |
| Various test files | Modify | Drop any imports of the deleted services + remove inline mocks. |

---

## Slice 1: Install Availability Module (Parallel — No Caller Migrated)

**PR title:** `feat(availability) slice 1: install Availability module + Redis/Drizzle/SocketIO + memory adapters + boundary tests`
**Verifies:** `powershell -File scripts/ci.ps1`
**Behavior change:** None. Module installed, registered at boot, but unused.

### Task 1.1: Public types + Availability class shell

**Files:**
- Create: `server/services/availability/index.ts`

- [ ] **Step 1: Write the file**

```ts
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
```

- [ ] **Step 2: Commit**

```bash
git add server/services/availability/index.ts
git commit -m "feat(availability): public types + Availability class shell"
```

---

### Task 1.2: Port interfaces

**Files:**
- Create: `server/services/availability/ports.ts`

- [ ] **Step 1: Write the file**

```ts
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
```

- [ ] **Step 2: Commit**

```bash
git add server/services/availability/ports.ts
git commit -m "feat(availability): port interfaces (LiveState / TransitionLog / Broadcast / Clock)"
```

---

### Task 1.3: Memory test adapters

**Files:**
- Create: `server/services/availability/test-stubs.ts`

- [ ] **Step 1: Write the file**

```ts
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
      const [, userId] = key.split(':');
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
```

- [ ] **Step 2: Commit**

```bash
git add server/services/availability/test-stubs.ts
git commit -m "test(availability): MemoryLiveState + MemoryTransitionLog + RecordingBroadcast + FixedClock"
```

---

### Task 1.4: Policy module (atomicity-coordinated logic)

**Files:**
- Create: `server/services/availability/policy.ts`

- [ ] **Step 1: Write the file**

```ts
// server/services/availability/policy.ts
import type { AgentStatus, AvailabilityDeps } from './index.js';

/**
 * Set status with PG-first / Redis-second / broadcast-last atomicity. On
 * Redis-write failure, the PG row is rolled back to whatever the user's
 * prior status was (or the open row is closed if there was no prior state).
 */
export async function runSetStatus(
  deps: AvailabilityDeps,
  args: { userId: string; partnerId: string; status: AgentStatus },
): Promise<void> {
  const now = deps.clock.now();
  const prevStatus = await deps.live.readStatus(args.partnerId, args.userId);
  if (!prevStatus) {
    // No-op: user never identified. Matches today's `setUserStatus` no-op.
    return;
  }

  // 1. PG: open a new row (closes any previous open row).
  await deps.log.openRow({
    userId: args.userId,
    partnerId: args.partnerId,
    status: args.status,
    startedAt: now,
  });

  // 2. Redis: write status.
  try {
    await deps.live.writeStatus(args.partnerId, args.userId, args.status);
  } catch (err) {
    // Roll back the PG row by reopening with the previous status.
    deps.logger?.error(
      { err: err instanceof Error ? err.message : String(err), userId: args.userId },
      '[availability] live.writeStatus failed — rolling back PG row',
    );
    await deps.log.openRow({
      userId: args.userId,
      partnerId: args.partnerId,
      status: prevStatus,
      startedAt: now,
    });
    throw err;
  }

  // 3. Broadcast: support roster updated.
  const roster = (await deps.live.listOnline(args.partnerId))
    .filter((u) => u.role === 'support' && !u.isPlatformOperator)
    .map((u) => ({ userId: u.userId, name: u.name, status: u.status as AgentStatus }));
  deps.broadcast.supportOnline(args.partnerId, roster);
}

/**
 * Attach a socket. On first attach, identity is upserted with initial status
 * 'online'. On reconnect (existing identity), status is preserved. Always
 * clears the offline-at marker (the user has at least one socket again).
 */
export async function runAttach(
  deps: AvailabilityDeps,
  args: {
    userId: string;
    partnerId: string;
    socketId: string;
    role: string;
    name: string;
    isPlatformOperator?: boolean;
  },
): Promise<void> {
  const now = deps.clock.now();
  const isPlatOp = args.isPlatformOperator ?? false;

  // 1. PG: open row only on first attach (no previous identity).
  const prevStatus = await deps.live.readStatus(args.partnerId, args.userId);
  if (!prevStatus) {
    await deps.log.openRow({
      userId: args.userId,
      partnerId: args.partnerId,
      status: 'online',
      startedAt: now,
    });
  }
  // On reconnect, the PG row stays whatever the previous status was — the
  // existing logTransition was called on disconnect's closeOpenRow, so the
  // log restart happens here only when no prior identity existed.

  // 2. Redis: upsert identity (preserves status if hash exists), attach socket.
  await deps.live.upsertIdentity({
    partnerId: args.partnerId,
    userId: args.userId,
    name: args.name,
    role: args.role,
    isPlatformOperator: isPlatOp,
    initialStatus: 'online',
  });
  await deps.live.attachSocket(args.partnerId, args.userId, args.socketId);
  await deps.live.clearOfflineAt(args.partnerId, args.userId);

  // 3. On reconnect with prior status, reopen the PG row with the preserved
  //    status so the log reflects "online again with their preserved status."
  if (prevStatus) {
    await deps.log.openRow({
      userId: args.userId,
      partnerId: args.partnerId,
      status: prevStatus,
      startedAt: now,
    });
  }

  // 4. Broadcast: support roster + agents list (matches today's auth.ts).
  const isSupport = args.role === 'support' || args.role === 'admin' || isPlatOp;
  if (isSupport) {
    const roster = (await deps.live.listOnline(args.partnerId))
      .filter((u) => u.role === 'support' && !u.isPlatformOperator)
      .map((u) => ({
        userId: u.userId,
        name: u.name,
        status: u.status as AgentStatus,
      }));
    deps.broadcast.supportOnline(args.partnerId, roster);
  }
  if (args.role === 'agent') {
    const ids = (await deps.live.listOnline(args.partnerId))
      .filter((u) => u.role === 'agent')
      .map((u) => u.userId);
    deps.broadcast.agentsOnline(args.partnerId, ids);
  }
}

/**
 * Detach a socket. Only marks offline + closes PG row + broadcasts on the
 * full-offline transition (last socket out). Multi-socket users (e.g. two tabs)
 * see only an internal SREM with no observable change.
 */
export async function runDetach(
  deps: AvailabilityDeps,
  args: { userId: string; partnerId: string; socketId: string },
): Promise<{ removed: boolean; role: string | null }> {
  const now = deps.clock.now();

  // Snapshot role before any state changes — we need it for the post-detach broadcast.
  const list = await deps.live.listOnline(args.partnerId);
  const userRow = list.find((u) => u.userId === args.userId);
  const role = userRow?.role ?? null;
  const isPlatOp = userRow?.isPlatformOperator ?? false;

  const { socketCount } = await deps.live.detachSocket(
    args.partnerId,
    args.userId,
    args.socketId,
  );

  if (socketCount > 0) {
    return { removed: false, role };
  }

  // Full-offline transition.
  await deps.live.markOfflineAt(args.partnerId, args.userId, now);
  await deps.log.closeOpenRow({
    userId: args.userId,
    partnerId: args.partnerId,
    endedAt: now,
  });

  if (role === 'support' || role === 'admin' || isPlatOp) {
    const roster = (await deps.live.listOnline(args.partnerId))
      .filter((u) => u.role === 'support' && !u.isPlatformOperator)
      .map((u) => ({
        userId: u.userId,
        name: u.name,
        status: u.status as AgentStatus,
      }));
    deps.broadcast.supportOnline(args.partnerId, roster);
  }
  if (role === 'agent') {
    const ids = (await deps.live.listOnline(args.partnerId))
      .filter((u) => u.role === 'agent')
      .map((u) => u.userId);
    deps.broadcast.agentsOnline(args.partnerId, ids);
  }

  return { removed: true, role };
}
```

- [ ] **Step 2: Commit**

```bash
git add server/services/availability/policy.ts
git commit -m "feat(availability): policy module — atomicity-coordinated set/attach/detach"
```

---

### Task 1.5: Boundary tests

**Files:**
- Create: `server/services/availability/availability.test.ts`
- Update: `.gitignore` (allowlist entry — same pattern as moderator slice 1)

- [ ] **Step 1: Add `.gitignore` allowlist entry**

In `.gitignore`, find the test allowlist block (~line 96) and add:

```
!server/services/availability/*.test.ts
```

- [ ] **Step 2: Write the failing test file**

```ts
// server/services/availability/availability.test.ts
import { describe, expect, it, beforeEach } from 'vitest';
import { Availability } from './index.js';
import {
  FixedClock,
  MemoryLiveState,
  MemoryTransitionLog,
  RecordingBroadcast,
} from './test-stubs.js';

const PARTNER_A = 'p-acme';
const ALICE = 'u-alice';
const BOB = 'u-bob';

describe('Availability', () => {
  let live: MemoryLiveState;
  let log: MemoryTransitionLog;
  let broadcast: RecordingBroadcast;
  let clock: FixedClock;
  let availability: Availability;

  beforeEach(() => {
    live = new MemoryLiveState();
    log = new MemoryTransitionLog();
    broadcast = new RecordingBroadcast();
    clock = new FixedClock(new Date('2026-05-01T10:00:00Z'));
    availability = new Availability({ live, log, broadcast, clock });
  });

  describe('socket.attach', () => {
    it('opens PG row + upserts Redis identity + broadcasts support roster on first attach', async () => {
      await availability.socket.attach({
        userId: ALICE, partnerId: PARTNER_A, socketId: 'sock-1',
        role: 'support', name: 'Alice',
      });

      expect(log.rows).toHaveLength(1);
      expect(log.rows[0]).toMatchObject({ userId: ALICE, status: 'online', endedAt: null });

      expect(await availability.isOnline(ALICE, PARTNER_A)).toBe(true);
      expect(await availability.advanced.getStatus(ALICE, PARTNER_A)).toBe('online');

      const supportEvents = broadcast.events.filter((e) => e.type === 'supportOnline');
      expect(supportEvents).toHaveLength(1);
      expect(supportEvents[0].payload).toEqual([
        { userId: ALICE, name: 'Alice', status: 'online' },
      ]);
    });

    it('preserves status on reconnect (away → reconnect → still away)', async () => {
      await availability.socket.attach({
        userId: ALICE, partnerId: PARTNER_A, socketId: 'sock-1',
        role: 'support', name: 'Alice',
      });
      await availability.setStatus(ALICE, PARTNER_A, 'away');
      await availability.socket.detach({ userId: ALICE, partnerId: PARTNER_A, socketId: 'sock-1' });

      // Reconnect.
      clock.advance(60_000);
      await availability.socket.attach({
        userId: ALICE, partnerId: PARTNER_A, socketId: 'sock-2',
        role: 'support', name: 'Alice',
      });

      expect(await availability.advanced.getStatus(ALICE, PARTNER_A)).toBe('away');
    });

    it('clears offlineAt on attach', async () => {
      await availability.socket.attach({
        userId: ALICE, partnerId: PARTNER_A, socketId: 'sock-1',
        role: 'support', name: 'Alice',
      });
      await availability.socket.detach({ userId: ALICE, partnerId: PARTNER_A, socketId: 'sock-1' });
      expect(await availability.advanced.offlineSince(ALICE, PARTNER_A)).not.toBeNull();

      await availability.socket.attach({
        userId: ALICE, partnerId: PARTNER_A, socketId: 'sock-2',
        role: 'support', name: 'Alice',
      });
      expect(await availability.advanced.offlineSince(ALICE, PARTNER_A)).toBeNull();
    });
  });

  describe('socket.detach', () => {
    it('does NOT mark offline when other sockets remain', async () => {
      await availability.socket.attach({
        userId: ALICE, partnerId: PARTNER_A, socketId: 'sock-1',
        role: 'support', name: 'Alice',
      });
      await availability.socket.attach({
        userId: ALICE, partnerId: PARTNER_A, socketId: 'sock-2',
        role: 'support', name: 'Alice',
      });

      const broadcastsBeforeDetach = broadcast.events.length;
      await availability.socket.detach({ userId: ALICE, partnerId: PARTNER_A, socketId: 'sock-1' });

      expect(await availability.isOnline(ALICE, PARTNER_A)).toBe(true);
      expect(await availability.advanced.offlineSince(ALICE, PARTNER_A)).toBeNull();
      // No new broadcast — partial drop is invisible.
      expect(broadcast.events.length).toBe(broadcastsBeforeDetach);
    });

    it('marks offline + closes PG row + broadcasts when last socket leaves', async () => {
      await availability.socket.attach({
        userId: ALICE, partnerId: PARTNER_A, socketId: 'sock-1',
        role: 'support', name: 'Alice',
      });
      const beforeDetach = broadcast.events.length;

      clock.advance(120_000);
      await availability.socket.detach({ userId: ALICE, partnerId: PARTNER_A, socketId: 'sock-1' });

      expect(await availability.isOnline(ALICE, PARTNER_A)).toBe(false);
      expect(await availability.advanced.offlineSince(ALICE, PARTNER_A)).toEqual(
        new Date('2026-05-01T10:02:00Z'),
      );

      // PG row closed with duration.
      expect(log.rows[0].endedAt).toEqual(new Date('2026-05-01T10:02:00Z'));
      expect(log.rows[0].duration).toBe(120);

      // New broadcast emitted (empty roster).
      const broadcastsAfter = broadcast.events.slice(beforeDetach);
      expect(broadcastsAfter.some((e) => e.type === 'supportOnline')).toBe(true);
    });
  });

  describe('setStatus', () => {
    it('opens new PG row + writes Redis + broadcasts on transition', async () => {
      await availability.socket.attach({
        userId: ALICE, partnerId: PARTNER_A, socketId: 'sock-1',
        role: 'support', name: 'Alice',
      });
      const beforeBroadcasts = broadcast.events.length;
      const beforeRows = log.rows.length;

      clock.advance(60_000);
      await availability.setStatus(ALICE, PARTNER_A, 'away');

      expect(await availability.advanced.getStatus(ALICE, PARTNER_A)).toBe('away');

      // Previous row closed, new row opened.
      const newRows = log.rows.slice(beforeRows);
      expect(newRows.length).toBe(1);
      expect(newRows[0]).toMatchObject({ status: 'away', endedAt: null });

      // Broadcast fired with the new status.
      const newBroadcasts = broadcast.events.slice(beforeBroadcasts);
      const supportEvent = newBroadcasts.find((e) => e.type === 'supportOnline');
      expect(supportEvent).toBeTruthy();
      expect(supportEvent!.payload).toEqual([
        { userId: ALICE, name: 'Alice', status: 'away' },
      ]);
    });

    it('is a no-op when user has not identified (no Redis hash)', async () => {
      const beforeRows = log.rows.length;
      const beforeBroadcasts = broadcast.events.length;

      await availability.setStatus(ALICE, PARTNER_A, 'away');

      expect(log.rows.length).toBe(beforeRows);
      expect(broadcast.events.length).toBe(beforeBroadcasts);
    });

    it('rolls back PG row when Redis writeStatus throws', async () => {
      await availability.socket.attach({
        userId: ALICE, partnerId: PARTNER_A, socketId: 'sock-1',
        role: 'support', name: 'Alice',
      });

      // Replace writeStatus with a throwing version for one call.
      const originalWriteStatus = live.writeStatus.bind(live);
      let firstCall = true;
      live.writeStatus = async (...a) => {
        if (firstCall) {
          firstCall = false;
          throw new Error('redis offline');
        }
        return originalWriteStatus(...a);
      };

      const beforeBroadcasts = broadcast.events.length;
      await expect(
        availability.setStatus(ALICE, PARTNER_A, 'away'),
      ).rejects.toThrow('redis offline');

      // The PG log should reflect the rollback: the latest open row's status
      // is the previous one ('online'), not the failed 'away'.
      const openRow = log.rows.find((r) => r.userId === ALICE && r.endedAt === null);
      expect(openRow?.status).toBe('online');

      // No broadcast was emitted on the failed path.
      expect(broadcast.events.length).toBe(beforeBroadcasts);
    });
  });

  describe('onlineSupport', () => {
    it('filters out platform operators and agents', async () => {
      await availability.socket.attach({
        userId: ALICE, partnerId: PARTNER_A, socketId: 's1',
        role: 'support', name: 'Alice',
      });
      await availability.socket.attach({
        userId: BOB, partnerId: PARTNER_A, socketId: 's2',
        role: 'support', name: 'Bob', isPlatformOperator: true,
      });
      await availability.socket.attach({
        userId: 'u-charlie', partnerId: PARTNER_A, socketId: 's3',
        role: 'agent', name: 'Charlie',
      });

      const roster = await availability.onlineSupport(PARTNER_A);
      expect(roster).toEqual([
        { userId: ALICE, name: 'Alice', status: 'online' },
      ]);
    });
  });

  describe('flushOnBoot', () => {
    it('clears all live state but does not touch the PG log', async () => {
      await availability.socket.attach({
        userId: ALICE, partnerId: PARTNER_A, socketId: 'sock-1',
        role: 'support', name: 'Alice',
      });
      const rowsBeforeFlush = log.rows.length;

      await availability.flushOnBoot();

      expect(await availability.isOnline(ALICE, PARTNER_A)).toBe(false);
      expect(await availability.advanced.getStatus(ALICE, PARTNER_A)).toBeNull();
      expect(log.rows.length).toBe(rowsBeforeFlush);
    });
  });

  describe('isOnline', () => {
    it('returns false for never-identified user', async () => {
      expect(await availability.isOnline('u-never', PARTNER_A)).toBe(false);
    });

    it('returns true exactly when at least one socket is attached', async () => {
      await availability.socket.attach({
        userId: ALICE, partnerId: PARTNER_A, socketId: 's1',
        role: 'support', name: 'Alice',
      });
      expect(await availability.isOnline(ALICE, PARTNER_A)).toBe(true);

      await availability.socket.detach({ userId: ALICE, partnerId: PARTNER_A, socketId: 's1' });
      expect(await availability.isOnline(ALICE, PARTNER_A)).toBe(false);
    });
  });
});
```

- [ ] **Step 3: Run tests — expect ALL PASS**

```bash
docker compose exec server npx vitest run services/availability/availability.test.ts
```

Expected: 12 passing tests.

- [ ] **Step 4: Commit**

```bash
git add .gitignore server/services/availability/availability.test.ts
git commit -m "test(availability): boundary tests covering atomicity / multi-socket / fail-paths"
```

---

### Task 1.6: Production adapters — RedisLiveState

**Files:**
- Create: `server/services/availability/adapters/redisLiveState.ts`

- [ ] **Step 1: Write the file**

Lift the Lua scripts and key layout from `services/presence.ts` verbatim. The two Lua scripts (identify and decrement) are inlined as private static fields. Public methods cover the 11 `LiveStatePort` operations.

```ts
// server/services/availability/adapters/redisLiveState.ts
import type { RedisClientType } from 'redis';
import logger from '../../../utils/logger.js';
import type { AgentStatus } from '../index.js';
import type { LiveStatePort, OnlineUserRow } from '../ports.js';

const HASH_PREFIX = 'presence:';
const SET_PREFIX = 'partner:presence:';
const SOCKETS_SUFFIX = ':sockets';
const OFFLINE_AT_PREFIX = 'presence:offline_at:';
const TTL_SECONDS = 86400;

const ATTACH_LUA = `
  local key = KEYS[1]
  local sKey = KEYS[2]
  local sockKey = KEYS[3]
  local userId = ARGV[1]
  local name = ARGV[2]
  local role = ARGV[3]
  local partnerId = ARGV[4]
  local isPlatformOp = ARGV[5]
  local ttl = tonumber(ARGV[6])
  local statusChangedAt = ARGV[7]
  local socketId = ARGV[8]

  if socketId and socketId ~= '' then
    redis.call('SADD', sockKey, socketId)
    redis.call('EXPIRE', sockKey, ttl)
  end

  local exists = redis.call('EXISTS', key)
  if exists == 0 then
    redis.call('HSET', key,
      'userId', userId, 'name', name, 'role', role,
      'partnerId', partnerId, 'isPlatformOperator', isPlatformOp,
      'status', 'online', 'statusChangedAt', statusChangedAt)
  else
    redis.call('HSET', key,
      'userId', userId, 'name', name, 'role', role,
      'partnerId', partnerId, 'isPlatformOperator', isPlatformOp)
  end
  redis.call('EXPIRE', key, ttl)
  redis.call('SADD', sKey, userId)
  redis.call('EXPIRE', sKey, ttl)
  return exists
`;

const DETACH_LUA = `
  local key = KEYS[1]
  local sKey = KEYS[2]
  local sockKey = KEYS[3]
  local userId = ARGV[1]
  local socketId = ARGV[2]

  if redis.call('EXISTS', key) == 0 then
    return -1
  end

  if socketId and socketId ~= '' then
    redis.call('SREM', sockKey, socketId)
  end

  local remaining = redis.call('SCARD', sockKey)
  if remaining <= 0 then
    redis.call('DEL', key, sockKey)
    redis.call('SREM', sKey, userId)
  end
  return remaining
`;

export interface RedisLiveStateDeps {
  redis: RedisClientType | null;
}

export class RedisLiveState implements LiveStatePort {
  constructor(private readonly deps: RedisLiveStateDeps) {}

  private hashKey(partnerId: string, userId: string): string { return `${HASH_PREFIX}${partnerId}:${userId}`; }
  private socketsKey(partnerId: string, userId: string): string { return `${HASH_PREFIX}${partnerId}:${userId}${SOCKETS_SUFFIX}`; }
  private setKey(partnerId: string): string { return `${SET_PREFIX}${partnerId}`; }
  private offlineAtKey(partnerId: string, userId: string): string { return `${OFFLINE_AT_PREFIX}${partnerId}:${userId}`; }

  async upsertIdentity(input: {
    partnerId: string; userId: string; name: string; role: string;
    isPlatformOperator: boolean; initialStatus: AgentStatus;
  }): Promise<void> {
    if (!this.deps.redis) return;
    try {
      await this.deps.redis.eval(ATTACH_LUA, {
        keys: [
          this.hashKey(input.partnerId, input.userId),
          this.setKey(input.partnerId),
          this.socketsKey(input.partnerId, input.userId),
        ],
        arguments: [
          input.userId, input.name, input.role, input.partnerId,
          input.isPlatformOperator ? '1' : '0', String(TTL_SECONDS),
          new Date().toISOString(), '',
        ],
      });
    } catch (err) {
      logger.error({ err, userId: input.userId }, '[availability/RedisLiveState] upsertIdentity failed');
    }
  }

  async attachSocket(partnerId: string, userId: string, socketId: string): Promise<{ socketCount: number }> {
    if (!this.deps.redis) return { socketCount: 0 };
    try {
      await this.deps.redis.sAdd(this.socketsKey(partnerId, userId), socketId);
      await this.deps.redis.expire(this.socketsKey(partnerId, userId), TTL_SECONDS);
      const count = await this.deps.redis.sCard(this.socketsKey(partnerId, userId));
      return { socketCount: count };
    } catch (err) {
      logger.error({ err, userId }, '[availability/RedisLiveState] attachSocket failed');
      return { socketCount: 0 };
    }
  }

  async detachSocket(partnerId: string, userId: string, socketId: string): Promise<{ socketCount: number }> {
    if (!this.deps.redis) return { socketCount: 0 };
    try {
      const result = await this.deps.redis.eval(DETACH_LUA, {
        keys: [
          this.hashKey(partnerId, userId),
          this.setKey(partnerId),
          this.socketsKey(partnerId, userId),
        ],
        arguments: [userId, socketId],
      }) as number;
      return { socketCount: Math.max(0, result) };
    } catch (err) {
      logger.error({ err, userId }, '[availability/RedisLiveState] detachSocket failed');
      return { socketCount: 0 };
    }
  }

  async socketCount(partnerId: string, userId: string): Promise<number> {
    if (!this.deps.redis) return 0;
    try {
      return await this.deps.redis.sCard(this.socketsKey(partnerId, userId));
    } catch { return 0; }
  }

  async readStatus(partnerId: string, userId: string): Promise<AgentStatus | null> {
    if (!this.deps.redis) return null;
    try {
      const v = await this.deps.redis.hGet(this.hashKey(partnerId, userId), 'status');
      return (v as AgentStatus | null) ?? null;
    } catch { return null; }
  }

  async writeStatus(partnerId: string, userId: string, status: AgentStatus): Promise<void> {
    if (!this.deps.redis) return;
    const exists = await this.deps.redis.hExists(this.hashKey(partnerId, userId), 'userId');
    if (!exists) return;
    await this.deps.redis.hSet(this.hashKey(partnerId, userId), {
      status, statusChangedAt: new Date().toISOString(),
    });
  }

  async markOfflineAt(partnerId: string, userId: string, at: Date): Promise<void> {
    if (!this.deps.redis) return;
    try {
      await this.deps.redis.set(
        this.offlineAtKey(partnerId, userId),
        at.toISOString(),
        { EX: TTL_SECONDS },
      );
    } catch (err) {
      logger.error({ err, userId }, '[availability/RedisLiveState] markOfflineAt failed');
    }
  }

  async readOfflineAt(partnerId: string, userId: string): Promise<Date | null> {
    if (!this.deps.redis) return null;
    try {
      const v = await this.deps.redis.get(this.offlineAtKey(partnerId, userId));
      if (!v) return null;
      const d = new Date(v);
      return Number.isFinite(d.getTime()) ? d : null;
    } catch { return null; }
  }

  async clearOfflineAt(partnerId: string, userId: string): Promise<void> {
    if (!this.deps.redis) return;
    try { await this.deps.redis.del(this.offlineAtKey(partnerId, userId)); }
    catch (err) { logger.error({ err, userId }, '[availability/RedisLiveState] clearOfflineAt failed'); }
  }

  async listOnline(partnerId: string): Promise<OnlineUserRow[]> {
    if (!this.deps.redis) return [];
    try {
      const memberIds = await this.deps.redis.sMembers(this.setKey(partnerId));
      if (memberIds.length === 0) return [];
      const pipeline = this.deps.redis.multi();
      for (const uid of memberIds) {
        pipeline.hGetAll(this.hashKey(partnerId, uid));
      }
      const results = await pipeline.exec();
      const out: OnlineUserRow[] = [];
      for (const r of results) {
        const data = r as unknown as Record<string, string>;
        if (data && data.userId) {
          out.push({
            userId: data.userId,
            name: data.name,
            role: data.role,
            status: data.status ?? 'online',
            isPlatformOperator: data.isPlatformOperator === '1',
          });
        }
      }
      return out;
    } catch (err) {
      logger.error({ err, partnerId }, '[availability/RedisLiveState] listOnline failed');
      return [];
    }
  }

  async flushAll(): Promise<void> {
    if (!this.deps.redis) return;
    try {
      let deleted = 0;
      let cursor: string | number = 0;
      do {
        const r = await this.deps.redis.scan(String(cursor), { MATCH: `${HASH_PREFIX}*`, COUNT: 200 });
        cursor = r.cursor;
        if (r.keys.length > 0) { await this.deps.redis.del(r.keys); deleted += r.keys.length; }
      } while (Number(cursor) !== 0);
      cursor = 0;
      do {
        const r = await this.deps.redis.scan(String(cursor), { MATCH: `${SET_PREFIX}*`, COUNT: 200 });
        cursor = r.cursor;
        if (r.keys.length > 0) { await this.deps.redis.del(r.keys); deleted += r.keys.length; }
      } while (Number(cursor) !== 0);
      logger.info({ deleted }, '[availability] Startup flush complete');
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, '[availability] flushAll failed');
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add server/services/availability/adapters/redisLiveState.ts
git commit -m "feat(availability): RedisLiveState adapter (Lua scripts + key layout from presence.ts)"
```

---

### Task 1.7: Production adapters — DrizzleTransitionLog

**Files:**
- Create: `server/services/availability/adapters/drizzleTransitionLog.ts`

- [ ] **Step 1: Write the file**

Port the SQL from `services/statusTracking.ts` verbatim. Same `agent_status_log` and `daily_agent_status` tables, same idempotent UPSERT for the rollup, same date-range queries.

```ts
// server/services/availability/adapters/drizzleTransitionLog.ts
import { eq, and, isNull, sql, gte, lte } from 'drizzle-orm';
import type { db as _db } from '../../../db/postgres.js';
import { agentStatusLog, dailyAgentStatus } from '../../../db/schema.js';
import logger from '../../../utils/logger.js';
import type { AgentStatus, DailyStats } from '../index.js';
import type { TransitionLogPort } from '../ports.js';

export interface DrizzleTransitionLogDeps {
  db: typeof _db;
}

export class DrizzleTransitionLog implements TransitionLogPort {
  constructor(private readonly deps: DrizzleTransitionLogDeps) {}

  async openRow(input: { userId: string; partnerId: string; status: AgentStatus; startedAt: Date }): Promise<void> {
    const startedIso = input.startedAt.toISOString();
    try {
      const openRows = await this.deps.db
        .select().from(agentStatusLog)
        .where(and(
          eq(agentStatusLog.userId, input.userId),
          eq(agentStatusLog.partnerId, input.partnerId),
          isNull(agentStatusLog.endedAt),
        ))
        .limit(1);

      if (openRows.length > 0) {
        const r = openRows[0];
        const startedAt = new Date(r.startedAt);
        const durationSec = Math.round((input.startedAt.getTime() - startedAt.getTime()) / 1000);
        await this.deps.db.update(agentStatusLog)
          .set({ endedAt: startedIso, duration: durationSec })
          .where(eq(agentStatusLog.id, r.id));
      }

      await this.deps.db.insert(agentStatusLog).values({
        userId: input.userId,
        partnerId: input.partnerId,
        status: input.status,
        startedAt: startedIso,
      });
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err), userId: input.userId },
        '[availability/DrizzleTransitionLog] openRow error',
      );
    }
  }

  async closeOpenRow(input: { userId: string; partnerId: string; endedAt: Date }): Promise<void> {
    const endedIso = input.endedAt.toISOString();
    try {
      const openRows = await this.deps.db
        .select().from(agentStatusLog)
        .where(and(
          eq(agentStatusLog.userId, input.userId),
          eq(agentStatusLog.partnerId, input.partnerId),
          isNull(agentStatusLog.endedAt),
        ))
        .limit(1);
      if (openRows.length > 0) {
        const r = openRows[0];
        const startedAt = new Date(r.startedAt);
        const durationSec = Math.round((input.endedAt.getTime() - startedAt.getTime()) / 1000);
        await this.deps.db.update(agentStatusLog)
          .set({ endedAt: endedIso, duration: durationSec })
          .where(eq(agentStatusLog.id, r.id));
      }
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err), userId: input.userId },
        '[availability/DrizzleTransitionLog] closeOpenRow error',
      );
    }
  }

  async rollupDay(partnerId: string, dateStr: string): Promise<{ rowsWritten: number }> {
    try {
      const dayStart = `${dateStr}T00:00:00.000Z`;
      const dayEnd = `${dateStr}T23:59:59.999Z`;
      const rows = await this.deps.db.select().from(agentStatusLog).where(and(
        eq(agentStatusLog.partnerId, partnerId),
        lte(agentStatusLog.startedAt, dayEnd),
        gte(sql`COALESCE(${agentStatusLog.endedAt}, NOW()::text)`, dayStart),
      ));

      const userTotals = new Map<string, Record<string, number>>();
      for (const row of rows) {
        const start = new Date(Math.max(new Date(row.startedAt).getTime(), new Date(dayStart).getTime()));
        const end = row.endedAt
          ? new Date(Math.min(new Date(row.endedAt).getTime(), new Date(dayEnd).getTime()))
          : new Date(Math.min(Date.now(), new Date(dayEnd).getTime()));
        const seconds = Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
        if (!userTotals.has(row.userId)) userTotals.set(row.userId, { online: 0, away: 0 });
        const totals = userTotals.get(row.userId)!;
        if (totals[row.status] !== undefined) totals[row.status] += seconds;
      }

      let rowsWritten = 0;
      for (const [userId, totals] of userTotals) {
        await this.deps.db.insert(dailyAgentStatus).values({
          date: dateStr, userId, partnerId,
          onlineSeconds: totals.online, awaySeconds: totals.away,
        }).onConflictDoUpdate({
          target: [dailyAgentStatus.date, dailyAgentStatus.userId, dailyAgentStatus.partnerId],
          set: {
            onlineSeconds: sql`EXCLUDED.online_seconds`,
            awaySeconds: sql`EXCLUDED.away_seconds`,
          },
        });
        rowsWritten++;
      }
      logger.info({ partnerId, date: dateStr, userCount: userTotals.size }, '[availability] Daily rollup complete');
      return { rowsWritten };
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err), partnerId, dateStr }, '[availability/DrizzleTransitionLog] rollupDay error');
      return { rowsWritten: 0 };
    }
  }

  async agentDaily(userId: string, partnerId: string, from: string, to: string): Promise<DailyStats[]> {
    try {
      const rows = await this.deps.db.select().from(dailyAgentStatus).where(and(
        eq(dailyAgentStatus.userId, userId),
        eq(dailyAgentStatus.partnerId, partnerId),
        gte(dailyAgentStatus.date, from),
        lte(dailyAgentStatus.date, to),
      )).orderBy(dailyAgentStatus.date);
      return rows.map((r) => ({
        date: r.date, userId: r.userId, partnerId: r.partnerId,
        onlineSeconds: r.onlineSeconds, awaySeconds: r.awaySeconds,
      }));
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err), userId, partnerId }, '[availability/DrizzleTransitionLog] agentDaily error');
      return [];
    }
  }

  async teamDaily(partnerId: string, from: string, to: string): Promise<DailyStats[]> {
    try {
      const rows = await this.deps.db.select().from(dailyAgentStatus).where(and(
        eq(dailyAgentStatus.partnerId, partnerId),
        gte(dailyAgentStatus.date, from),
        lte(dailyAgentStatus.date, to),
      )).orderBy(dailyAgentStatus.date);
      return rows.map((r) => ({
        date: r.date, userId: r.userId, partnerId: r.partnerId,
        onlineSeconds: r.onlineSeconds, awaySeconds: r.awaySeconds,
      }));
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err), partnerId }, '[availability/DrizzleTransitionLog] teamDaily error');
      return [];
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add server/services/availability/adapters/drizzleTransitionLog.ts
git commit -m "feat(availability): DrizzleTransitionLog adapter (SQL from statusTracking.ts)"
```

---

### Task 1.8: Production adapters — SocketIoBroadcast

**Files:**
- Create: `server/services/availability/adapters/socketIoBroadcast.ts`

- [ ] **Step 1: Write the file**

```ts
// server/services/availability/adapters/socketIoBroadcast.ts
import type { Server } from 'socket.io';
import logger from '../../../utils/logger.js';
import type { SupportEntry } from '../index.js';
import type { BroadcastPort } from '../ports.js';

export class SocketIoBroadcast implements BroadcastPort {
  constructor(private readonly io: Server) {}

  supportOnline(partnerId: string, roster: SupportEntry[]): void {
    try {
      this.io.to(`partner:${partnerId}`).emit('support:online', roster);
      logger.debug(
        { partnerId, count: roster.length, users: roster.map((u) => `${u.userId}:${u.status}`) },
        '[availability] supportOnline broadcast',
      );
    } catch (err) {
      logger.error({ err, partnerId }, '[availability/SocketIoBroadcast] supportOnline failed');
    }
  }

  agentsOnline(partnerId: string, ids: string[]): void {
    try {
      this.io.to(`partner:${partnerId}:staff`).emit('agents:online', ids);
      logger.debug({ partnerId, count: ids.length }, '[availability] agentsOnline broadcast');
    } catch (err) {
      logger.error({ err, partnerId }, '[availability/SocketIoBroadcast] agentsOnline failed');
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add server/services/availability/adapters/socketIoBroadcast.ts
git commit -m "feat(availability): SocketIoBroadcast adapter"
```

---

### Task 1.9: Registry module

**Files:**
- Create: `server/services/availability/instance.ts`

- [ ] **Step 1: Write the file**

```ts
// server/services/availability/instance.ts
import type { Availability } from './index.js';

let instance: Availability | null = null;

export function setAvailability(a: Availability): void {
  instance = a;
}

export function getAvailability(): Availability {
  if (!instance) {
    throw new Error('Availability not initialized. setAvailability() must run before any availability-dependent path.');
  }
  return instance;
}

/** Test-only: reset between suites. */
export function __resetAvailability(): void {
  instance = null;
}
```

- [ ] **Step 2: Commit**

```bash
git add server/services/availability/instance.ts
git commit -m "feat(availability): instance registry (setAvailability / getAvailability)"
```

---

### Task 1.10: Wire `Availability` into `app.ts`

**Files:**
- Modify: `server/app.ts`

- [ ] **Step 1: Add imports**

```ts
import { Availability } from './services/availability/index.js';
import { setAvailability } from './services/availability/instance.js';
import { RedisLiveState } from './services/availability/adapters/redisLiveState.ts';
import { DrizzleTransitionLog } from './services/availability/adapters/drizzleTransitionLog.js';
import { SocketIoBroadcast } from './services/availability/adapters/socketIoBroadcast.js';
```

- [ ] **Step 2: Construct + register inside `initRedis().then(...)`**

After `setModerator(...)` and `logger.info('Moderator initialized')`:

```ts
const availability = new Availability({
  live: new RedisLiveState({ redis: pubClient ?? null }),
  log: new DrizzleTransitionLog({ db }),
  broadcast: new SocketIoBroadcast(io),
  clock: { now: () => new Date() },
  logger,
});
setAvailability(availability);
await availability.flushOnBoot();
logger.info('Availability initialized');
```

- [ ] **Step 3: Restart server + verify boot**

```bash
docker compose restart server
docker logs guichet-server-1 --tail 20
```

Expected: `Availability initialized` log line, no errors. The legacy `flushPresenceOnStartup` call is still present at this slice (it'll be removed in slice 5); both flush paths are safe to coexist because both target the same key prefixes.

- [ ] **Step 4: Commit**

```bash
git add server/app.ts
git commit -m "feat(availability): register Availability at boot via setAvailability"
```

---

### Task 1.11: CI gate for slice 1

- [ ] **Step 1: Run full local CI**

```bash
powershell -File scripts/ci.ps1 -Skip e2e
```

Expected: all 9 steps green.

- [ ] **Step 2: Open PR**

PR title: `feat(availability) slice 1: install Availability module + adapters + boundary tests`. Body should call out: zero behavior change, parallel install, `presence.ts` + `statusTracking.ts` left intact, slices 2-5 will migrate callers.

---

## Slice 2: Migrate `socket/handlers/presence.ts` (Atomicity Fix)

**PR title:** `refactor(socket) slice 2: presence handlers use Availability (atomicity fix)`
**Verifies:** `powershell -File scripts/ci.ps1`
**Behavior change:** **Closes the 2-store atomicity bug.** `status:set` now either fully succeeds (PG row + Redis + broadcast all happened) or fully rolls back (PG row reverted, no Redis write, no broadcast). Today's silent drift is no longer possible.

### Task 2.1: Add `availability` to `HandlerContext`

**Files:**
- Modify: `server/socket/handlers/types.ts`
- Modify: `server/socket/handlers.ts`

- [ ] **Step 1: Extend `HandlerContext`**

In `server/socket/handlers/types.ts`, add:

```ts
import type { Availability } from '../../services/availability/index.js';

export interface HandlerContext {
  // ... existing fields
  availability: Availability;
}
```

- [ ] **Step 2: Pass it from `registerSocketHandlers`**

In `server/socket/handlers.ts`, pass `availability` through to the `HandlerContext` constructor.

- [ ] **Step 3: Pass from `app.ts`**

```ts
registerSocketHandlers(io, {
  // ... existing fields
  availability,
});
```

- [ ] **Step 4: Commit**

```bash
git add server/socket/handlers/types.ts server/socket/handlers.ts server/app.ts
git commit -m "feat(socket): thread Availability through HandlerContext"
```

---

### Task 2.2: Migrate `status:set` and `support:leave`

**Files:**
- Modify: `server/socket/handlers/presence.ts`

- [ ] **Step 1: Drop legacy imports + replace `status:set` body**

Replace the imports at the top:

```ts
// Remove:
// import * as presenceService from '../../services/presence.js';
// import * as statusTracking from '../../services/statusTracking.js';
```

Replace the `status:set` handler:

```ts
socket.on('status:set', async (data: unknown) => {
  if (!requireIdentified(socket)) return;
  const statusParsed = validatePayload(socket, statusSetSchema, data);
  if (!statusParsed) return;
  const { status } = statusParsed;
  const actor = socketActor(socket);
  if (!actor) return;
  await ctx.availability.setStatus(actor.userId, actor.partnerId, status);
});
```

- [ ] **Step 2: Replace `support:leave` ghost-check**

Inside `support:leave`, replace:

```ts
const primaryValid =
  storedPrimary !== supportId
  && remaining.some((p: Participant) => p.id === storedPrimary)
  && (await presenceService.getUserStatus(storedPrimary, actor.partnerId)) !== null;
```

with:

```ts
const primaryValid =
  storedPrimary !== supportId
  && remaining.some((p: Participant) => p.id === storedPrimary)
  && (await ctx.availability.advanced.getStatus(storedPrimary, actor.partnerId)) !== null;
```

- [ ] **Step 3: Replace `support:join` ghost-check**

Inside `support:join`, replace:

```ts
const status = await presenceService.getUserStatus(ticket.supportId, callerPartnerId);
primaryValid = status !== null;
```

with:

```ts
const status = await ctx.availability.advanced.getStatus(ticket.supportId, callerPartnerId);
primaryValid = status !== null;
```

- [ ] **Step 4: Restart server + verify**

```bash
docker compose restart server
docker logs guichet-server-1 --tail 8
```

- [ ] **Step 5: Commit**

```bash
git add server/socket/handlers/presence.ts
git commit -m "refactor(socket): presence handlers use Availability (atomicity fix on status:set)"
```

---

### Task 2.3: CI gate for slice 2

- [ ] **Step 1**: `powershell -File scripts/ci.ps1 -Skip e2e` → green
- [ ] **Step 2**: Open PR. Body should call out the atomicity-bug closure prominently.

---

## Slice 3: Migrate `socket/handlers/auth.ts` + `disconnect.ts`

**PR title:** `refactor(socket) slice 3: auth + disconnect handlers use Availability.socket.attach/detach`
**Verifies:** `powershell -File scripts/ci.ps1`
**Behavior change:** None. Same observable behavior, different orchestration owner.

### Task 3.1: Migrate `auth.ts` identify path

**Files:**
- Modify: `server/socket/handlers/auth.ts`

- [ ] **Step 1: Replace 5-call dance with `availability.socket.attach`**

In the identify handler, replace the block from `await presenceService.identifyUser(...)` through `socket.emit('status:restored', ...)` (lines ~260-287) with:

```ts
await ctx.availability.socket.attach({
  userId,
  partnerId,
  socketId: socket.id,
  role: effectiveRole,
  name,
  isPlatformOperator: isPlatformOp,
});

// Restore persisted status to the client.
if (isSupport) {
  const persistedStatus = await ctx.availability.advanced.getStatus(userId, partnerId);
  if (persistedStatus && persistedStatus !== 'online') {
    socket.emit('status:restored', { status: persistedStatus });
  }
}
```

The room-joining (`socket.join(Rooms.partner(...))`, `socket.join(Rooms.staff(...))`, `socket.join(Rooms.user(...))`) stays in the handler — those are socket-transport concerns, not availability state.

- [ ] **Step 2: Drop legacy imports**

Remove:
```ts
import * as presenceService from '../../services/presence.js';
import * as statusTracking from '../../services/statusTracking.js';
```

- [ ] **Step 3: Restart + commit**

```bash
docker compose restart server
git add server/socket/handlers/auth.ts
git commit -m "refactor(socket): auth identify uses availability.socket.attach"
```

---

### Task 3.2: Migrate `disconnect.ts`

**Files:**
- Modify: `server/socket/handlers/disconnect.ts`

- [ ] **Step 1: Replace decrement + closeOpenRow with `availability.socket.detach`**

```ts
socket.on('disconnect', async () => {
  socketioConnectionsActive.dec();
  const userId = socket.data.userId;
  const partnerId = socket.data.partnerId;
  const userName = socket.data.name;

  // Clear typing indicators (unchanged)
  if (userId && userName) {
    for (const room of socket.rooms) {
      if (room.startsWith('ticket:')) {
        const ticketId = room.replace('ticket:', '');
        socket.to(room).emit('typing:update', { ticketId, senderName: userName, typing: false });
      }
    }
  }

  // Clear viewer tracking (unchanged)
  const affectedTickets = await removeViewerFromAll(ctx.viewerKeyPrefix, ctx.socketTickets, socket.id);
  for (const ticketId of affectedTickets) {
    await broadcastViewers(ctx.viewerKeyPrefix, ctx.io, ticketId);
  }

  if (userId && partnerId) {
    try {
      const result = await ctx.availability.socket.detach({
        userId,
        partnerId,
        socketId: socket.id,
      });
      if (result.removed && result.role === 'agent') {
        broadcastAgentStatus(userId, false);
      }
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err), userId }, '[socket] availability.detach error on disconnect');
    }
  }
});
```

Drop imports `presenceService` and `statusTracking`.

- [ ] **Step 2: Restart + commit**

```bash
docker compose restart server
git add server/socket/handlers/disconnect.ts
git commit -m "refactor(socket): disconnect uses availability.socket.detach"
```

---

### Task 3.3: CI gate for slice 3

- [ ] **Step 1**: `powershell -File scripts/ci.ps1 -Skip e2e` → green
- [ ] **Step 2**: Open PR.

---

## Slice 4: Read-Side Migrations

**PR title:** `refactor slice 4: tRPC routers + ticketReclaim use Availability`
**Verifies:** `powershell -File scripts/ci.ps1`
**Behavior change:** None.

### Task 4.1: Migrate `trpc/routers/status.ts`

**Files:**
- Modify: `server/trpc/routers/status.ts`

- [ ] **Step 1: Replace presence + statusTracking calls**

```ts
import { getAvailability } from '../../services/availability/instance.js';

// Replace `presenceService.getOnlineUsersForPartner(partnerId)` with:
const onlineUsers = await getAvailability().advanced.onlineUsers(partnerId);

// Replace `statusTracking.getAgentDailyStats(...)` with:
return getAvailability().reports.agentDaily(input.userId, partnerId, input.fromDate, input.toDate);

// Replace `statusTracking.getTeamDailyStats(...)` with:
return getAvailability().reports.teamDaily(partnerId, input.fromDate, input.toDate);
```

Drop the `presenceService` and `statusTracking` imports.

- [ ] **Step 2: Commit**

```bash
git add server/trpc/routers/status.ts
git commit -m "refactor(trpc): status router uses availability.advanced + reports"
```

---

### Task 4.2: Migrate `trpc/routers/presence.ts`

**Files:**
- Modify: `server/trpc/routers/presence.ts`

- [ ] **Step 1: Replace calls**

```ts
import { getAvailability } from '../../services/availability/instance.js';

// Replace getOnlineUsersForPartner:
const onlineUsers = await getAvailability().advanced.onlineUsers(ctx.user.partnerId);

// Replace setUserStatus:
await getAvailability().setStatus(input.userId, partnerId, input.status);
```

- [ ] **Step 2: Commit**

```bash
git add server/trpc/routers/presence.ts
git commit -m "refactor(trpc): presence router uses availability"
```

---

### Task 4.3: Migrate `trpc/routers/support.ts`

**Files:**
- Modify: `server/trpc/routers/support.ts`

- [ ] **Step 1: Replace `getOnlineUsersForPartner` import**

```ts
import { getAvailability } from '../../services/availability/instance.js';

// Replace `await getOnlineUsersForPartner(input.partnerId)` with:
const online = await getAvailability().advanced.onlineUsers(input.partnerId);
```

- [ ] **Step 2: Commit**

```bash
git add server/trpc/routers/support.ts
git commit -m "refactor(trpc): support router uses availability.advanced.onlineUsers"
```

---

### Task 4.4: Migrate `services/ticketReclaim.ts`

**Files:**
- Modify: `server/services/ticketReclaim.ts`

- [ ] **Step 1: Replace presence imports**

```ts
import { getAvailability } from './availability/instance.js';

// Replace `await getOfflineAt(ticket.supportId, ticket.partnerId)` with:
const offlineAt = await getAvailability().advanced.offlineSince(ticket.supportId, ticket.partnerId);

// Replace `await getUserStatus(...)` (if used here) with:
const status = await getAvailability().advanced.getStatus(...);
```

Drop the import `import { getOfflineAt, getUserStatus } from './presence.js';`

- [ ] **Step 2: Restart + commit**

```bash
docker compose restart server
git add server/services/ticketReclaim.ts
git commit -m "refactor(ticketReclaim): use availability.advanced.offlineSince"
```

---

### Task 4.5: CI gate for slice 4

- [ ] **Step 1**: `powershell -File scripts/ci.ps1 -Skip e2e` → green
- [ ] **Step 2**: Open PR.

---

## Slice 5: Boot Wiring + Delete Legacy

**PR title:** `chore(availability) slice 5: delete presence.ts + statusTracking.ts`
**Verifies:** `powershell -File scripts/ci.ps1`
**Behavior change:** None.

### Task 5.1: Audit final callers

- [ ] **Step 1: Confirm zero callers of legacy exports**

```bash
docker compose exec server bash -c "grep -rn 'services/presence\|services/statusTracking\|presenceService\|statusTracking\.\|getOfflineAt\|setOfflineAt\|broadcastOnlineSupport\|broadcastOnlineAgents\|getOnlineUsersForPartner\|flushPresenceOnStartup\|setIo.*Presence' /usr/src/server --include='*.ts' --exclude-dir=node_modules --exclude-dir=availability"
```

Expected: only the testFixtures.ts comment from D10 plus `services/presence.ts` / `services/statusTracking.ts` themselves remain.

- [ ] **Step 2: If anything else matches, halt and migrate it.**

---

### Task 5.2: Migrate `app.ts` boot wiring

**Files:**
- Modify: `server/app.ts`

- [ ] **Step 1: Drop legacy imports**

```ts
// Remove:
// import { setIo as setPresenceIo, flushPresenceOnStartup } from './services/presence.js';
// import { rollupDay } from './services/statusTracking.js';
```

- [ ] **Step 2: Replace `flushPresenceOnStartup()` call**

Remove the line `flushPresenceOnStartup().catch(...)`. The flush now happens inside `initRedis().then(...)` via `availability.flushOnBoot()` (added in slice 1).

- [ ] **Step 3: Replace daily-cron `rollupDay` call**

In the daily cron block (search for `[statusTracking] Hourly rollup complete`), replace:

```ts
await rollupDay(partnerId, yesterday);
```

with:

```ts
await availability.reports.rollupDay(partnerId, yesterday);
```

(The `availability` variable is in scope inside the `initRedis().then(...)` block; if the cron is set up outside that block, hoist `availability` to module scope or pass it through the cron registration.)

- [ ] **Step 4: Restart + commit**

```bash
docker compose restart server
git add server/app.ts
git commit -m "refactor(app): boot wiring uses availability.flushOnBoot + reports.rollupDay"
```

---

### Task 5.3: Add testFixtures comment (D10)

**Files:**
- Modify: `server/trpc/routers/testFixtures.ts`

- [ ] **Step 1: Add layout-dependency comment near `resetAgentStatus`**

Find the block that writes the Redis presence hash (around the `presence:${partnerId}:${userId}` key) and prepend:

```ts
// LAYOUT DEPENDENCY: this fixture writes directly to the Redis presence
// hash key layout owned by `services/availability/adapters/redisLiveState.ts`.
// If that adapter renames the prefix or changes the hash structure, update
// this fixture in lockstep — there is no shared key constant.
```

- [ ] **Step 2: Commit**

```bash
git add server/trpc/routers/testFixtures.ts
git commit -m "docs(testFixtures): note Redis presence-key dependency on availability adapter"
```

---

### Task 5.4: Delete `services/presence.ts` and `services/statusTracking.ts`

**Files:**
- Delete: `server/services/presence.ts`
- Delete: `server/services/statusTracking.ts`

- [ ] **Step 1: Delete files**

```bash
rm server/services/presence.ts server/services/statusTracking.ts
```

- [ ] **Step 2: Verify no stale imports**

```bash
docker compose exec server bash -c "grep -rn 'services/presence\|services/statusTracking' /usr/src/server --include='*.ts'"
```

Expected: zero matches.

- [ ] **Step 3: Restart + commit**

```bash
docker compose restart server
git add -u
git commit -m "chore(availability): delete services/presence.ts + services/statusTracking.ts"
```

---

### Task 5.5: Final CI gate

- [ ] **Step 1: Run full local CI**

```bash
powershell -File scripts/ci.ps1
```

Expected: all 10 steps green. E2E baseline = 16 failures per `learnings/guichet-e2e-baseline-2026-05-01` — same set, no regressions.

- [ ] **Step 2: Open final PR.** Body lists deleted files + LOC delta. Closes #88.

---

## Self-Review Checklist (Run Before Each Slice PR)

| Check | Slice 1 | Slice 2 | Slice 3 | Slice 4 | Slice 5 |
|---|---|---|---|---|---|
| `powershell -File scripts/ci.ps1` green | □ | □ | □ | □ | □ |
| No `as any` introduced | □ | □ | □ | □ | □ |
| `docker compose restart server` after every server edit | □ | □ | □ | □ | □ |
| No new `npm`/`node`/`npx` calls outside docker | □ | □ | □ | □ | □ |
| `clearOfflineAt` still called on attach (D12) | □ | □ | □ | □ | n/a |
| `setOfflineAt` still called on full disconnect only (D12) | □ | □ | □ | □ | n/a |
| `support:online` payload shape `SupportEntry[]` preserved (D12) | □ | □ | □ | □ | n/a |
| Behavior change documented in PR body | n/a | □ (atomicity) | n/a | n/a | n/a |
| Wiki page updated (`decisions/guichet-availability-deepening`) | n/a | n/a | n/a | n/a | □ |

### Spec coverage map (verifies all RFC sections land)

| RFC section | Lands in |
|---|---|
| Single `Availability` deep module | Slice 1 (`services/availability/index.ts` + `policy.ts`) |
| Hot path `setStatus` / `isOnline` / `onlineSupport` | Slice 1 (top-level methods) |
| `socket.attach` / `socket.detach` namespace | Slice 1 (`socket = { attach, detach }`) |
| `advanced.*` escape hatches | Slice 1 |
| `reports.*` PG-only namespace | Slice 1 |
| `flushOnBoot()` | Slice 1 (top-level method) |
| 4 ports + Clock | Slice 1 (`ports.ts`) |
| Memory test adapters | Slice 1 (`test-stubs.ts`) |
| Atomicity contract (PG-first / Redis-second / broadcast-last; rollback on Redis failure) | Slice 1 (`policy.ts`) + boundary test |
| Status preservation on reconnect | Slice 1 (`upsertIdentity` + boundary test) |
| Multi-socket aggregation | Slice 1 (boundary test) |
| `socket/handlers/presence.ts` migrated | Slice 2 |
| `socket/handlers/auth.ts` + `disconnect.ts` migrated | Slice 3 |
| `trpc/routers/status.ts` + `trpc/routers/presence.ts` migrated | Slice 4 |
| `services/ticketReclaim.ts` migrated | Slice 4 |
| `app.ts` boot flush + daily cron migrated | Slice 5 |
| `services/presence.ts` deleted | Slice 5 |
| `services/statusTracking.ts` deleted | Slice 5 |
| Per-partner availability policies (out of scope) | Not implemented |
| Custom statuses beyond online/away (out of scope) | Not implemented |
| Listener / subscriber pipeline (out of scope) | Not implemented |
| Custom rollup strategies (out of scope) | Not implemented |

All RFC sections accounted for.

---

## Notes for Future Sessions

- **Adapter-level integration tests.** RFC mentions adapter-level tests against real Redis + PG. They're explicitly out of slice 1's scope (boundary tests against memory adapters cover the contract; adapter-level tests add cost without commensurate signal until a real-Redis bug ships). Add when a Redis-specific regression escapes.
- **Promote shared `Clock` to `services/lifecycle/`.** Both moderator and availability take a `Clock`. Third consumer triggers the promotion; today's two are fine in their own modules.
- **AvailabilitySnapshot type is unused at slice 5.** The RFC defined it but no caller needs the bundled `{ status, online, offlineSince }` shape. Removed in slice 5 if still unused. Keep it if a real consumer surfaces during the migration.
- **Wiki page.** After slice 5 ships, write `D:\Projects_Coding\wiki\wiki\decisions\guichet-availability-deepening.md` mirroring the `guichet-moderator-deepening` precedent: ports list, intentional behavior changes, what was deleted, atomicity contract.
