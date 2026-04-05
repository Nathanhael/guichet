# Message Reactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add emoji reactions to chat messages — fixed 6-emoji quick-react bar, socket-based toggle, brutalist styling.

**Architecture:** New `message:react` socket event toggles a user's emoji on a message's existing `reactions` JSONB column. Server broadcasts `reaction:updated` — client listener and store method already exist. MessageBubble gets a quick-react bar (hover) and reaction pills (below bubble).

**Tech Stack:** Socket.io, Drizzle ORM (existing JSONB column), React, Zustand (existing store method), Tailwind CSS with design tokens.

**Spec:** `docs/superpowers/specs/2026-04-05-message-reactions-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `server/constants.ts` | Modify | Add `REACTION_EMOJIS` constant |
| `server/services/messageQueries.ts` | Modify | Add `findMessageForReact()` and `updateMessageReactions()` |
| `server/socket/handlers.ts` | Modify | Add `message:react` socket handler |
| `client/src/constants.ts` | Modify | Add `REACTION_EMOJIS` constant |
| `client/src/components/MessageBubble.tsx` | Modify | Add quick-react bar + reaction pills |
| `server/__tests__/messageQueries.test.ts` | Create | Tests for new query helpers |

**Already wired (no changes):**
- `client/src/hooks/useSocket.ts` — `reaction:updated` listener exists
- `client/src/store/slices/messageSlice.ts` — `updateMessageReaction()` exists

---

### Task 1: Add REACTION_EMOJIS Constant (Server + Client)

**Files:**
- Modify: `server/constants.ts`
- Modify: `client/src/constants.ts`

- [ ] **Step 1: Add constant to server**

In `server/constants.ts`, add at the end of the file:

```ts
/** Fixed emoji set for message reactions */
export const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '🎉', '✅'] as const;
export type ReactionEmoji = typeof REACTION_EMOJIS[number];
```

- [ ] **Step 2: Add constant to client**

In `client/src/constants.ts`, add at the end of the file:

```ts
/** Fixed emoji set for message reactions (mirrors server/constants.ts) */
export const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '🎉', '✅'] as const;
```

- [ ] **Step 3: Commit**

```bash
git add server/constants.ts client/src/constants.ts
git commit -m "feat(reactions): add REACTION_EMOJIS constant to server and client"
```

---

### Task 2: Add Database Query Helpers

**Files:**
- Modify: `server/services/messageQueries.ts`

- [ ] **Step 1: Add `findMessageForReact` query**

In `server/services/messageQueries.ts`, add after the `findMessageForDelete` function (after line ~160):

```ts
/**
 * Fetches minimal message fields needed for reaction validation.
 * Used by: message:react
 */
export async function findMessageForReact(messageId: string, ticketId: string) {
  const rows = await db
    .select({
      id: messages.id,
      system: messages.system,
      deletedAt: messages.deletedAt,
      reactions: messages.reactions,
    })
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.ticketId, ticketId)));
  return rows[0];
}
```

- [ ] **Step 2: Add `updateMessageReactions` query**

In `server/services/messageQueries.ts`, add after `findMessageForReact`:

```ts
/**
 * Writes updated reactions JSONB to the message row.
 * Used by: message:react
 */
export async function updateMessageReactions(messageId: string, reactions: Record<string, string[]>) {
  await db
    .update(messages)
    .set({ reactions })
    .where(eq(messages.id, messageId));
}
```

- [ ] **Step 3: Commit**

```bash
git add server/services/messageQueries.ts
git commit -m "feat(reactions): add findMessageForReact and updateMessageReactions queries"
```

---

### Task 3: Add `message:react` Socket Handler

**Files:**
- Modify: `server/socket/handlers.ts`

- [ ] **Step 1: Add import for new query helpers and constant**

In `server/socket/handlers.ts`, update the import block from `messageQueries.js` (around line ~40) to add the new functions:

Find:
```ts
import {
  insertMessage,
  findTicketMessagesPaginated,
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

Replace with:
```ts
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
  type SocketMessage,
} from '../services/messageQueries.js';
```

Also add to the existing constants import (find where `REACTION_EMOJIS` needs to be added — look for the import from `../constants.js`). If no constants import exists, add:

```ts
import { REACTION_EMOJIS } from '../constants.js';
```

- [ ] **Step 2: Add the `message:react` handler**

In `server/socket/handlers.ts`, add the handler after the `message:delete` handler block (after line ~962, before the `// ── Ticket Transfer ──` comment):

```ts
    // ── Message Reactions ─────────────────────────────────────────────────────
    socket.on('message:react', async ({ ticketId, messageId, emoji }: { ticketId: string; messageId: string; emoji: string }) => {
      if (!requireIdentified(socket)) return;
      socketioEventsTotal.inc({ event: 'message:react' });
      try {
        const userId = socket.data.userId;
        if (!userId || !ticketId || !messageId || !emoji) return;

        // Validate emoji is in the allowed set
        if (!REACTION_EMOJIS.includes(emoji as typeof REACTION_EMOJIS[number])) {
          return socket.emit('error', { message: 'Invalid reaction emoji' });
        }

        // Tenant isolation
        const ticket = await requirePartnerScope(socket, ticketId);
        if (!ticket) return;

        // Fetch message and validate
        const msg = await findMessageForReact(messageId, ticketId);
        if (!msg) return;
        if (msg.system) return socket.emit('error', { message: 'Cannot react to system messages' });
        if (msg.deletedAt) return socket.emit('error', { message: 'Cannot react to deleted messages' });

        // Toggle reaction: add or remove userId
        const reactions: Record<string, string[]> = { ...(msg.reactions || {}) };
        const users = reactions[emoji] || [];
        const idx = users.indexOf(userId);
        if (idx >= 0) {
          users.splice(idx, 1);
          if (users.length === 0) {
            delete reactions[emoji];
          } else {
            reactions[emoji] = users;
          }
        } else {
          reactions[emoji] = [...users, userId];
        }

        await updateMessageReactions(messageId, reactions);

        io.to(Rooms.ticket(ticketId)).emit('reaction:updated', { ticketId, messageId, reactions });
      } catch (err: unknown) {
        logger.error({ err: err instanceof Error ? err.message : String(err) }, '[message:react] error');
      }
    });
```

- [ ] **Step 3: Verify server compiles**

```bash
docker compose exec server npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add server/socket/handlers.ts
git commit -m "feat(reactions): add message:react socket handler with toggle logic"
```

---

### Task 4: Add Reaction Pills to MessageBubble

**Files:**
- Modify: `client/src/components/MessageBubble.tsx`

- [ ] **Step 1: Add REACTION_EMOJIS import**

At the top of `client/src/components/MessageBubble.tsx`, add to the imports:

```ts
import { REACTION_EMOJIS } from '../constants';
```

- [ ] **Step 2: Add reaction pills below the timestamp area**

In `MessageBubble.tsx`, find the closing `</div>` of the timestamp area (the `flex items-center justify-end gap-2 mt-2` div). After that div and before the `{/* Action buttons (hover) */}` comment, add the reaction pills:

Find:
```tsx
        {/* Action buttons (hover) */}
```

Insert before it:
```tsx
        {/* Reaction pills */}
        {Object.keys(message.reactions || {}).length > 0 && (
          <div className={`flex flex-wrap gap-1 mt-1.5 ${isMine ? 'justify-end' : 'justify-start'}`}>
            {Object.entries(message.reactions).map(([emoji, userIds]) => {
              const count = userIds.length;
              if (count === 0) return null;
              const iReacted = userIds.includes(user?.id || '');
              return (
                <button
                  key={emoji}
                  onClick={() => getSocket().emit('message:react', { ticketId, messageId: message.id, emoji })}
                  disabled={isDeleted}
                  aria-label={`${emoji}, ${count} reaction${count !== 1 ? 's' : ''}${iReacted ? ', you reacted' : ''}`}
                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 font-mono text-[10px] font-bold border transition-colors ${
                    iReacted
                      ? 'border-accent-blue text-accent-blue bg-bg-elevated'
                      : 'border-border text-text-muted hover:border-text-muted'
                  } ${isDeleted ? 'opacity-40 cursor-default' : 'cursor-pointer'}`}
                >
                  <span>{emoji}</span>
                  <span>{count}</span>
                </button>
              );
            })}
          </div>
        )}

```

- [ ] **Step 3: Commit**

```bash
git add client/src/components/MessageBubble.tsx
git commit -m "feat(reactions): render reaction pills below message bubbles"
```

---

### Task 5: Add Quick-React Bar to MessageBubble

**Files:**
- Modify: `client/src/components/MessageBubble.tsx`

- [ ] **Step 1: Add quick-react bar in the action buttons area**

In `MessageBubble.tsx`, find the existing action buttons block:

```tsx
        {/* Action buttons (hover) */}
        {showActions && !editing && (canEdit || canDelete) && (
```

Replace the condition to also show when the message is reactable (not deleted, not system — both already checked by `showActions` which is gated on `!isDeleted`). Change the block to:

```tsx
        {/* Action buttons (hover) */}
        {showActions && !editing && (
          <div className={`absolute top-0 ${isMine ? 'left-0 -translate-x-full pl-1' : 'right-0 translate-x-full pr-1'} flex flex-col gap-0.5 opacity-0 group-hover:opacity-100`}>
            {/* Edit/Delete row */}
            {(canEdit || canDelete) && (
              <div className="flex gap-0.5">
                {canEdit && (
                  <button
                    onClick={startEdit}
                    title={t('edit') || 'Edit'}
                    className="w-6 h-6 flex items-center justify-center bg-bg-surface border border-border text-text-muted hover:text-accent-blue text-[10px]"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                  </button>
                )}
                {canDelete && (
                  <button
                    onClick={deleteMessage}
                    title={t('delete') || 'Delete'}
                    className="w-6 h-6 flex items-center justify-center bg-bg-surface border border-border text-text-muted hover:text-accent-red text-[10px]"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </button>
                )}
              </div>
            )}
            {/* Quick-react row */}
            <div className="flex gap-0.5">
              {REACTION_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => getSocket().emit('message:react', { ticketId, messageId: message.id, emoji })}
                  aria-label={`React with ${emoji}`}
                  className="w-6 h-6 flex items-center justify-center bg-bg-surface border border-border text-[11px] hover:bg-bg-elevated"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        )}
```

This replaces the entire old action buttons block (from `{/* Action buttons (hover) */}` through the closing `</div>` and `)}` of that block).

- [ ] **Step 2: Verify client compiles**

```bash
docker compose exec client npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/MessageBubble.tsx
git commit -m "feat(reactions): add quick-react emoji bar on message hover"
```

---

### Task 6: Verify End-to-End

- [ ] **Step 1: Rebuild and restart**

```bash
docker compose up --build -d
```

- [ ] **Step 2: Manual E2E test**

1. Open two browser windows (one agent, one support)
2. Create a ticket, send a message
3. Hover a message → verify 6 emoji buttons appear
4. Click 👍 → verify pill appears below the bubble with count "1"
5. In the other window → verify the reaction pill appears in real-time
6. Click the active 👍 pill → verify it toggles off (removes)
7. Verify: no reaction buttons on system messages
8. Verify: no reaction buttons on deleted messages
9. Verify: reactions work on closed tickets
10. Verify: reactions work on whisper messages

- [ ] **Step 3: Run existing test suites**

```bash
docker compose exec server npm test
docker compose exec client npm test
```

Expected: All existing tests pass (no regressions).

- [ ] **Step 4: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix(reactions): address issues found during E2E verification"
```
