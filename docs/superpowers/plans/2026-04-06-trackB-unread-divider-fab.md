# Track B: Unread Divider + Jump-to-Bottom FAB — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the existing `_unreadCount` state to a visible "NEW MESSAGES" divider in the message list and a floating jump-to-bottom button with unread badge.

**Architecture:** All changes land in `MessageList.tsx` (after Track 0 extraction) plus minor state plumbing in `ChatWindow.tsx`. No backend changes, no new dependencies.

**Tech Stack:** React 19, TypeScript, Lucide icons (`ArrowDown`), Tailwind CSS tokens

**Depends on:** Track 0 (ChatWindow decomposition) — MessageList must exist as a separate component.

---

### Task 1: Promote unread state from underscore-prefixed to real state

**Files:**
- Modify: `client/src/components/ChatWindow.tsx`

- [ ] **Step 1: Rename `_unreadCount` to `unreadCount`**

In `ChatWindow.tsx`, find:
```ts
const [_unreadCount, setUnreadCount] = useState(0);
```

Replace with:
```ts
const [unreadCount, setUnreadCount] = useState(0);
```

Remove the TODO comment on line 54 if it still exists.

- [ ] **Step 2: Add `firstUnreadIndex` state**

Below the `unreadCount` state, add:
```ts
const [firstUnreadIndex, setFirstUnreadIndex] = useState<number | null>(null);
```

- [ ] **Step 3: Promote `isNearBottom` to reactive state**

Currently `isNearBottomRef` is a ref (non-reactive). We need it to trigger re-renders for the FAB visibility. Add:

```ts
const [showScrollButton, setShowScrollButton] = useState(false);
```

Update `handleScroll` to set both:
```ts
function handleScroll() {
  const el = scrollContainerRef.current;
  if (!el) return;
  const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  isNearBottomRef.current = nearBottom;
  setShowScrollButton(!nearBottom);
  if (nearBottom) {
    setUnreadCount(0);
    setFirstUnreadIndex(null);
  }
}
```

- [ ] **Step 4: Set `firstUnreadIndex` when new messages arrive while scrolled away**

Find the existing logic that increments `setUnreadCount`. It's in the socket `message:new` handler effect. Add:

```ts
// Inside the message:new handler, after incrementing unread count:
setUnreadCount((prev) => prev + 1);
setFirstUnreadIndex((prev) => {
  if (prev !== null) return prev; // keep the first boundary
  const msgs = useStore.getState().messages[ticketId] || [];
  return msgs.length - 1; // index of the last message before new ones
});
```

- [ ] **Step 5: Reset on window focus**

In the existing `onFocus` handler that marks messages as read, add:

```ts
setFirstUnreadIndex(null);
```

- [ ] **Step 6: Add `scrollToBottom` callback**

```ts
function scrollToBottom() {
  const el = scrollContainerRef.current;
  if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  setUnreadCount(0);
  setFirstUnreadIndex(null);
  setShowScrollButton(false);
}
```

- [ ] **Step 7: Pass new props to MessageList**

```tsx
<MessageList
  // ... existing props
  unreadCount={unreadCount}
  firstUnreadIndex={firstUnreadIndex}
  showScrollButton={showScrollButton}
  onScrollToBottom={scrollToBottom}
/>
```

- [ ] **Step 8: Typecheck**

Run: `docker compose exec client npx tsc --noEmit`
Expected: No errors (MessageList will complain about new props — that's fixed in Task 2)

- [ ] **Step 9: Commit**

```bash
git add client/src/components/ChatWindow.tsx
git commit -m "feat(track-b): wire unread state and scroll-to-bottom callback in ChatWindow"
```

---

### Task 2: Add unread divider to MessageList

**Files:**
- Modify: `client/src/components/chat/MessageList.tsx`

- [ ] **Step 1: Update MessageList props interface**

Add to `MessageListProps`:
```ts
interface MessageListProps {
  // ... existing props
  unreadCount: number;
  firstUnreadIndex: number | null;
  showScrollButton: boolean;
  onScrollToBottom: () => void;
}
```

- [ ] **Step 2: Render the divider in the message loop**

Inside the message `.map()`, before rendering each `MessageBubble`, check if this is the divider position:

```tsx
{ticketMessages.map((msg, idx) => {
  const showDivider = firstUnreadIndex !== null && idx === firstUnreadIndex;
  return (
    <React.Fragment key={msg.id}>
      {showDivider && (
        <div className="flex items-center gap-3 my-3 px-4">
          <div className="flex-1 border-t border-accent-blue" />
          <span className="font-mono text-[8px] uppercase tracking-widest text-accent-blue bg-bg-surface px-2 shrink-0">
            {t('new_messages') || 'NEW MESSAGES'}
          </span>
          <div className="flex-1 border-t border-accent-blue" />
        </div>
      )}
      <MessageBubble
        message={msg}
        ticketId={ticketId}
        isGroupStart={isGroupStart(msg, idx)}
        isGroupEnd={isGroupEnd(msg, idx)}
        aiConfig={aiConfig}
      />
    </React.Fragment>
  );
})}
```

- [ ] **Step 3: Typecheck**

Run: `docker compose exec client npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add client/src/components/chat/MessageList.tsx
git commit -m "feat(track-b): add NEW MESSAGES divider to MessageList"
```

---

### Task 3: Add Jump-to-Bottom FAB

**Files:**
- Modify: `client/src/components/chat/MessageList.tsx`

- [ ] **Step 1: Import ArrowDown icon**

```ts
import { ArrowDown } from 'lucide-react';
```

- [ ] **Step 2: Add the FAB at the bottom of the scroll container**

Place this after the scroll container `div` but inside the outer wrapper, so it floats over the message area:

```tsx
{/* Jump-to-bottom FAB */}
{showScrollButton && (
  <button
    onClick={onScrollToBottom}
    className="absolute bottom-20 right-4 z-40 flex items-center gap-1.5 bg-bg-elevated border border-border-heavy px-3 py-2 hover:bg-bg-surface transition-opacity duration-150"
    aria-label={t('scroll_to_bottom') || 'Scroll to bottom'}
  >
    <ArrowDown size={14} className="text-text-primary" />
    {unreadCount > 0 && (
      <span className="bg-accent-blue text-btn-text-inverse font-mono text-[9px] px-1.5 py-0.5 min-w-[18px] text-center">
        {unreadCount > 99 ? '99+' : unreadCount}
      </span>
    )}
  </button>
)}
```

> **Note:** The FAB needs `position: relative` on the parent container to position correctly. Ensure the MessageList outer wrapper has `className="relative ..."`.

- [ ] **Step 3: Ensure the outer wrapper is `relative`**

Check that the top-level div of MessageList has `relative` in its className:

```tsx
return (
  <div className="relative flex-1 flex flex-col min-h-0 overflow-hidden">
    {/* scroll container */}
    <div ref={scrollContainerRef} onScroll={onScroll} className="flex-1 overflow-y-auto ...">
      {/* messages */}
    </div>
    {/* FAB sits here */}
  </div>
);
```

- [ ] **Step 4: Typecheck**

Run: `docker compose exec client npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add client/src/components/chat/MessageList.tsx
git commit -m "feat(track-b): add jump-to-bottom FAB with unread badge"
```

---

### Task 4: Add i18n keys

**Files:**
- Modify: i18n translation files (all 3 languages)

- [ ] **Step 1: Add translation keys**

Find the i18n files (likely `client/src/i18n/` or similar) and add:

| Key | EN | NL | FR |
|-----|----|----|-----|
| `new_messages` | `NEW MESSAGES` | `NIEUWE BERICHTEN` | `NOUVEAUX MESSAGES` |
| `scroll_to_bottom` | `Scroll to bottom` | `Scroll naar beneden` | `Défiler vers le bas` |

- [ ] **Step 2: Commit**

```bash
git add client/src/i18n/
git commit -m "feat(track-b): add i18n keys for unread divider and scroll FAB"
```

---

### Task 5: Test and verify

**Files:**
- No new test files (pure UI, manual verification)

- [ ] **Step 1: Manual smoke test**

1. Open SupportView with a ticket chat
2. Scroll up in the message list
3. Have the other party send a message (or use a second browser)
4. Verify: "NEW MESSAGES" divider appears at the boundary
5. Verify: FAB appears at bottom-right with "1" badge
6. Click the FAB → scrolls to bottom, divider fades, FAB disappears
7. Scroll up again, switch away from the tab, have messages sent
8. Switch back → divider visible, then clears as messages are marked read

- [ ] **Step 2: Run existing tests**

Run: `docker compose exec client npm test`
Expected: All existing tests still pass

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat(track-b): complete unread divider + jump-to-bottom FAB"
```

---

## Summary

Track B adds two visible UI elements to `MessageList`:
1. A "NEW MESSAGES" divider line (blue, mono, centered) at the unread boundary
2. A floating ↓ button with unread count badge that scrolls to bottom on click

Both use the existing `unreadCount` state (now properly wired) and a new `firstUnreadIndex` state. No backend changes.
