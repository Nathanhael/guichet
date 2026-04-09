# Socket Handler Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the 1,246-line `server/socket/handlers.ts` into domain-specific handler modules for readability, testability, and maintainability.

**Architecture:** Extract handler bodies into domain modules under `server/socket/handlers/`, each exporting a `register(socket, ctx)` function. The original `handlers.ts` becomes a thin orchestrator (~80 lines) that sets up shared infra and calls each domain's `register`. A shared `HandlerContext` interface carries `io`, `socketTickets`, and `viewerKeyPrefix` so modules avoid module-level singletons.

**Tech Stack:** TypeScript, Socket.io, Vitest

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `server/socket/handlers/types.ts` | Create | `HandlerContext` interface, payload interfaces, shared guards (`requireIdentified`, `isTokenExpired`) |
| `server/socket/handlers/collision.ts` | Create | Viewer Redis helpers (`addViewer`, `removeViewer`, `removeViewerFromAll`, `getViewers`, `broadcastViewers`), `ticket:viewing`, `ticket:left` handlers |
| `server/socket/handlers/auth.ts` | Create | `socket:identify` handler, Redis Pub/Sub revocation setup, JWT middleware |
| `server/socket/handlers/ticket.ts` | Create | `ticket:new`, `ticket:close`, `ticket:transfer`, `ticket:labels:update` handlers |
| `server/socket/handlers/message.ts` | Create | `message:send`, `message:edit`, `message:delete`, `message:react`, `message:loadMore`, `message:delivered`, `message:read` handlers |
| `server/socket/handlers/presence.ts` | Create | `typing:start`, `typing:stop`, `status:set`, `support:join`, `support:leave` handlers |
| `server/socket/handlers/rating.ts` | Create | `rating:submit` handler |
| `server/socket/handlers/disconnect.ts` | Create | `disconnect` handler (presence offline, viewer cleanup, status tracking) |
| `server/socket/handlers.ts` | Modify | Slim to ~80-line orchestrator: imports domain modules, creates `HandlerContext`, delegates registration |
| `server/socket/handlers.test.ts` | Delete | Replaced by per-domain test files |
| `server/socket/__tests__/types.test.ts` | Create | Tests for `requireIdentified`, `isTokenExpired` guards |
| `server/socket/__tests__/auth.test.ts` | Create | Tests moved from `registerSocketHandlers` + `socket:identify` describe blocks |
| `server/socket/__tests__/message.test.ts` | Create | Tests moved from `message:send` describe block |
| `server/socket/__tests__/disconnect.test.ts` | Create | Tests moved from `disconnect handler` describe block |
| `server/socket/__tests__/broadcast.test.ts` | Create | Tests moved from `broadcastPartnerDeactivation` + `broadcastUserDeactivation` describe blocks |

### Public API (unchanged)

External consumers import from `server/socket/handlers.ts` (the orchestrator). The three exports remain:
- `registerSocketHandlers(io)` — used by `app.ts`
- `broadcastPartnerDeactivation(partnerId)` — used by `trpc/routers/platform.ts`
- `broadcastUserDeactivation(userId)` — used by `trpc/routers/platform.ts` (currently unused but exported)

---

## Task 1: Create `handlers/types.ts` — shared context, payload types, guards

**Files:**
- Create: `server/socket/handlers/types.ts`
- Test: `server/socket/__tests__/types.test.ts`

- [ ] **Step 1: Create the `handlers/` directory**

```bash
docker compose exec server sh -c "mkdir -p /app/server/socket/handlers"
```

- [ ] **Step 2: Write the failing test for guards**

Create `server/socket/__tests__/types.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import type { Socket } from 'socket.io';
import { isTokenExpired, requireIdentified } from '../handlers/types.js';

function mockSocket(overrides: Partial<Socket['data']> = {}): Socket {
  return {
    id: 'sock-1',
    data: { userId: 'u1', partnerId: 'p1', role: 'agent', name: 'Test', exp: Math.floor(Date.now() / 1000) + 3600, ...overrides },
    emit: vi.fn(),
    disconnect: vi.fn(),
    rooms: new Set(),
  } as unknown as Socket;
}

describe('isTokenExpired', () => {
  it('returns false when token is not expired', () => {
    const socket = mockSocket({ exp: Math.floor(Date.now() / 1000) + 3600 });
    expect(isTokenExpired(socket)).toBe(false);
  });

  it('returns true when token is expired', () => {
    const socket = mockSocket({ exp: Math.floor(Date.now() / 1000) - 10 });
    expect(isTokenExpired(socket)).toBe(true);
  });

  it('returns true when exp is missing', () => {
    const socket = mockSocket({});
    delete (socket.data as Record<string, unknown>).exp;
    expect(isTokenExpired(socket)).toBe(true);
  });
});

describe('requireIdentified', () => {
  it('returns true for an identified, non-expired socket', () => {
    const socket = mockSocket();
    expect(requireIdentified(socket)).toBe(true);
  });

  it('returns false and emits auth:expired for an expired token', () => {
    const socket = mockSocket({ exp: Math.floor(Date.now() / 1000) - 10 });
    expect(requireIdentified(socket)).toBe(false);
    expect(socket.emit).toHaveBeenCalledWith('auth:expired', expect.any(Object));
  });

  it('returns false and emits error for unidentified socket (no userId)', () => {
    const socket = mockSocket({});
    delete (socket.data as Record<string, unknown>).userId;
    expect(requireIdentified(socket)).toBe(false);
    expect(socket.emit).toHaveBeenCalledWith('error', expect.objectContaining({ message: expect.any(String) }));
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
docker compose exec server npx vitest run server/socket/__tests__/types.test.ts
```

Expected: FAIL — module `../handlers/types.js` does not exist.

- [ ] **Step 4: Write `handlers/types.ts`**

Create `server/socket/handlers/types.ts`. Move the following verbatim from `handlers.ts`:
- Lines 77–125: all payload interfaces (`TicketNewPayload`, `SupportJoinPayload`, `SupportLeavePayload`, `TicketClosePayload`, `MessageSendPayload`, `Participant`, `SenderInfo`)
- Lines 228–280: `isTokenExpired` and `requireIdentified` functions

Add the new `HandlerContext` interface and the `REVOCATION_CHECK_INTERVAL_MS` constant:

```typescript
import { Server, Socket } from 'socket.io';
import logger from '../../utils/logger.js';
import { isRevoked } from '../../services/sessionRevocation.js';
import { socketioEventsTotal } from '../../utils/metrics.js';

// ── Shared context passed to every domain handler module ─────────────────────
export interface HandlerContext {
  io: Server;
  /** Local index: socketId → Set<ticketId> for disconnect viewer cleanup */
  socketTickets: Map<string, Set<string>>;
  viewerKeyPrefix: string;
}

// ── Payload interfaces ───────────────────────────────────────────────────────

export interface TicketNewPayload {
  agentId?: string; // Deprecated — server uses socket.data.userId instead
  agentLang: string;
  dept: string;
  references?: Array<{ label: string; value: string }>;
  text?: string;
  mediaUrl?: string;
}

export interface SupportJoinPayload {
  ticketId: string;
  supportLang: string;
}

export interface SupportLeavePayload {
  ticketId: string;
}

export interface TicketClosePayload {
  ticketId: string;
  closedBy?: string;
  closingNotes?: string;
}

export interface MessageSendPayload {
  ticketId: string;
  senderId: string;
  text: string;
  mediaUrl?: string;
  attachments?: Array<{ url: string; name: string; mimeType: string; size: number }>;
  whisper?: boolean;
  replyToId?: string;
  /** Client-generated ID echoed back in message:new for optimistic reconciliation */
  localId?: string;
}

export interface Participant {
  id: string;
  name: string;
}

export interface SenderInfo {
  name: string;
  role: string;
  lang: string;
}

// ── Guards ───────────────────────────────────────────────────────────────────

/** Guard: check if the JWT has expired since the handshake */
export function isTokenExpired(socket: Socket): boolean {
  const exp = socket.data.exp as number | undefined;
  if (!exp) return true;
  return Math.floor(Date.now() / 1000) >= exp;
}

/** Interval (ms) between periodic revocation checks on active sockets */
export const REVOCATION_CHECK_INTERVAL_MS = 60 * 1000;

/** Guard: require socket to be identified before processing events */
export function requireIdentified(socket: Socket): boolean {
  if (isTokenExpired(socket)) {
    logger.info({ socketId: socket.id, userId: socket.data.userId }, '[socket] Token expired, disconnecting');
    socket.emit('auth:expired', { message: 'Token expired — please re-authenticate' });
    socket.disconnect(true);
    return false;
  }

  if (!socket.data.userId || !socket.data.partnerId) {
    socket.emit('error', { message: 'Not identified — call socket:identify first' });
    return false;
  }

  // Periodic session-revocation check (fire-and-forget, safety net every 60s).
  const now = Date.now();
  const lastCheck = (socket.data.lastRevocationCheck as number) || 0;
  if (now - lastCheck > REVOCATION_CHECK_INTERVAL_MS) {
    socket.data.lastRevocationCheck = now;
    isRevoked(socket.data.jti as string).then((revoked) => {
      if (revoked) {
        logger.info({ socketId: socket.id, userId: socket.data.userId }, '[socket] Session revoked (periodic check)');
        socket.emit('auth:expired', { message: 'Session revoked — please re-authenticate' });
        socket.disconnect(true);
      }
    });
  }

  socketioEventsTotal.inc();
  return true;
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
docker compose exec server npx vitest run server/socket/__tests__/types.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add server/socket/handlers/types.ts server/socket/__tests__/types.test.ts
git commit -m "refactor(socket): extract shared types and guards to handlers/types.ts"
```

---

## Task 2: Extract `handlers/collision.ts` — viewer tracking

**Files:**
- Create: `server/socket/handlers/collision.ts`
- Reference: `server/socket/handlers.ts` lines 129–212 (viewer helpers) + lines 1168–1195 (`ticket:viewing`, `ticket:left`)

- [ ] **Step 1: Create `handlers/collision.ts`**

Move verbatim from `handlers.ts`:
- `VIEWER_KEY_PREFIX` constant (L134) — but receive from `ctx.viewerKeyPrefix` instead
- `addViewer` (L139–152), `removeViewer` (L154–163), `removeViewerFromAll` (L165–185), `getViewers` (L187–207), `broadcastViewers` (L209–212) — these become exported functions that accept the key prefix
- `ticket:viewing` handler (L1168–1188) and `ticket:left` handler (L1189–1195)

```typescript
import { Server, Socket } from 'socket.io';
import logger from '../../utils/logger.js';
import { getRedisClients } from '../../utils/redis.js';
import { VIEWER_TTL_SECONDS } from '../../constants.js';
import { Rooms } from '../../utils/rooms.js';
import { requireIdentified, type HandlerContext } from './types.js';

// ── Viewer helpers (exported for use by disconnect handler) ──────────────────

export async function addViewer(
  viewerKeyPrefix: string,
  ticketId: string,
  socketId: string,
  userId: string,
  userName: string,
) {
  try {
    const { pubClient } = getRedisClients();
    if (!pubClient) return;
    const key = `${viewerKeyPrefix}${ticketId}`;
    await pubClient.hSet(key, socketId, JSON.stringify({ userId, userName }));
    await pubClient.expire(key, VIEWER_TTL_SECONDS);
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, '[collision] Redis addViewer error');
  }
}

export async function removeViewer(viewerKeyPrefix: string, ticketId: string, socketId: string) {
  try {
    const { pubClient } = getRedisClients();
    if (!pubClient) return;
    await pubClient.hDel(`${viewerKeyPrefix}${ticketId}`, socketId);
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, '[collision] Redis removeViewer error');
  }
}

export async function removeViewerFromAll(
  viewerKeyPrefix: string,
  socketId: string,
  socketTickets: Map<string, Set<string>>,
): Promise<string[]> {
  const ticketIds = socketTickets.get(socketId);
  if (!ticketIds || ticketIds.size === 0) return [];
  const affected: string[] = [];
  for (const ticketId of ticketIds) {
    await removeViewer(viewerKeyPrefix, ticketId, socketId);
    affected.push(ticketId);
  }
  socketTickets.delete(socketId);
  return affected;
}

export async function getViewers(
  viewerKeyPrefix: string,
  ticketId: string,
): Promise<Array<{ userId: string; userName: string }>> {
  try {
    const { pubClient } = getRedisClients();
    if (!pubClient) return [];
    const entries = await pubClient.hGetAll(`${viewerKeyPrefix}${ticketId}`);
    const viewers: Array<{ userId: string; userName: string }> = [];
    for (const val of Object.values(entries)) {
      try {
        viewers.push(JSON.parse(val));
      } catch { /* skip corrupt entry */ }
    }
    return viewers;
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, '[collision] Redis getViewers error');
    return [];
  }
}

export async function broadcastViewers(
  io: Server,
  viewerKeyPrefix: string,
  ticketId: string,
) {
  const viewers = await getViewers(viewerKeyPrefix, ticketId);
  io.to(Rooms.ticket(ticketId)).emit('ticket:viewers', { ticketId, viewers });
}

// ── Socket event registration ────────────────────────────────────────────────

export function register(socket: Socket, ctx: HandlerContext) {
  socket.on('ticket:viewing', async ({ ticketId }: { ticketId: string }) => {
    if (!requireIdentified(socket)) return;
    const userId = socket.data.userId as string;
    const userName = socket.data.name as string || 'Unknown';
    await addViewer(ctx.viewerKeyPrefix, ticketId, socket.id, userId, userName);
    if (!ctx.socketTickets.has(socket.id)) ctx.socketTickets.set(socket.id, new Set());
    ctx.socketTickets.get(socket.id)!.add(ticketId);
    await broadcastViewers(ctx.io, ctx.viewerKeyPrefix, ticketId);
  });

  socket.on('ticket:left', async ({ ticketId }: { ticketId: string }) => {
    if (!requireIdentified(socket)) return;
    await removeViewer(ctx.viewerKeyPrefix, ticketId, socket.id);
    ctx.socketTickets.get(socket.id)?.delete(ticketId);
    await broadcastViewers(ctx.io, ctx.viewerKeyPrefix, ticketId);
  });
}
```

- [ ] **Step 2: Run typecheck to verify**

```bash
docker compose exec server npx tsc --noEmit
```

Expected: no errors related to collision.ts.

- [ ] **Step 3: Commit**

```bash
git add server/socket/handlers/collision.ts
git commit -m "refactor(socket): extract collision detection handlers to handlers/collision.ts"
```

---

## Task 3: Extract `handlers/auth.ts` — identify + revocation Pub/Sub

**Files:**
- Create: `server/socket/handlers/auth.ts`
- Reference: `server/socket/handlers.ts` lines 282–361 (revocation Pub/Sub setup) + lines 362–473 (`socket:identify`)

- [ ] **Step 1: Create `handlers/auth.ts`**

This module is slightly different — it exports two functions:
- `setupRevocationPubSub(io)` — called once by the orchestrator (not per-connection)
- `register(socket, ctx)` — registers `socket:identify` per connection

Move the full identify handler body verbatim from L366–473 and the Pub/Sub setup from L285–360.

```typescript
import { Socket, Server } from 'socket.io';
import { jwtVerify } from 'jose';
import { parse as parseCookie } from 'cookie';
import config from '../../config.js';
import logger from '../../utils/logger.js';
import { socketioConnectionsActive } from '../../utils/metrics.js';
import { Rooms } from '../../utils/rooms.js';
import { getRedisClients } from '../../utils/redis.js';
import * as presenceService from '../../services/presence.js';
import { findUserById, findMembership } from '../../services/userQueries.js';
import { findPartnerConfig } from '../../services/partnerQueries.js';
import { findActiveTicketsForAgent, findActiveTicketsForSupport, findRecentClosedTickets } from '../../services/ticketQueries.js';
import { getBusinessHoursStatus, broadcastQueuePositions, broadcastAgentStatus } from '../../services/businessHours.js';
import { canUseSupportWorkflows, isPlatformAdmin } from '../../services/roles.js';
import * as statusTracking from '../../services/statusTracking.js';
import { requireIdentified, type HandlerContext } from './types.js';
import { RECENT_CLOSED_TICKETS_LIMIT } from '../../constants.js';

const jwtSecret = new TextEncoder().encode(config.JWT_SECRET);

/**
 * Set up Redis Pub/Sub subscriber for instant session revocation.
 * Called once from the orchestrator, NOT per-connection.
 */
export function setupRevocationPubSub(io: Server) {
  // Move lines 285–360 verbatim from handlers.ts
  // (Redis Pub/Sub subscriber for REVOCATION_CHANNEL)
  const { subClient } = getRedisClients();
  if (subClient) {
    import('../../services/sessionRevocation.js').then(({ REVOCATION_CHANNEL }) => {
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
          logger.error({ err: err instanceof Error ? err.message : String(err) }, '[socket] Revocation Pub/Sub parse error');
        }
      });
    });
  }
}

/**
 * Set up Socket.io JWT authentication middleware.
 * Called once from the orchestrator, NOT per-connection.
 */
export function setupJwtMiddleware(io: Server) {
  // Move lines 327–360 (JWT middleware) verbatim from handlers.ts
  io.use(async (socket, next) => {
    try {
      const raw = socket.handshake.headers.cookie;
      if (!raw) return next(new Error('No cookie'));
      const cookies = parseCookie(raw);
      const token = cookies.tessera_token;
      if (!token) return next(new Error('No token'));

      const { payload } = await jwtVerify(token, jwtSecret);
      socket.data.userId = payload.sub;
      socket.data.jti = payload.jti;
      socket.data.iat = payload.iat;
      socket.data.exp = payload.exp;
      next();
    } catch {
      next(new Error('Authentication failed'));
    }
  });
}

/**
 * Register per-connection auth handlers (socket:identify).
 */
export function register(socket: Socket, ctx: HandlerContext) {
  // Move lines 366–473 verbatim (the full socket:identify handler body)
  // Replace direct `io` references with `ctx.io`
  socket.on('socket:identify', async ({ userId: clientUserId, partnerId }: { userId?: string; role?: string; name?: string; partnerId: string }) => {
    // ... full identify body moved verbatim from handlers.ts L366–473 ...
    // Key: replace `io` with `ctx.io` throughout
    // This handler does: user lookup, membership check, platform operator bypass,
    // room joins, presence identification, business hours broadcast, active tickets emit
    if (!requireIdentified(socket)) return;
    // (full body here — moved verbatim during implementation)
  });
}
```

> **Implementation note:** The actual `socket:identify` handler body is ~108 lines. The subagent MUST copy it verbatim from `handlers.ts` L366–473, replacing bare `io` references with `ctx.io`. Do not paraphrase or rewrite the logic.

- [ ] **Step 2: Run typecheck**

```bash
docker compose exec server npx tsc --noEmit
```

- [ ] **Step 3: Migrate auth tests**

Create `server/socket/__tests__/auth.test.ts`. Move the following describe blocks verbatim from `handlers.test.ts`:
- `describe('registerSocketHandlers', ...)` (L234–303) — JWT middleware tests
- `describe('socket:identify', ...)` (L305–386) — identify handler tests

Update imports: the test now imports from `../handlers/auth.js` instead of `../handlers.js`. The mock setup for `userQueries`, `partnerQueries`, `presence`, `businessHours`, `roles`, `statusTracking` moves to this file.

- [ ] **Step 4: Run auth tests**

```bash
docker compose exec server npx vitest run server/socket/__tests__/auth.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/socket/handlers/auth.ts server/socket/__tests__/auth.test.ts
git commit -m "refactor(socket): extract auth/identify handlers to handlers/auth.ts"
```

---

## Task 4: Extract `handlers/message.ts` — all message CRUD

**Files:**
- Create: `server/socket/handlers/message.ts`
- Reference: `server/socket/handlers.ts` lines 613–636 (`message:loadMore`), 745–870 (`message:send`), 871–877 (`typing:start`... wait, typing goes to presence), 884–897 (`message:delivered`), 898–919 (`message:read`), 920–969 (`message:edit`), 970–996 (`message:delete`), 997–1043 (`message:react`)

- [ ] **Step 1: Create `handlers/message.ts`**

Move these 7 handlers verbatim:
- `message:loadMore` (L613–636, ~24 lines)
- `message:send` (L745–870, ~126 lines)
- `message:delivered` (L884–897, ~14 lines)
- `message:read` (L898–919, ~22 lines)
- `message:edit` (L920–969, ~50 lines)
- `message:delete` (L970–996, ~27 lines)
- `message:react` (L997–1043, ~47 lines)

Total: ~310 lines — the largest domain module but focused on a single concern.

```typescript
import { Socket } from 'socket.io';
import logger from '../../utils/logger.js';
import { Rooms } from '../../utils/rooms.js';
import { isValidMediaUrl } from '../../utils/security.js';
import { mapMessageRow } from '../../utils/messageMapper.js';
import { requirePartnerScope, requirePartnerScopeWith } from '../partnerScope.js';
import { findTicketForMessage, findTicketParticipants } from '../../services/ticketQueries.js';
import { findSenderInfo } from '../../services/userQueries.js';
import {
  insertMessage,
  findTicketMessagesPaginated,
  findTicketLabelIds,
  findMessageForEdit,
  findMessageForDelete,
  findMessageForReact,
  updateMessageText,
  updateMessageReactions,
  softDeleteMessage,
  markDelivered,
  markRead,
  resolveReplySnippet,
  updateMessageLinkPreviews,
  type SocketMessage,
} from '../../services/messageQueries.js';
import { runSyncGuards, guardRepetition } from '../../services/guards.js';
import { invalidateSummary, scoreSentiment } from '../../services/ai/index.js';
import { unfurlLinks } from '../../services/linkPreview.js';
import { sendPush } from '../../services/pushNotification.js';
import { canUseSupportWorkflows } from '../../services/roles.js';
import {
  MAX_MESSAGE_LENGTH,
  MAX_EDIT_WINDOW_MS,
  MAX_BATCH_DELETE,
  REACTION_EMOJIS,
} from '../../constants.js';
import { requireIdentified, type HandlerContext, type MessageSendPayload } from './types.js';

export function register(socket: Socket, ctx: HandlerContext) {
  // message:loadMore — moved verbatim from handlers.ts L613–636
  socket.on('message:loadMore', async ({ ticketId, cursor }: { ticketId: string; cursor: string }) => {
    // ... verbatim body ...
  });

  // message:send — moved verbatim from handlers.ts L745–870
  socket.on('message:send', async ({ ticketId, text, mediaUrl, attachments, whisper, replyToId, localId }: Omit<MessageSendPayload, 'senderId'>) => {
    // ... verbatim body ...
  });

  // message:delivered — moved verbatim from handlers.ts L884–897
  socket.on('message:delivered', async ({ ticketId, messageId }: { ticketId: string; messageId: string }) => {
    // ... verbatim body ...
  });

  // message:read — moved verbatim from handlers.ts L898–919
  socket.on('message:read', async ({ ticketId, messageIds }: { ticketId: string; messageIds: string[] }) => {
    // ... verbatim body ...
  });

  // message:edit — moved verbatim from handlers.ts L920–969
  socket.on('message:edit', async ({ ticketId, messageId, text }: { ticketId: string; messageId: string; text: string }) => {
    // ... verbatim body ...
  });

  // message:delete — moved verbatim from handlers.ts L970–996
  socket.on('message:delete', async ({ ticketId, messageId }: { ticketId: string; messageId: string }) => {
    // ... verbatim body ...
  });

  // message:react — moved verbatim from handlers.ts L997–1043
  socket.on('message:react', async ({ ticketId, messageId, emoji }: { ticketId: string; messageId: string; emoji: string }) => {
    // ... verbatim body ...
  });
}
```

> **Implementation note:** Each handler body must be copied verbatim. Replace bare `io` references with `ctx.io`. The `message:send` handler is the largest at ~126 lines — copy it carefully including all guard checks, whisper logic, attachment validation, link preview unfurling, sentiment scoring, and push notification dispatch.

- [ ] **Step 2: Migrate message tests**

Create `server/socket/__tests__/message.test.ts`. Move the `describe('message:send', ...)` block (L459–end of file in handlers.test.ts). Move only the mocks needed by message tests (`messageQueries`, `ticketQueries`, `guards`, `ai`, `linkPreview`, `pushNotification`, `security`, `messageMapper`).

- [ ] **Step 3: Run message tests**

```bash
docker compose exec server npx vitest run server/socket/__tests__/message.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/socket/handlers/message.ts server/socket/__tests__/message.test.ts
git commit -m "refactor(socket): extract message handlers to handlers/message.ts"
```

---

## Task 5: Extract `handlers/ticket.ts` — ticket lifecycle

**Files:**
- Create: `server/socket/handlers/ticket.ts`
- Reference: `server/socket/handlers.ts` lines 474–567 (`ticket:new`), 674–713 (`ticket:close`), 1044–1129 (`ticket:transfer`), 1130–1167 (`ticket:labels:update`)

- [ ] **Step 1: Create `handlers/ticket.ts`**

Move these 4 handlers verbatim:
- `ticket:new` (L474–567, ~94 lines)
- `ticket:close` (L674–713, ~41 lines)
- `ticket:transfer` (L1044–1129, ~86 lines)
- `ticket:labels:update` (L1130–1167, ~38 lines)

Total: ~259 lines.

```typescript
import { Socket } from 'socket.io';
import logger from '../../utils/logger.js';
import { Rooms } from '../../utils/rooms.js';
import { requirePartnerScope, requirePartnerScopeWith } from '../partnerScope.js';
import { canUseSupportWorkflows, isPlatformAdmin } from '../../services/roles.js';
import { findPartnerConfig } from '../../services/partnerQueries.js';
import { findUserName } from '../../services/userQueries.js';
import {
  createTicket,
  findTicketForClose,
  closeTicket,
  updateTicketSla,
  findTicketForTransfer,
  findPartnerLabels,
  replaceTicketLabels,
  findTicketLabelIds,
} from '../../services/ticketQueries.js';
import { findPartnerDepartments, transferTicketToDepartment } from '../../services/transferService.js';
import { getBusinessHoursStatus, broadcastQueuePositions } from '../../services/businessHours.js';
import { parseSlaConfig, getEffectiveSla, calculateSlaDueDate } from '../../services/sla.js';
import { autoSummarizeOnClose, invalidateSummary } from '../../services/ai/index.js';
import { insertSystemMessage, insertWhisperMessage } from '../../services/systemMessage.js';
import { isValidMediaUrl } from '../../utils/security.js';
import { MAX_NOTE_LENGTH, MAX_LABELS_PER_TICKET } from '../../constants.js';
import { requireIdentified, type HandlerContext, type TicketNewPayload, type TicketClosePayload } from './types.js';

export function register(socket: Socket, ctx: HandlerContext) {
  // ticket:new — moved verbatim from handlers.ts L474–567
  socket.on('ticket:new', async (data: TicketNewPayload) => {
    // ... verbatim body, replace `io` with `ctx.io` ...
  });

  // ticket:close — moved verbatim from handlers.ts L674–713
  socket.on('ticket:close', async ({ ticketId, closingNotes }: Omit<TicketClosePayload, 'closedBy'>) => {
    // ... verbatim body, replace `io` with `ctx.io` ...
  });

  // ticket:transfer — moved verbatim from handlers.ts L1044–1129
  socket.on('ticket:transfer', async ({ ticketId, departmentId, note }: { ticketId: string; departmentId?: string; note?: string }) => {
    // ... verbatim body, replace `io` with `ctx.io` ...
  });

  // ticket:labels:update — moved verbatim from handlers.ts L1130–1167
  socket.on('ticket:labels:update', async ({ ticketId, labelIds }: { ticketId: string; labelIds: string[] }) => {
    // ... verbatim body, replace `io` with `ctx.io` ...
  });
}
```

- [ ] **Step 2: Run typecheck**

```bash
docker compose exec server npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add server/socket/handlers/ticket.ts
git commit -m "refactor(socket): extract ticket lifecycle handlers to handlers/ticket.ts"
```

---

## Task 6: Extract `handlers/presence.ts` — typing, status, support join/leave

**Files:**
- Create: `server/socket/handlers/presence.ts`
- Reference: `server/socket/handlers.ts` lines 568–612 (`support:join`), 637–648 (`status:set`), 649–673 (`support:leave`), 871–883 (`typing:start`, `typing:stop`)

- [ ] **Step 1: Create `handlers/presence.ts`**

Move these 5 handlers verbatim:
- `support:join` (L568–612, ~45 lines)
- `status:set` (L637–648, ~12 lines)
- `support:leave` (L649–673, ~25 lines)
- `typing:start` (L871–877, ~7 lines)
- `typing:stop` (L878–883, ~6 lines)

Total: ~95 lines.

```typescript
import { Socket } from 'socket.io';
import logger from '../../utils/logger.js';
import { Rooms } from '../../utils/rooms.js';
import * as presenceService from '../../services/presence.js';
import * as statusTracking from '../../services/statusTracking.js';
import { requirePartnerScopeWith } from '../partnerScope.js';
import { canUseSupportWorkflows } from '../../services/roles.js';
import {
  findTicketForJoin,
  assignSupport,
  findUpdatedParticipants,
  updateParticipants,
  returnTicketToQueue,
} from '../../services/ticketQueries.js';
import { broadcastQueuePositions, broadcastAgentStatus } from '../../services/businessHours.js';
import { requireIdentified, type HandlerContext, type SupportJoinPayload, type SupportLeavePayload } from './types.js';

export function register(socket: Socket, ctx: HandlerContext) {
  // support:join — moved verbatim from handlers.ts L568–612
  socket.on('support:join', async ({ ticketId, supportLang }: SupportJoinPayload) => {
    // ... verbatim body, replace `io` with `ctx.io` ...
  });

  // status:set — moved verbatim from handlers.ts L637–648
  socket.on('status:set', async ({ status }: { status: string }) => {
    // ... verbatim body, replace `io` with `ctx.io` ...
  });

  // support:leave — moved verbatim from handlers.ts L649–673
  socket.on('support:leave', async ({ ticketId }: SupportLeavePayload) => {
    // ... verbatim body, replace `io` with `ctx.io` ...
  });

  // typing:start — moved verbatim from handlers.ts L871–877
  socket.on('typing:start', ({ ticketId }: { ticketId: string; senderName?: string }) => {
    // ... verbatim body ...
  });

  // typing:stop — moved verbatim from handlers.ts L878–883
  socket.on('typing:stop', ({ ticketId }: { ticketId: string; senderName?: string }) => {
    // ... verbatim body ...
  });
}
```

- [ ] **Step 2: Run typecheck**

```bash
docker compose exec server npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add server/socket/handlers/presence.ts
git commit -m "refactor(socket): extract presence/typing handlers to handlers/presence.ts"
```

---

## Task 7: Extract `handlers/rating.ts` — rating submit

**Files:**
- Create: `server/socket/handlers/rating.ts`
- Reference: `server/socket/handlers.ts` lines 715–744 (`rating:submit`)

- [ ] **Step 1: Create `handlers/rating.ts`**

Move the single handler verbatim (~30 lines):

```typescript
import { Socket } from 'socket.io';
import logger from '../../utils/logger.js';
import { Rooms } from '../../utils/rooms.js';
import { requirePartnerScope } from '../partnerScope.js';
import { findTicketOwner, insertRating } from '../../services/ticketQueries.js';
import { requireIdentified, type HandlerContext } from './types.js';

export function register(socket: Socket, ctx: HandlerContext) {
  // rating:submit — moved verbatim from handlers.ts L715–744
  socket.on('rating:submit', async ({ ticketId, rating, comment }: { ticketId: string; rating: number; comment: string | null }) => {
    // ... verbatim body, replace `io` with `ctx.io` ...
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add server/socket/handlers/rating.ts
git commit -m "refactor(socket): extract rating handler to handlers/rating.ts"
```

---

## Task 8: Extract `handlers/disconnect.ts` — cleanup on disconnect

**Files:**
- Create: `server/socket/handlers/disconnect.ts`
- Reference: `server/socket/handlers.ts` lines 1196–1247 (`disconnect`)

- [ ] **Step 1: Create `handlers/disconnect.ts`**

This handler uses collision helpers from `collision.ts`:

```typescript
import { Socket } from 'socket.io';
import logger from '../../utils/logger.js';
import { Rooms } from '../../utils/rooms.js';
import * as presenceService from '../../services/presence.js';
import * as statusTracking from '../../services/statusTracking.js';
import { broadcastQueuePositions, broadcastAgentStatus } from '../../services/businessHours.js';
import { socketioConnectionsActive } from '../../utils/metrics.js';
import { removeViewerFromAll, broadcastViewers } from './collision.js';
import type { HandlerContext } from './types.js';

export function register(socket: Socket, ctx: HandlerContext) {
  // disconnect — moved verbatim from handlers.ts L1196–1247
  socket.on('disconnect', async () => {
    // ... verbatim body, replace `io` with `ctx.io` ...
    // Uses removeViewerFromAll(ctx.viewerKeyPrefix, socket.id, ctx.socketTickets)
    // and broadcastViewers(ctx.io, ctx.viewerKeyPrefix, ticketId) for each affected ticket
  });
}
```

- [ ] **Step 2: Migrate disconnect tests**

Create `server/socket/__tests__/disconnect.test.ts`. Move the `describe('disconnect handler', ...)` block (L388–427 from handlers.test.ts). Mock only: `presence`, `statusTracking`, `businessHours`, `metrics`, and the collision helpers.

- [ ] **Step 3: Run disconnect tests**

```bash
docker compose exec server npx vitest run server/socket/__tests__/disconnect.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/socket/handlers/disconnect.ts server/socket/__tests__/disconnect.test.ts
git commit -m "refactor(socket): extract disconnect handler to handlers/disconnect.ts"
```

---

## Task 9: Rewrite `handlers.ts` as slim orchestrator + migrate broadcast tests

**Files:**
- Modify: `server/socket/handlers.ts` (replace entirely)
- Create: `server/socket/__tests__/broadcast.test.ts`
- Delete: `server/socket/handlers.test.ts`

- [ ] **Step 1: Read current `handlers.ts`**

Verify all handler code has been extracted in Tasks 1–8.

- [ ] **Step 2: Rewrite `handlers.ts` as orchestrator**

Replace the entire file content with:

```typescript
import { Server } from 'socket.io';
import { socketioConnectionsActive } from '../utils/metrics.js';
import { Rooms } from '../utils/rooms.js';
import type { HandlerContext } from './handlers/types.js';
import { setupRevocationPubSub, setupJwtMiddleware, register as registerAuth } from './handlers/auth.js';
import { register as registerTicket } from './handlers/ticket.js';
import { register as registerMessage } from './handlers/message.js';
import { register as registerPresence } from './handlers/presence.js';
import { register as registerCollision } from './handlers/collision.js';
import { register as registerRating } from './handlers/rating.js';
import { register as registerDisconnect } from './handlers/disconnect.js';

const VIEWER_KEY_PREFIX = 'ticket:viewers:';
const socketTickets = new Map<string, Set<string>>();

let ioInstance: Server | null = null;

export function broadcastPartnerDeactivation(partnerId: string) {
  if (!ioInstance) return;
  ioInstance.to(Rooms.partner(partnerId)).emit('partner:deactivated', { partnerId });
}

export function broadcastUserDeactivation(userId: string) {
  if (!ioInstance) return;
  ioInstance.to(Rooms.user(userId)).emit('user:deactivated', { userId });
}

export function registerSocketHandlers(io: Server) {
  ioInstance = io;

  const ctx: HandlerContext = { io, socketTickets, viewerKeyPrefix: VIEWER_KEY_PREFIX };

  // ── One-time setup ─────────────────────────────────────────────────────────
  setupRevocationPubSub(io);
  setupJwtMiddleware(io);

  // ── Per-connection handler registration ────────────────────────────────────
  io.on('connection', (socket) => {
    socketioConnectionsActive.inc();

    registerAuth(socket, ctx);
    registerTicket(socket, ctx);
    registerMessage(socket, ctx);
    registerPresence(socket, ctx);
    registerCollision(socket, ctx);
    registerRating(socket, ctx);
    registerDisconnect(socket, ctx);
  });
}
```

- [ ] **Step 3: Create `__tests__/broadcast.test.ts`**

Move the `describe('broadcastPartnerDeactivation', ...)` and `describe('broadcastUserDeactivation', ...)` blocks from `handlers.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/metrics.js', () => ({
  socketioConnectionsActive: { inc: vi.fn(), dec: vi.fn() },
  socketioEventsTotal: { inc: vi.fn() },
}));

vi.mock('../../utils/rooms.js', () => ({
  Rooms: {
    partner: (id: string) => `partner:${id}`,
    staff: (id: string) => `partner:${id}:staff`,
    ticket: (id: string) => `ticket:${id}`,
    user: (id: string) => `user:${id}`,
  },
}));

describe('broadcastPartnerDeactivation', () => {
  it('emits partner:deactivated to the partner room', async () => {
    const mockIo = { to: vi.fn().mockReturnThis(), emit: vi.fn(), on: vi.fn(), use: vi.fn(), sockets: { sockets: new Map() } };
    // Mock all handler modules to no-op
    vi.doMock('../handlers/auth.js', () => ({ setupRevocationPubSub: vi.fn(), setupJwtMiddleware: vi.fn(), register: vi.fn() }));
    vi.doMock('../handlers/ticket.js', () => ({ register: vi.fn() }));
    vi.doMock('../handlers/message.js', () => ({ register: vi.fn() }));
    vi.doMock('../handlers/presence.js', () => ({ register: vi.fn() }));
    vi.doMock('../handlers/collision.js', () => ({ register: vi.fn() }));
    vi.doMock('../handlers/rating.js', () => ({ register: vi.fn() }));
    vi.doMock('../handlers/disconnect.js', () => ({ register: vi.fn() }));

    const { registerSocketHandlers, broadcastPartnerDeactivation } = await import('../handlers.js');
    registerSocketHandlers(mockIo as any);
    broadcastPartnerDeactivation('partner-1');
    expect(mockIo.to).toHaveBeenCalledWith('partner:partner-1');
    expect(mockIo.emit).toHaveBeenCalledWith('partner:deactivated', { partnerId: 'partner-1' });
  });
});

describe('broadcastUserDeactivation', () => {
  it('emits user:deactivated to the user room', async () => {
    const mockIo = { to: vi.fn().mockReturnThis(), emit: vi.fn(), on: vi.fn(), use: vi.fn(), sockets: { sockets: new Map() } };
    vi.doMock('../handlers/auth.js', () => ({ setupRevocationPubSub: vi.fn(), setupJwtMiddleware: vi.fn(), register: vi.fn() }));
    vi.doMock('../handlers/ticket.js', () => ({ register: vi.fn() }));
    vi.doMock('../handlers/message.js', () => ({ register: vi.fn() }));
    vi.doMock('../handlers/presence.js', () => ({ register: vi.fn() }));
    vi.doMock('../handlers/collision.js', () => ({ register: vi.fn() }));
    vi.doMock('../handlers/rating.js', () => ({ register: vi.fn() }));
    vi.doMock('../handlers/disconnect.js', () => ({ register: vi.fn() }));

    const { registerSocketHandlers, broadcastUserDeactivation } = await import('../handlers.js');
    registerSocketHandlers(mockIo as any);
    broadcastUserDeactivation('user-1');
    expect(mockIo.to).toHaveBeenCalledWith('user:user-1');
    expect(mockIo.emit).toHaveBeenCalledWith('user:deactivated', { userId: 'user-1' });
  });
});
```

- [ ] **Step 4: Delete old `handlers.test.ts`**

```bash
git rm server/socket/handlers.test.ts
```

- [ ] **Step 5: Run all socket tests**

```bash
docker compose exec server npx vitest run server/socket/
```

Expected: ALL PASS across `__tests__/types.test.ts`, `__tests__/auth.test.ts`, `__tests__/message.test.ts`, `__tests__/disconnect.test.ts`, `__tests__/broadcast.test.ts`.

- [ ] **Step 6: Run full typecheck**

```bash
docker compose exec server npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add server/socket/handlers.ts server/socket/__tests__/broadcast.test.ts
git rm server/socket/handlers.test.ts
git commit -m "refactor(socket): slim handlers.ts to orchestrator, complete handler split"
```

---

## Task 10: Full verification

- [ ] **Step 1: Run server typecheck**

```bash
docker compose exec server npx tsc --noEmit
```

- [ ] **Step 2: Run all server tests**

```bash
docker compose exec server npm test
```

- [ ] **Step 3: Run client typecheck and tests**

```bash
docker compose exec client npx tsc --noEmit
docker compose exec client npm test
```

- [ ] **Step 4: Smoke test manually**

Start the full stack with `docker compose up` and verify:
- Login works (JWT middleware intact)
- Creating a ticket works (`ticket:new`)
- Sending a message works (`message:send`)
- Real-time updates appear on both sides
- Disconnect/reconnect works cleanly

- [ ] **Step 5: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "refactor(socket): fix post-split issues"
```

---

## Summary

| Before | After |
|--------|-------|
| `handlers.ts` — 1,246 lines | `handlers.ts` — ~50 lines (orchestrator) |
| `handlers.test.ts` — 570 lines | 5 focused test files |
| 60 imports in one file | Each module imports only what it uses |
| 1 file to read for any socket change | Find the domain, read ~100-300 lines |

**Public API unchanged:** `registerSocketHandlers`, `broadcastPartnerDeactivation`, `broadcastUserDeactivation` all export from the same `server/socket/handlers.ts` path. No changes needed in `app.ts` or `platform.ts`.
