# Remaining Hardening & Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the pre-existing gdpr.test.ts failure, extend `requirePartnerScope` to cover the 5 remaining manual partner checks, remove the deprecated unbounded `findTicketMessages`, and add client-side "load older messages" support.

**Architecture:** Four independent workstreams: (1) fix the broken gdpr test, (2) create a `requirePartnerScopeWith` variant that accepts custom query functions so richer handlers can use the centralized guard, (3) remove `findTicketMessages` and migrate its last caller, (4) add client-side `message:morePage` listener and "load older" scroll trigger in ChatWindow.

**Tech Stack:** TypeScript, Socket.io, Vitest, React 19, Zustand 5

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `server/services/gdpr.test.ts:302-316` | Fix failing "DB down" test |
| Modify | `server/socket/partnerScope.ts` | Add `requirePartnerScopeWith` variant |
| Modify | `server/socket/__tests__/requirePartnerScope.test.ts` | Tests for new variant |
| Modify | `server/socket/handlers.ts` | Replace 5 remaining manual partner checks |
| Modify | `server/services/messageQueries.ts` | Remove `findTicketMessages` |
| Modify | `client/src/hooks/useSocket.ts` | Add `message:morePage` listener |
| Modify | `client/src/store/slices/messageSlice.ts` | Add `prependMessages` + `paginationCursors` state |
| Modify | `client/src/components/ChatWindow.tsx` | Add scroll-to-top "load older" trigger |

---

## Task 1: Fix gdpr.test.ts "DB down" test

**Files:**
- Modify: `server/services/gdpr.test.ts:302-316`

**Root cause:** The test mocks `archiveAuditLogMock.mockRejectedValue(new Error('DB down'))`, expecting `runDailyPurge()` to catch the error and log it. But `archiveAuditLog()` is called **outside** the `try/catch` block (line 13 of `gdpr.ts`) — intentionally, because archive failures must propagate to the caller to protect audit chain integrity. The test needs to simulate a failure **inside** the try/catch (e.g., the transaction).

- [ ] **Step 1: Read the current failing test**

The test at `server/services/gdpr.test.ts:302-316`:

```typescript
it('logs error and does not throw when purge fails', async () => {
    const logger = (await import('../utils/logger.js')).default;

    archiveAuditLogMock.mockRejectedValue(new Error('DB down'));

    const { runDailyPurge } = await import('./gdpr.js');

    // Should not throw
    await expect(runDailyPurge()).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      '[purge] Error during daily purge'
    );
  });
```

- [ ] **Step 2: Fix the test to simulate failure inside the try/catch**

Replace the test body. The fix: let archiving succeed (default mock), let chain verification pass (default mock), but make the **transaction** reject — that's inside the try/catch:

```typescript
  it('logs error and does not throw when purge fails', async () => {
    const logger = (await import('../utils/logger.js')).default;

    // Archiving and chain verification succeed (defaults).
    // Count query for guard check
    queryMock.mockResolvedValueOnce([{ count: 0 }]);
    // Dates query returns empty
    queryMock.mockResolvedValueOnce([]);
    // Transaction fails — this is INSIDE the try/catch
    transactionMock.mockRejectedValueOnce(new Error('DB down'));

    const { runDailyPurge } = await import('./gdpr.js');

    // Should not throw — error is caught and logged
    await expect(runDailyPurge()).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      '[purge] Error during daily purge'
    );
  });
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `docker compose exec server npx vitest run services/gdpr.test.ts`
Expected: 9/9 PASS (was 8/9 before)

- [ ] **Step 4: Commit**

```bash
git add server/services/gdpr.test.ts
git commit -m "fix(test): fix gdpr.test.ts 'DB down' test to simulate failure inside try/catch

The test was mocking archiveAuditLog to reject, but that function runs
OUTSIDE the try/catch (intentionally — archive failures must propagate).
Changed to mock the transaction rejecting, which IS inside the try/catch
and correctly tests the error-logging code path."
```

---

## Task 2: Add `requirePartnerScopeWith` variant

**Files:**
- Modify: `server/socket/partnerScope.ts`
- Modify: `server/socket/__tests__/requirePartnerScope.test.ts`

- [ ] **Step 1: Write the failing test for `requirePartnerScopeWith`**

Add to `server/socket/__tests__/requirePartnerScope.test.ts`:

```typescript
import { requirePartnerScope, requirePartnerScopeWith } from '../partnerScope.js';

// ... existing tests ...

describe('requirePartnerScopeWith', () => {
  it('returns full query result when partnerId matches', async () => {
    const customQuery = vi.fn().mockResolvedValue({ partnerId: 'p1', status: 'open', supportId: 'u2' });
    const socket = mockSocket('p1');

    const result = await requirePartnerScopeWith(socket, 'ticket-1', customQuery);

    expect(customQuery).toHaveBeenCalledWith('ticket-1');
    expect(result).toEqual({ partnerId: 'p1', status: 'open', supportId: 'u2' });
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('returns null and emits error when partnerId does not match', async () => {
    const customQuery = vi.fn().mockResolvedValue({ partnerId: 'p2', status: 'open' });
    const socket = mockSocket('p1');

    const result = await requirePartnerScopeWith(socket, 'ticket-1', customQuery);

    expect(result).toBeNull();
    expect(socket.emit).toHaveBeenCalledWith('error', { message: 'Not authorized' });
  });

  it('returns null when query returns undefined', async () => {
    const customQuery = vi.fn().mockResolvedValue(undefined);
    const socket = mockSocket('p1');

    const result = await requirePartnerScopeWith(socket, 'ticket-1', customQuery);

    expect(result).toBeNull();
    expect(socket.emit).toHaveBeenCalledWith('error', { message: 'Not authorized' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec server npx vitest run socket/__tests__/requirePartnerScope.test.ts`
Expected: FAIL — `requirePartnerScopeWith` not exported

- [ ] **Step 3: Implement `requirePartnerScopeWith`**

Add to `server/socket/partnerScope.ts`:

```typescript
/**
 * Generic tenant isolation guard that accepts a custom query function.
 *
 * Use this when the handler needs more than just partnerId from the ticket
 * (e.g., findTicketForClose returns { status, partnerId }).
 * The query function must return an object with a `partnerId` field.
 *
 * Usage:
 *   const ticket = await requirePartnerScopeWith(socket, ticketId, findTicketForClose);
 *   if (!ticket) return;
 *   // ticket is typed as the return type of findTicketForClose
 */
export async function requirePartnerScopeWith<T extends { partnerId: string }>(
  socket: Socket,
  ticketId: string,
  queryFn: (ticketId: string) => Promise<T | undefined>,
): Promise<T | null> {
  const ticket = await queryFn(ticketId);
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

Run: `docker compose exec server npx vitest run socket/__tests__/requirePartnerScope.test.ts`
Expected: 6/6 PASS

- [ ] **Step 5: Commit**

```bash
git add server/socket/partnerScope.ts server/socket/__tests__/requirePartnerScope.test.ts
git commit -m "feat(security): add generic requirePartnerScopeWith for richer queries

Adds a typed variant that accepts a custom query function, so handlers
needing more than just partnerId (e.g. findTicketForClose) can still
use the centralized tenant isolation guard with audit logging."
```

---

## Task 3: Replace 5 remaining manual partner checks

**Files:**
- Modify: `server/socket/handlers.ts`

The 5 handlers with manual checks and the queries they use:

| Handler | Line | Query Function | Extra fields needed |
|---------|------|---------------|-------------------|
| `support:join` | ~549 | `findTicketForJoin` | `supportId`, `status`, `participants` |
| `support:leave` | ~619 | `findTicketParticipants` | `participants` |
| `ticket:close` | ~654 | `findTicketForClose` | `status` |
| `rating:submit` | ~688 | raw `get()` query | `agent_id`, `support_id` |
| `message:send` | ~720 | `findTicketForMessage` | `status`, `dept` |
| `ticket:transfer` | ~944 | `findTicketForTransfer` | `supportId`, `supportName`, `participants` |

Note: `rating:submit` uses a raw `get()` query that doesn't return a typed `partnerId` field from a query function — it uses `partner_id` (snake_case). This one should keep its manual check or be refactored to use a proper query function. For pragmatism, leave `rating:submit` as-is and migrate the other 5.

- [ ] **Step 1: Add the import**

Add `requirePartnerScopeWith` to the import from `./partnerScope.js`:

```typescript
import { requirePartnerScope, requirePartnerScopeWith } from './partnerScope.js';
```

- [ ] **Step 2: Replace `support:join` manual check**

Current pattern (inside the handler):
```typescript
const ticket = await findTicketForJoin(ticketId);
if (!ticket || ticket.partnerId !== callerPartnerId) {
  return socket.emit('error', { message: 'Not authorized for this ticket' });
}
```

Replace with:
```typescript
const ticket = await requirePartnerScopeWith(socket, ticketId, findTicketForJoin);
if (!ticket) return;
```

The `callerPartnerId` variable was `socket.data.partnerId` — the guard uses the same value.

- [ ] **Step 3: Replace `support:leave` manual check**

Current pattern:
```typescript
const ticket = await findTicketParticipants(ticketId);
if (!ticket || ticket.partnerId !== socket.data.partnerId) { ... }
```

Replace with:
```typescript
const ticket = await requirePartnerScopeWith(socket, ticketId, findTicketParticipants);
if (!ticket) return;
```

Note: Verify `findTicketParticipants` returns `{ partnerId: string, ... }`. If it doesn't include `partnerId`, you'll need to keep the existing pattern or add `partnerId` to its query.

- [ ] **Step 4: Replace `ticket:close` manual check**

Current pattern:
```typescript
const ticket = await findTicketForClose(ticketId);
if (!ticket || ticket.partnerId !== socket.data.partnerId) { ... }
```

Replace with:
```typescript
const ticket = await requirePartnerScopeWith(socket, ticketId, findTicketForClose);
if (!ticket) return;
```

- [ ] **Step 5: Replace `message:send` manual check**

Current pattern:
```typescript
const ticket = await findTicketForMessage(ticketId);
if (!ticket || ticket.partnerId !== socket.data.partnerId) { ... }
```

Replace with:
```typescript
const ticket = await requirePartnerScopeWith(socket, ticketId, findTicketForMessage);
if (!ticket) return;
```

- [ ] **Step 6: Replace `ticket:transfer` manual check**

Current pattern:
```typescript
const ticket = await findTicketForTransfer(ticketId);
if (!ticket || ticket.partnerId !== callerPartnerId) { ... }
```

Replace with:
```typescript
const ticket = await requirePartnerScopeWith(socket, ticketId, findTicketForTransfer);
if (!ticket) return;
```

- [ ] **Step 7: Run tests**

Run: `docker compose exec server npx vitest run socket/handlers.test.ts`
Run: `docker compose exec server npx vitest run __tests__/isolation.test.ts`
Expected: PASS

- [ ] **Step 8: Run typecheck**

Run: `docker compose exec server npx tsc --noEmit`
Expected: Clean

- [ ] **Step 9: Commit**

```bash
git add server/socket/handlers.ts
git commit -m "refactor(security): migrate 5 remaining handlers to requirePartnerScopeWith

support:join, support:leave, ticket:close, message:send, and
ticket:transfer now use the centralized tenant isolation guard with
their richer query functions. Only rating:submit retains a manual
check (uses raw SQL with snake_case fields)."
```

---

## Task 4: Remove deprecated `findTicketMessages`

**Files:**
- Modify: `server/services/messageQueries.ts`
- Modify: `server/services/messageQueries.test.ts` (if tests exist for the old function)

- [ ] **Step 1: Verify no callers remain**

Run: `grep -rn 'findTicketMessages[^P]' server/ --include='*.ts' | grep -v node_modules | grep -v '.test.'`

Expected: Only the definition in `messageQueries.ts:68`. If any other callers exist, migrate them to `findTicketMessagesPaginated` first.

- [ ] **Step 2: Remove the function**

Delete `findTicketMessages` from `server/services/messageQueries.ts` (lines 64-74):

```typescript
// DELETE this entire function:
/**
 * Fetches all messages for a ticket, ordered by creation time.
 * Used by: support:join (ticket history)
 */
export async function findTicketMessages(ticketId: string) {
  return db
    .select()
    .from(messages)
    .where(eq(messages.ticketId, ticketId))
    .orderBy(asc(messages.createdAt));
}
```

- [ ] **Step 3: Remove any tests for the old function**

If `messageQueries.test.ts` has tests for `findTicketMessages` (not `findTicketMessagesPaginated`), remove them.

- [ ] **Step 4: Run typecheck and tests**

Run: `docker compose exec server npx tsc --noEmit`
Run: `docker compose exec server npx vitest run services/messageQueries.test.ts`
Expected: Clean, all pass

- [ ] **Step 5: Commit**

```bash
git add server/services/messageQueries.ts server/services/messageQueries.test.ts
git commit -m "chore: remove deprecated unbounded findTicketMessages

All callers migrated to findTicketMessagesPaginated. The unbounded
query was a memory bloat risk on long-lived tickets."
```

---

## Task 5: Client-side pagination — store and hook

**Files:**
- Modify: `client/src/store/slices/messageSlice.ts`
- Modify: `client/src/hooks/useSocket.ts`

- [ ] **Step 1: Add pagination state to messageSlice**

In `client/src/store/slices/messageSlice.ts`, add cursor tracking and a `prependMessages` action:

```typescript
export interface MessageSlice {
  messages: Record<string, Message[]>;
  messageCursors: Record<string, { hasMore: boolean; nextCursor?: string; loading: boolean }>;
  onlineSupportUsers: OnlineSupport[];
  typingUsers: Record<string, Record<string, boolean>>;

  setMessages: (ticketId: string, messages: Message[]) => void;
  addMessage: (ticketId: string, message: Message) => void;
  prependMessages: (ticketId: string, messages: Message[]) => void;
  setMessageCursor: (ticketId: string, hasMore: boolean, nextCursor?: string) => void;
  setMessageLoading: (ticketId: string, loading: boolean) => void;
  updateMessageState: (ticketId: string, messageId: string, updates: Partial<Message>) => void;
  updateMessageReaction: (ticketId: string, messageId: string, reactions: Record<string, string[]>) => void;
  setOnlineSupportUsers: (list: OnlineSupport[]) => void;
  setTyping: (ticketId: string, name: string, isTyping: boolean) => void;
}
```

Add the new state and actions in the creator:

```typescript
  messageCursors: {},

  prependMessages: (ticketId, newMessages) =>
    set((state) => {
      const existing = state.messages[ticketId] || [];
      const msgMap = new Map();
      newMessages.forEach(m => msgMap.set(m.id, m));
      existing.forEach(m => msgMap.set(m.id, m)); // existing wins on conflict
      const merged = Array.from(msgMap.values()).sort((a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
      return { messages: { ...state.messages, [ticketId]: merged } };
    }),

  setMessageCursor: (ticketId, hasMore, nextCursor) =>
    set((state) => ({
      messageCursors: {
        ...state.messageCursors,
        [ticketId]: { ...state.messageCursors[ticketId], hasMore, nextCursor, loading: false },
      },
    })),

  setMessageLoading: (ticketId, loading) =>
    set((state) => ({
      messageCursors: {
        ...state.messageCursors,
        [ticketId]: { ...state.messageCursors[ticketId], hasMore: state.messageCursors[ticketId]?.hasMore ?? false, loading },
      },
    })),
```

- [ ] **Step 2: Update `handleTicketHistory` in useSocket to store cursor**

In `client/src/hooks/useSocket.ts`, update the `handleTicketHistory` handler:

```typescript
const handleTicketHistory = ({ ticketId, messages, labels, hasMore, nextCursor }: {
  ticketId: string;
  messages: Message[];
  labels: string[];
  hasMore?: boolean;
  nextCursor?: string;
}) => {
  setMessages(ticketId, messages);
  if (labels) updateTicket(ticketId, { labels });
  // Store pagination cursor
  const setMessageCursor = useStore.getState().setMessageCursor;
  if (hasMore !== undefined) {
    setMessageCursor(ticketId, hasMore, nextCursor);
  }
};
```

- [ ] **Step 3: Add `message:morePage` listener in useSocket**

Add a new handler and listener:

```typescript
const handleMorePage = ({ ticketId, messages, hasMore, nextCursor }: {
  ticketId: string;
  messages: Message[];
  hasMore: boolean;
  nextCursor?: string;
}) => {
  const { prependMessages, setMessageCursor } = useStore.getState();
  prependMessages(ticketId, messages);
  setMessageCursor(ticketId, hasMore, nextCursor);
};
```

Register it alongside the other listeners:
```typescript
s.on('message:morePage', handleMorePage);
```

And in the cleanup:
```typescript
s.off('message:morePage', handleMorePage);
```

- [ ] **Step 4: Add `prependMessages` and `setMessageCursor` to the useStore destructure**

In the `useSocket` hook, add them to the store destructure or access via `useStore.getState()` (the latter is better since these are called from event handlers, not render).

- [ ] **Step 5: Run client tests**

Run: `docker compose exec client npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add client/src/store/slices/messageSlice.ts client/src/hooks/useSocket.ts
git commit -m "feat(client): add pagination state and message:morePage socket listener

Adds messageCursors state tracking (hasMore, nextCursor, loading) and
prependMessages action to the message slice. useSocket now handles
the ticket:history hasMore/nextCursor fields and the new
message:morePage event for loading older messages."
```

---

## Task 6: Client-side "load older messages" in ChatWindow

**Files:**
- Modify: `client/src/components/ChatWindow.tsx`

- [ ] **Step 1: Add the scroll-to-top trigger**

In `ChatWindow.tsx`, add a "load older messages" mechanism that triggers when the user scrolls to the top of the message container. This uses the `scrollContainerRef` that already exists:

```typescript
// Add to the component's state section:
const { messageCursors, setMessageLoading } = useStore();
const cursorInfo = ticket ? messageCursors[ticket.id] : undefined;

// Add a loadOlder function:
function loadOlderMessages() {
  if (!ticket || !cursorInfo?.hasMore || cursorInfo?.loading || !cursorInfo?.nextCursor) return;
  setMessageLoading(ticket.id, true);
  getSocket().emit('message:loadMore', {
    ticketId: ticket.id,
    cursor: cursorInfo.nextCursor,
  });
}

// Add scroll handler that detects scroll-to-top:
function handleScroll() {
  const el = scrollContainerRef.current;
  if (!el) return;
  isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  if (isNearBottomRef.current) setUnreadCount(0);

  // Load older messages when scrolled to top
  if (el.scrollTop < 50) {
    loadOlderMessages();
  }
}
```

Note: The `handleScroll` function may already exist — merge the scroll-to-top check into it rather than replacing it.

- [ ] **Step 2: Add the "load older" indicator in the JSX**

Inside the message container, before the messages list, add a loading indicator:

```tsx
{cursorInfo?.hasMore && (
  <div className="flex justify-center py-2">
    {cursorInfo.loading ? (
      <span className="text-xs font-mono text-text-secondary">Loading...</span>
    ) : (
      <button
        onClick={loadOlderMessages}
        className="text-xs font-mono text-text-secondary hover:text-text-primary transition-colors"
      >
        Load older messages
      </button>
    )}
  </div>
)}
```

- [ ] **Step 3: Preserve scroll position when prepending messages**

When older messages are prepended, the scroll position jumps. Add a `useEffect` that preserves the scroll position:

```typescript
// Track previous message count per ticket to detect prepends
const prevMsgCountRef = useRef<number>(0);

useEffect(() => {
  const el = scrollContainerRef.current;
  if (!el || !ticket) return;
  const currentMsgs = ticketMessages.length;
  const prevCount = prevMsgCountRef.current;

  if (currentMsgs > prevCount && prevCount > 0 && el.scrollTop < 100) {
    // Messages were prepended — preserve relative scroll position
    // The new messages added height at the top, so scroll down by that amount
    requestAnimationFrame(() => {
      const newScrollHeight = el.scrollHeight;
      // Estimate: each prepended message adds some height
      // Simpler: just don't auto-scroll to bottom when prepending
    });
  }
  prevMsgCountRef.current = currentMsgs;
}, [ticketMessages.length, ticket]);
```

A simpler approach: only auto-scroll to bottom on **new** messages (addMessage), not on prepend. The existing auto-scroll logic already checks `isNearBottomRef.current`, so if the user scrolled to top to load older messages, `isNearBottom` is false and it won't scroll to bottom. This should work without any changes.

- [ ] **Step 4: Run client typecheck and tests**

Run: `docker compose exec client npx tsc --noEmit`
Run: `docker compose exec client npm test`
Expected: Clean, all pass

- [ ] **Step 5: Commit**

```bash
git add client/src/components/ChatWindow.tsx
git commit -m "feat(client): add 'load older messages' scroll trigger in ChatWindow

When user scrolls to top of message container, emits message:loadMore
to fetch the previous page. Shows a loading indicator and a manual
'Load older messages' button as fallback. Auto-scroll to bottom is
already guarded by isNearBottom so it won't fight the user."
```

---

## Summary of Changes

| Task | What | Impact |
|------|------|--------|
| 1 | Fix gdpr.test.ts | Pre-existing test failure resolved |
| 2 | `requirePartnerScopeWith` variant | Typed generic guard for richer queries |
| 3 | Migrate 5 remaining handlers | Consistent tenant isolation across all socket events |
| 4 | Remove `findTicketMessages` | Eliminate unbounded query footgun |
| 5 | Client pagination state + hook | Store cursors, handle `message:morePage` |
| 6 | ChatWindow scroll trigger | User-facing "load older messages" UX |
