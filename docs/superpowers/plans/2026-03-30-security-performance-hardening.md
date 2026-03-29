# Security & Performance Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the 3 verified security/performance gaps (instant socket revocation via Redis Pub/Sub, GIN indexes on JSONB columns, cursor-paginated message loading) and harden socket tenant isolation with a centralized guard.

**Architecture:** Four focused changes: (1) a Redis Pub/Sub revocation channel that instantly disconnects revoked sockets, replacing the 5-minute polling interval; (2) a Drizzle migration adding GIN indexes to `tickets.participants`; (3) cursor-based pagination for `findTicketMessages`; (4) a `requirePartnerScope` helper that centralizes the manual `partnerId` checks scattered across 12+ socket events.

**Tech Stack:** TypeScript, Socket.io, Redis Pub/Sub, Drizzle ORM, PostgreSQL 18, Vitest

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `server/services/sessionRevocation.ts` | Add `publishRevocation()` + `subscribeRevocationChannel()` |
| Modify | `server/socket/handlers.ts` | Subscribe to revocation channel on init, add `requirePartnerScope`, convert `requireIdentified` |
| Modify | `server/utils/redis.ts` | Export a dedicated subscriber for revocation (reuse `subClient`) |
| Create | `server/services/__tests__/sessionRevocation.test.ts` | Unit tests for publish/subscribe revocation |
| Create | `server/socket/__tests__/requirePartnerScope.test.ts` | Unit tests for the tenant isolation guard |
| Modify | `server/db/schema.ts` | Add GIN index on `tickets.participants` |
| Modify | `server/services/messageQueries.ts` | Add `findTicketMessagesPaginated()` with cursor support |
| Modify | `server/services/messageQueries.test.ts` | Tests for paginated message query (or create if absent) |
| Modify | `server/socket/handlers.ts` | Wire paginated messages into `support:join` |

---

## Phase 1: Instant Socket Revocation via Redis Pub/Sub

### Task 1: Publish revocation events to Redis channel

**Files:**
- Modify: `server/services/sessionRevocation.ts:22-45` (inside `revokeToken` and `revokeUserSessions`)
- Create: `server/services/__tests__/sessionRevocation.test.ts`

- [ ] **Step 1: Write the failing test for `publishRevocation`**

Create `server/services/__tests__/sessionRevocation.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Redis before importing module
const mockPublish = vi.fn().mockResolvedValue(1);
const mockSet = vi.fn().mockResolvedValue('OK');
const mockGet = vi.fn().mockResolvedValue(null);
vi.mock('../../utils/redis.js', () => ({
  getRedisClients: () => ({
    pubClient: { set: mockSet, get: mockGet, publish: mockPublish },
    subClient: null,
  }),
}));
vi.mock('../../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../refreshToken.js', () => ({
  revokeAllUserRefreshTokens: vi.fn().mockResolvedValue(undefined),
}));

import { revokeToken, revokeUserSessions } from '../sessionRevocation.js';

describe('sessionRevocation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('revokeToken', () => {
    it('publishes revocation event to Redis channel after revoking', async () => {
      await revokeToken('jti-123', Math.floor(Date.now() / 1000) + 300);

      // Should SET the revoked key
      expect(mockSet).toHaveBeenCalledWith(
        'auth:revoked:jti:jti-123',
        '1',
        expect.objectContaining({ EX: expect.any(Number) }),
      );

      // Should PUBLISH to the revocation channel
      expect(mockPublish).toHaveBeenCalledWith(
        'auth:session:revoked',
        expect.stringContaining('jti-123'),
      );
    });
  });

  describe('revokeUserSessions', () => {
    it('publishes user-level revocation event', async () => {
      const cutoff = Math.floor(Date.now() / 1000);
      await revokeUserSessions('user-42', cutoff);

      expect(mockPublish).toHaveBeenCalledWith(
        'auth:session:revoked',
        expect.stringContaining('user-42'),
      );
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec server npx vitest run server/services/__tests__/sessionRevocation.test.ts`
Expected: FAIL — `mockPublish` never called because `publish()` doesn't exist yet in the revocation functions.

- [ ] **Step 3: Implement `publishRevocation` and wire it into existing functions**

In `server/services/sessionRevocation.ts`, add a publish helper and call it from `revokeToken` and `revokeUserSessions`:

```typescript
// Add at top of file, after existing imports:
const REVOCATION_CHANNEL = 'auth:session:revoked';

interface RevocationEvent {
  type: 'token' | 'user';
  jti?: string;
  userId?: string;
  revokedAfter?: number;
  timestamp: number;
}

async function publishRevocation(event: RevocationEvent): Promise<void> {
  const { pubClient } = getRedisClients();
  if (!pubClient) return;
  try {
    await pubClient.publish(REVOCATION_CHANNEL, JSON.stringify(event));
  } catch (err) {
    logger.error({ err }, 'Failed to publish revocation event');
  }
}

// Export the channel name for subscribers
export { REVOCATION_CHANNEL };
export type { RevocationEvent };
```

Then add `publishRevocation` calls inside the two existing functions:

In `revokeToken`, after the successful `pubClient.set(...)` call, add:

```typescript
    await publishRevocation({ type: 'token', jti, timestamp: Date.now() });
```

In `revokeUserSessions`, after the successful `pubClient.set(userRevokedAfterKey(...), ...)` call, add:

```typescript
    await publishRevocation({ type: 'user', userId, revokedAfter: cutoff, timestamp: Date.now() });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `docker compose exec server npx vitest run server/services/__tests__/sessionRevocation.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/services/sessionRevocation.ts server/services/__tests__/sessionRevocation.test.ts
git commit -m "feat(security): publish revocation events to Redis Pub/Sub channel

Adds publishRevocation() helper that broadcasts token and user-level
revocation events to 'auth:session:revoked' channel. This enables
instant socket disconnection instead of the 5-minute polling window."
```

---

### Task 2: Subscribe to revocation channel and disconnect sockets instantly

**Files:**
- Modify: `server/socket/handlers.ts:224-274` (the `REVOCATION_CHECK_INTERVAL_MS` block and `registerSocketHandlers`)

- [ ] **Step 1: Write the failing test for revocation subscription**

Add to `server/socket/handlers.test.ts` (within the existing describe block):

```typescript
describe('Redis Pub/Sub revocation', () => {
  it('disconnects socket when its jti is revoked via Pub/Sub', async () => {
    // Setup: identify a socket
    findUserByIdMock.mockResolvedValueOnce({ name: 'Test User', isPlatformOperator: false });
    findMembershipMock.mockResolvedValueOnce({ role: 'support' });
    findActiveTicketsForSupportMock.mockResolvedValueOnce([]);

    const { socket, identifyHandler } = await setupIdentify();
    socket.data.jti = 'jti-to-revoke';
    await identifyHandler({ partnerId: 'partner-1' });

    // Simulate Pub/Sub message
    const revocationCallback = getRevocationSubscribeCallback();
    if (revocationCallback) {
      await revocationCallback(JSON.stringify({
        type: 'token',
        jti: 'jti-to-revoke',
        timestamp: Date.now(),
      }), 'auth:session:revoked');
    }

    expect(socket.emit).toHaveBeenCalledWith('auth:expired', expect.objectContaining({
      message: expect.stringContaining('revoked'),
    }));
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });
});
```

Note: `getRevocationSubscribeCallback` is a test helper you'll wire up via the mock — it captures the callback passed to `subClient.subscribe(channel, callback)`.

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec server npx vitest run server/socket/handlers.test.ts --grep "revocation"`
Expected: FAIL — no subscription logic exists yet.

- [ ] **Step 3: Implement the revocation subscriber in `registerSocketHandlers`**

In `server/socket/handlers.ts`, at the top of `registerSocketHandlers(io)`, add the subscription:

```typescript
export function registerSocketHandlers(io: Server) {
  ioInstance = io;

  // ── Redis Pub/Sub: instant session revocation ──────────────────────────────
  // When a token or user session is revoked, we receive the event here and
  // immediately disconnect all matching sockets. This eliminates the previous
  // 5-minute polling window (REVOCATION_CHECK_INTERVAL_MS).
  const { subClient } = getRedisClients();
  if (subClient) {
    import('../services/sessionRevocation.js').then(({ REVOCATION_CHANNEL }) => {
      subClient.subscribe(REVOCATION_CHANNEL, (message: string) => {
        try {
          const event = JSON.parse(message) as { type: string; jti?: string; userId?: string; revokedAfter?: number };
          const sockets = io.sockets.sockets;

          for (const [, socket] of sockets) {
            let shouldDisconnect = false;

            if (event.type === 'token' && event.jti && socket.data.jti === event.jti) {
              shouldDisconnect = true;
            }

            if (event.type === 'user' && event.userId && socket.data.userId === event.userId) {
              // For user-level revocation, check if socket was issued before the cutoff
              const iat = socket.data.iat as number | undefined;
              if (!iat || (event.revokedAfter && iat <= event.revokedAfter)) {
                shouldDisconnect = true;
              }
            }

            if (shouldDisconnect) {
              logger.info({ socketId: socket.id, userId: socket.data.userId, eventType: event.type }, '[socket] Instant revocation via Pub/Sub');
              socket.emit('auth:expired', { message: 'Session revoked — please re-authenticate' });
              socket.disconnect(true);
            }
          }
        } catch (err) {
          logger.error({ err: err instanceof Error ? err.message : String(err) }, '[socket] Failed to process revocation event');
        }
      });
      logger.info('[socket] Subscribed to session revocation channel');
    });
  }

  // ... rest of existing code
```

- [ ] **Step 4: Reduce `REVOCATION_CHECK_INTERVAL_MS` to 60 seconds as a safety net**

The Pub/Sub handles instant revocation, but keep the periodic check as a fallback (in case Pub/Sub message is missed). Change line 224:

```typescript
const REVOCATION_CHECK_INTERVAL_MS = 60 * 1000; // 60 seconds (safety net — primary revocation is via Pub/Sub)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `docker compose exec server npx vitest run server/socket/handlers.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/socket/handlers.ts server/socket/handlers.test.ts
git commit -m "feat(security): instant socket revocation via Redis Pub/Sub

Subscribes to 'auth:session:revoked' channel on socket server init.
Revoked tokens/users are disconnected within milliseconds instead of
the previous 5-minute polling window. Periodic check reduced to 60s
as a safety net fallback."
```

---

## Phase 2: GIN Index on JSONB Columns

### Task 3: Add GIN index migration for `tickets.participants`

**Files:**
- Modify: `server/db/schema.ts:114-123` (tickets table index block)

- [ ] **Step 1: Add the GIN index to the schema definition**

In `server/db/schema.ts`, inside the tickets table's index callback (the `(table) => ({...})` block at line 114), add:

```typescript
}, (table) => ({
  partnerIdIdx: index('idx_tickets_partner_id').on(table.partnerId),
  agentIdIdx: index('idx_tickets_agent_id').on(table.agentId),
  statusIdx: index('idx_tickets_status').on(table.status),
  deptIdx: index('idx_tickets_dept').on(table.dept),
  createdAtIdx: index('idx_tickets_created_at').on(table.createdAt),
  partnerCreatedIdx: index('idx_tickets_partner_created').on(table.partnerId, table.createdAt),
  partnerStatusIdx: index('idx_tickets_partner_status').on(table.partnerId, table.status),
  supportIdIdx: index('idx_tickets_support_id').on(table.supportId),
  participantsGinIdx: index('idx_tickets_participants_gin').using('gin', table.participants),
}));
```

The key addition is the last line: `participantsGinIdx`.

- [ ] **Step 2: Generate the Drizzle migration**

Run: `docker compose exec server npx drizzle-kit generate`
Expected: A new migration file in `server/drizzle/` containing `CREATE INDEX idx_tickets_participants_gin ON tickets USING gin (participants)`.

- [ ] **Step 3: Verify the generated SQL is correct**

Read the generated migration file and confirm it contains a GIN index creation statement. It should look like:

```sql
CREATE INDEX "idx_tickets_participants_gin" ON "tickets" USING gin ("participants");
```

- [ ] **Step 4: Apply the migration**

Run: `docker compose exec server npm run db:migrate`
Expected: Migration applied successfully.

- [ ] **Step 5: Verify the index exists in the database**

Run: `docker compose exec db psql -U tessera -d tessera -c "SELECT indexname FROM pg_indexes WHERE tablename = 'tickets' AND indexname LIKE '%gin%';"`
Expected: `idx_tickets_participants_gin`

- [ ] **Step 6: Commit**

```bash
git add server/db/schema.ts server/drizzle/
git commit -m "perf(db): add GIN index on tickets.participants JSONB column

The findActiveTicketsForSupport query uses @> containment on
participants JSONB. Without this GIN index, every support:identify
triggers a full table scan. With GIN, PostgreSQL uses an index scan
for the JSONB containment operator."
```

---

## Phase 3: Cursor-Paginated Message Loading

### Task 4: Add `findTicketMessagesPaginated` query function

**Files:**
- Modify: `server/services/messageQueries.ts:64-74` (alongside existing `findTicketMessages`)
- Modify or Create: `server/services/messageQueries.test.ts`

- [ ] **Step 1: Write the failing test**

If `server/services/messageQueries.test.ts` does not exist, create it. Add:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSelect = vi.fn();
const mockFrom = vi.fn().mockReturnThis();
const mockWhere = vi.fn().mockReturnThis();
const mockOrderBy = vi.fn().mockReturnThis();
const mockLimit = vi.fn().mockResolvedValue([]);
vi.mock('../db/postgres.js', () => ({
  db: {
    select: () => ({ from: mockFrom }),
  },
}));
// Also mock the schema to provide column references
vi.mock('../db/schema.js', () => ({
  messages: {
    id: 'id',
    ticketId: 'ticket_id',
    createdAt: 'created_at',
    deletedAt: 'deleted_at',
  },
  ticketLabels: { ticketId: 'ticket_id', labelId: 'label_id' },
}));

import { findTicketMessagesPaginated } from '../messageQueries.js';

describe('findTicketMessagesPaginated', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset chain
    mockFrom.mockReturnThis();
    mockWhere.mockReturnThis();
    mockOrderBy.mockReturnThis();
  });

  it('returns messages with hasMore=false when under limit', async () => {
    const fakeMessages = [
      { id: 'm1', ticketId: 't1', createdAt: '2026-01-01T00:00:00Z' },
      { id: 'm2', ticketId: 't1', createdAt: '2026-01-01T00:01:00Z' },
    ];
    mockFrom.mockReturnValue({ where: mockWhere });
    mockWhere.mockReturnValue({ orderBy: mockOrderBy });
    mockOrderBy.mockReturnValue({ limit: mockLimit });
    mockLimit.mockResolvedValue(fakeMessages);

    const result = await findTicketMessagesPaginated('t1', { limit: 50 });

    expect(result.messages).toHaveLength(2);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeUndefined();
  });

  it('returns hasMore=true and nextCursor when at limit', async () => {
    // Return limit+1 items to signal hasMore
    const fakeMessages = Array.from({ length: 51 }, (_, i) => ({
      id: `m${i}`,
      ticketId: 't1',
      createdAt: `2026-01-01T00:${String(i).padStart(2, '0')}:00Z`,
    }));
    mockFrom.mockReturnValue({ where: mockWhere });
    mockWhere.mockReturnValue({ orderBy: mockOrderBy });
    mockOrderBy.mockReturnValue({ limit: mockLimit });
    mockLimit.mockResolvedValue(fakeMessages);

    const result = await findTicketMessagesPaginated('t1', { limit: 50 });

    expect(result.messages).toHaveLength(50);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec server npx vitest run server/services/messageQueries.test.ts`
Expected: FAIL — `findTicketMessagesPaginated` is not exported.

- [ ] **Step 3: Implement `findTicketMessagesPaginated`**

Add to `server/services/messageQueries.ts`, after the existing `findTicketMessages` function (keep the original for backward compat):

```typescript
import { eq, and, asc, isNull, inArray, lt, or } from 'drizzle-orm';

// ... existing code ...

export interface PaginatedMessages {
  messages: Array<typeof messages.$inferSelect>;
  hasMore: boolean;
  nextCursor?: string; // ISO timestamp|id composite cursor
}

/**
 * Fetches messages for a ticket with cursor-based pagination.
 * Cursor format: "createdAt|id" (composite keyset).
 * Orders oldest-first (ASC) so clients can append.
 *
 * Used by: support:join (initial load + "load more")
 */
export async function findTicketMessagesPaginated(
  ticketId: string,
  opts: { limit?: number; beforeCursor?: string } = {},
): Promise<PaginatedMessages> {
  const limit = Math.min(opts.limit ?? 50, 200);

  let query = db
    .select()
    .from(messages)
    .where(
      opts.beforeCursor
        ? (() => {
            const [cursorTs, cursorId] = opts.beforeCursor.split('|');
            return and(
              eq(messages.ticketId, ticketId),
              or(
                lt(messages.createdAt, cursorTs),
                and(eq(messages.createdAt, cursorTs), lt(messages.id, cursorId)),
              ),
            );
          })()
        : eq(messages.ticketId, ticketId),
    )
    .orderBy(asc(messages.createdAt), asc(messages.id))
    .limit(limit + 1); // Fetch one extra to detect hasMore

  const rows = await query;

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const lastRow = page[page.length - 1];
  const nextCursor = hasMore && lastRow ? `${lastRow.createdAt}|${lastRow.id}` : undefined;

  return { messages: page, hasMore, nextCursor };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `docker compose exec server npx vitest run server/services/messageQueries.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/services/messageQueries.ts server/services/messageQueries.test.ts
git commit -m "feat(perf): add cursor-paginated findTicketMessagesPaginated

Adds keyset pagination (createdAt|id composite cursor) to message
loading. Fetches limit+1 to detect hasMore. The original unbounded
findTicketMessages is preserved for backward compat but should be
migrated away from."
```

---

### Task 5: Wire paginated messages into `support:join` socket handler

**Files:**
- Modify: `server/socket/handlers.ts` (the `support:join` event handler)

- [ ] **Step 1: Locate the `support:join` handler and identify the `findTicketMessages` call**

Search for the `support:join` handler in `server/socket/handlers.ts`. It calls `findTicketMessages(ticketId)` to load the full message history. We need to replace it with `findTicketMessagesPaginated`.

- [ ] **Step 2: Update the import**

At the top of `server/socket/handlers.ts`, add `findTicketMessagesPaginated` to the import from `messageQueries.js`:

```typescript
import {
  insertMessage,
  findTicketMessages,
  findTicketMessagesPaginated, // NEW
  findTicketLabelIds,
  findMessageForEdit,
  findMessageForDelete,
  updateMessageText,
  softDeleteMessage,
  markDelivered,
  markRead,
  type SocketMessage,
} from '../services/messageQueries.js';
```

- [ ] **Step 3: Replace the unbounded query in `support:join`**

In the `support:join` handler, replace:

```typescript
const msgRows = await findTicketMessages(ticketId);
```

With:

```typescript
const { messages: msgRows, hasMore, nextCursor } = await findTicketMessagesPaginated(ticketId, { limit: 100 });
```

Then update the emit to include pagination metadata:

```typescript
socket.emit('ticket:history', {
  ticketId,
  messages: msgRows.map(mapMessageRow),
  labels: labelIds,
  hasMore,
  nextCursor,
});
```

- [ ] **Step 4: Add a `message:loadMore` socket event for subsequent pages**

After the `support:join` handler, add:

```typescript
    socket.on('message:loadMore', async ({ ticketId, cursor }: { ticketId: string; cursor: string }) => {
      if (!requireIdentified(socket)) return;
      if (!ticketId || !cursor) return;

      // Tenant isolation
      const ticket = await findTicketPartner(ticketId);
      if (!ticket || ticket.partnerId !== socket.data.partnerId) {
        return socket.emit('error', { message: 'Not authorized' });
      }

      const { messages: msgRows, hasMore, nextCursor } = await findTicketMessagesPaginated(ticketId, {
        limit: 50,
        beforeCursor: cursor,
      });

      socket.emit('message:morePage', {
        ticketId,
        messages: msgRows.map(mapMessageRow),
        hasMore,
        nextCursor,
      });
    });
```

- [ ] **Step 5: Run all socket handler tests**

Run: `docker compose exec server npx vitest run server/socket/handlers.test.ts`
Expected: PASS (existing tests should still pass; new event doesn't break them)

- [ ] **Step 6: Commit**

```bash
git add server/socket/handlers.ts
git commit -m "feat(perf): wire cursor-paginated messages into support:join

Replaces unbounded findTicketMessages with findTicketMessagesPaginated
(limit 100) in support:join. Adds message:loadMore socket event for
subsequent pages. Prevents memory bloat on long-lived tickets."
```

---

## Phase 4: Centralized Socket Tenant Isolation Guard

### Task 6: Create `requirePartnerScope` helper and unit tests

**Files:**
- Modify: `server/socket/handlers.ts` (add helper function near `requireIdentified`)
- Create: `server/socket/__tests__/requirePartnerScope.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/socket/__tests__/requirePartnerScope.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

// Minimal mock for ticketQueries
const findTicketPartnerMock = vi.fn();
vi.mock('../../services/ticketQueries.js', () => ({
  findTicketPartner: (...args: unknown[]) => findTicketPartnerMock(...args),
}));
vi.mock('../../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Import after mocks
import { requirePartnerScope } from '../partnerScope.js';

function mockSocket(partnerId: string) {
  return {
    data: { partnerId, userId: 'u1' },
    emit: vi.fn(),
  } as any;
}

describe('requirePartnerScope', () => {
  it('returns the ticket when partnerId matches', async () => {
    findTicketPartnerMock.mockResolvedValue({ partnerId: 'p1' });
    const socket = mockSocket('p1');

    const result = await requirePartnerScope(socket, 'ticket-1');

    expect(result).toEqual({ partnerId: 'p1' });
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('returns null and emits error when partnerId does not match', async () => {
    findTicketPartnerMock.mockResolvedValue({ partnerId: 'p2' });
    const socket = mockSocket('p1');

    const result = await requirePartnerScope(socket, 'ticket-1');

    expect(result).toBeNull();
    expect(socket.emit).toHaveBeenCalledWith('error', { message: 'Not authorized' });
  });

  it('returns null when ticket does not exist', async () => {
    findTicketPartnerMock.mockResolvedValue(undefined);
    const socket = mockSocket('p1');

    const result = await requirePartnerScope(socket, 'ticket-1');

    expect(result).toBeNull();
    expect(socket.emit).toHaveBeenCalledWith('error', { message: 'Not authorized' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec server npx vitest run server/socket/__tests__/requirePartnerScope.test.ts`
Expected: FAIL — `server/socket/partnerScope.ts` does not exist.

- [ ] **Step 3: Implement `requirePartnerScope`**

Create `server/socket/partnerScope.ts`:

```typescript
import { Socket } from 'socket.io';
import { findTicketPartner } from '../services/ticketQueries.js';
import logger from '../utils/logger.js';

/**
 * Centralized tenant isolation guard for socket events.
 *
 * Verifies that a ticket belongs to the caller's partner. Returns the
 * ticket's partner info on success, or null (with error emission) on failure.
 *
 * Usage in socket handlers:
 *   const ticket = await requirePartnerScope(socket, ticketId);
 *   if (!ticket) return;
 */
export async function requirePartnerScope(
  socket: Socket,
  ticketId: string,
): Promise<{ partnerId: string } | null> {
  const ticket = await findTicketPartner(ticketId);
  if (!ticket || ticket.partnerId !== socket.data.partnerId) {
    logger.warn(
      { socketId: socket.id, userId: socket.data.userId, ticketId, expected: socket.data.partnerId, actual: ticket?.partnerId },
      '[socket] Tenant isolation: partner mismatch',
    );
    socket.emit('error', { message: 'Not authorized' });
    return null;
  }
  return ticket;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `docker compose exec server npx vitest run server/socket/__tests__/requirePartnerScope.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/socket/partnerScope.ts server/socket/__tests__/requirePartnerScope.test.ts
git commit -m "feat(security): add centralized requirePartnerScope socket guard

Extracts the manual partnerId !== socket.data.partnerId check into a
reusable helper. Returns null + emits error on mismatch. Logs all
tenant isolation violations with full context for auditing."
```

---

### Task 7: Replace manual partner checks in socket handlers with `requirePartnerScope`

**Files:**
- Modify: `server/socket/handlers.ts` (12+ event handlers)

- [ ] **Step 1: Add the import**

At the top of `server/socket/handlers.ts`:

```typescript
import { requirePartnerScope } from './partnerScope.js';
```

- [ ] **Step 2: Replace each manual check pattern**

The current manual pattern looks like this (repeated in `message:send`, `message:edit`, `message:delete`, `message:delivered`, `message:read`, `ticket:close`, `ticket:labels:update`, `ticket:viewing`, `ticket:left`, `message:loadMore`, etc.):

```typescript
// BEFORE (manual check — varies slightly per handler):
const ticket = await findTicketPartner(ticketId);
if (!ticket || ticket.partnerId !== socket.data.partnerId) {
  return socket.emit('error', { message: 'Not authorized' });
}
```

Replace each with:

```typescript
// AFTER (centralized guard):
const ticket = await requirePartnerScope(socket, ticketId);
if (!ticket) return;
```

Apply this to ALL socket events that perform a `findTicketPartner` + manual partner comparison. The events to update are:

1. `message:send` — replace the `findTicketForMessage` partner check
2. `message:edit` — replace `findTicketPartner` check
3. `message:delete` — replace `findTicketPartner` check
4. `message:delivered` — replace `findTicketPartner` check
5. `message:read` — replace `findTicketPartner` check
6. `ticket:close` — replace `findTicketForClose` partner check
7. `ticket:labels:update` — replace `findTicketPartner` check
8. `ticket:viewing` — replace `findTicketPartner` check
9. `ticket:left` — replace `findTicketPartner` check
10. `message:loadMore` (added in Task 5) — already uses the pattern

**Important:** Some handlers (like `ticket:close`, `support:join`, `ticket:transfer`) fetch more than just `partnerId` from the ticket. For those, keep the richer query but add `requirePartnerScope` as a fast pre-check before the full query, OR create a version that returns the needed fields. Evaluate per-handler — if the handler already calls `findTicketForClose` which returns `{ status, partnerId }`, you can use `requirePartnerScope` as the guard and then call the richer query only for the extra fields.

- [ ] **Step 3: Run the full socket handler test suite**

Run: `docker compose exec server npx vitest run server/socket/handlers.test.ts`
Expected: PASS

- [ ] **Step 4: Run the tenant isolation test suite**

Run: `docker compose exec server npx vitest run server/__tests__/isolation.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/socket/handlers.ts
git commit -m "refactor(security): replace manual partner checks with requirePartnerScope

Replaces 9+ manual 'ticket.partnerId !== socket.data.partnerId'
checks with centralized requirePartnerScope() calls. Eliminates the
risk of missing tenant isolation on future socket events. All
violations are now logged with full context for security auditing."
```

---

## Final Verification

### Task 8: Run full test suite and typecheck

- [ ] **Step 1: Run TypeScript type checking**

Run: `docker compose exec server npx tsc --noEmit`
Expected: No type errors.

Run: `docker compose exec client npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 2: Run full server test suite**

Run: `docker compose exec server npm test`
Expected: All tests pass.

- [ ] **Step 3: Run full client test suite**

Run: `docker compose exec client npm test`
Expected: All tests pass.

- [ ] **Step 4: Manual smoke test — revocation**

1. Login as a support user, open a ticket chat
2. In another browser tab as platform admin, revoke the user's session
3. Verify the support user's socket is disconnected within seconds (not 5 minutes)

- [ ] **Step 5: Manual smoke test — message pagination**

1. Open a ticket with 100+ messages
2. Verify initial load only fetches 100 messages
3. Verify "load more" (if client-side UI is wired) or inspect socket events in DevTools

- [ ] **Step 6: Verify GIN index is being used**

Run: `docker compose exec db psql -U tessera -d tessera -c "EXPLAIN ANALYZE SELECT id FROM tickets WHERE partner_id = 'test' AND status != 'closed' AND participants::jsonb @> '[{\"id\":\"test\"}]'::jsonb;"`
Expected: Query plan shows "Bitmap Index Scan" using `idx_tickets_participants_gin` instead of "Seq Scan".

- [ ] **Step 7: Final commit (if any fixups needed)**

```bash
git add -A
git commit -m "chore: final fixups from verification pass"
```

---

## Summary of Changes

| Phase | What | Security Impact | Performance Impact |
|-------|------|----------------|-------------------|
| 1 | Redis Pub/Sub revocation | 5-min window → milliseconds | Negligible (one subscription) |
| 2 | GIN index on `participants` | None | Full table scan → index scan |
| 3 | Cursor-paginated messages | None | Unbounded → bounded memory |
| 4 | `requirePartnerScope` | Eliminates human error on tenant isolation | None |

## Out of Scope (Deferred)

- **Message slice normalization** — Per-ticket partitioning already limits blast radius. Revisit only if profiling shows jank.
- **Handler file splitting** — Extract services incrementally as handlers are touched, not as a dedicated refactor.
- **Fail-closed repetition guard** — Current in-memory fallback is the correct design (fail-closed would self-DOS).
