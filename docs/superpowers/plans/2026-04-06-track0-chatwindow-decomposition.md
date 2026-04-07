# Track 0: ChatWindow Decomposition — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the 1,137-line `ChatWindow.tsx` into three focused sub-components (`ChatHeader`, `MessageList`, `ComposeArea`) plus a thin shell, with zero behavior changes.

**Architecture:** Extract by visual section — the header (lines 544-826), message scroll area (lines 827-907), and compose/input area (lines 908-1130) each become their own component. ChatWindow retains shared state, socket subscriptions, and wires the three together via props. New files go into `client/src/components/chat/`.

**Tech Stack:** React 19, TypeScript, Zustand, Socket.io client, tRPC, Lucide icons

---

### Task 1: Create the `chat/` directory and barrel export

**Files:**
- Create: `client/src/components/chat/index.ts`

- [ ] **Step 1: Create directory and barrel file**

```ts
// client/src/components/chat/index.ts
export { default as ChatHeader } from './ChatHeader';
export { default as MessageList } from './MessageList';
export { default as ComposeArea } from './ComposeArea';
```

- [ ] **Step 2: Verify the directory exists**

Run: `docker compose exec client ls src/components/chat/`
Expected: `index.ts` listed

- [ ] **Step 3: Commit**

```bash
git add client/src/components/chat/index.ts
git commit -m "chore: create chat/ sub-component directory with barrel export"
```

---

### Task 2: Extract `ChatHeader.tsx`

**Files:**
- Create: `client/src/components/chat/ChatHeader.tsx`
- Modify: `client/src/components/ChatWindow.tsx` (remove header JSX, import ChatHeader)

The header section spans lines 544-826 in the current ChatWindow. It includes: dept badge, agent name, online indicator, participant badges, labels, SLA indicator, summarize button, transfer menu, close/leave buttons, references, AI summary card, and collision viewer badges.

- [ ] **Step 1: Create ChatHeader with the interface**

```tsx
// client/src/components/chat/ChatHeader.tsx
import React, { useState } from 'react';
import { useStoreShallow } from '../../store/useStore';
import { getSocket } from '../../hooks/useSocket';
import { useT } from '../../i18n';
import { usePartner } from '../../hooks/usePartner';
import { isSupportLike } from '../../utils/roles';
import { Ticket, Message, Label } from '../../types';
import { trpc } from '../../utils/trpc';
import SlaIndicator from '../SlaIndicator';
import UserAvatar from '../UserAvatar';
import { Eye } from 'lucide-react';

interface ChatHeaderProps {
  ticket: Ticket;
  liveTicket: Ticket;
  isSupport: boolean;
  isClosed: boolean;
  focusMode: boolean;
  compact: boolean;
  onClose?: () => void;
  // Transfer
  showTransferMenu: boolean;
  setShowTransferMenu: (v: boolean) => void;
  onTransfer: (departmentId?: string) => void;
  // Summary
  summary: string | null;
  showSummary: boolean;
  summarizing: boolean;
  onSummarize: (refresh?: boolean) => void;
  onDismissSummary: () => void;
  // Viewers
  viewers: Array<{ userId: string; userName: string }>;
  // Improve state for header display
  improving: boolean;
}

export default function ChatHeader({
  ticket, liveTicket, isSupport, isClosed, focusMode, compact, onClose,
  showTransferMenu, setShowTransferMenu, onTransfer,
  summary, showSummary, summarizing, onSummarize, onDismissSummary,
  viewers, improving,
}: ChatHeaderProps) {
  const { user, allLabels, activePartnerId } = useStoreShallow(s => ({
    user: s.user,
    allLabels: s.allLabels,
    activePartnerId: s.activePartnerId,
  }));
  const t = useT();
  const { role: activeRole, manifest } = usePartner();
  const [transferNote, setTransferNote] = useState('');

  const getLabelInfo = (id: string) => (allLabels || []).find((l: Label) => l.id === id);

  const transferDepartments = (manifest?.departments || []).filter(
    (d: { id: string }) => d.id !== ticket.dept
  );

  const supportParticipants = (liveTicket.participants || []).filter(
    (p: { visibleRole?: string }) => p.visibleRole === 'support' || p.visibleRole === 'admin'
  );

  // Paste the entire header JSX from ChatWindow lines 544-826 here.
  // This is a move operation — cut from ChatWindow, paste here.
  // The JSX starts with: <div className={`relative z-50 flex items-center...
  // and ends just before: {/* Messages */}
  return (
    // ... header JSX moved from ChatWindow
    <></>
  );
}
```

> **Implementation note:** The actual JSX is ~280 lines. The implementer must CUT lines 544-826 from ChatWindow.tsx and paste them into the return statement of ChatHeader. All local references (`ticket`, `liveTicket`, `isSupport`, etc.) are already available via props. Store access (`user`, `allLabels`, `activePartnerId`) is read via the component's own `useStoreShallow`. The `transferNote` state is local to this component since it's only used in the transfer menu dropdown.

- [ ] **Step 2: Update ChatWindow to import and use ChatHeader**

In `ChatWindow.tsx`, replace the header JSX block (lines 544-826) with:

```tsx
import { ChatHeader } from './chat';

// Inside the return, replace the header section with:
<ChatHeader
  ticket={ticket}
  liveTicket={liveTicket}
  isSupport={isSupport}
  isClosed={isClosed}
  focusMode={focusMode}
  compact={compact ?? false}
  onClose={onClose}
  showTransferMenu={showTransferMenu}
  setShowTransferMenu={setShowTransferMenu}
  onTransfer={transferTicket}
  summary={summary}
  showSummary={showSummary}
  summarizing={summarizing}
  onSummarize={handleSummarize}
  onDismissSummary={() => setShowSummary(false)}
  viewers={viewers}
  improving={improving}
/>
```

Also remove from ChatWindow:
- `const [transferNote, setTransferNote] = useState('')` (line 59) — moved to ChatHeader
- `const transferDepartments = ...` (line 534) — moved to ChatHeader
- `const supportParticipants = ...` (line 578) — moved to ChatHeader
- `const getLabelInfo = ...` (line 335) — moved to ChatHeader
- The `copiedRef` / `setCopiedRef` state (line 42) — only used in header references section

- [ ] **Step 3: Typecheck**

Run: `docker compose exec client npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add client/src/components/chat/ChatHeader.tsx client/src/components/ChatWindow.tsx
git commit -m "refactor: extract ChatHeader from ChatWindow (~280 lines)"
```

---

### Task 3: Extract `MessageList.tsx`

**Files:**
- Create: `client/src/components/chat/MessageList.tsx`
- Modify: `client/src/components/ChatWindow.tsx` (remove message loop, import MessageList)

The message area spans lines 827-907 in the current ChatWindow (after header extraction, line numbers will have shifted — use the `{/* Messages */}` comment as anchor). It includes: load-older button, scroll container, message rendering loop with grouping logic, typing indicator, and the bottom ref.

- [ ] **Step 1: Create MessageList component**

```tsx
// client/src/components/chat/MessageList.tsx
import React, { useRef, useEffect, useCallback } from 'react';
import { useStoreShallow } from '../../store/useStore';
import { useT } from '../../i18n';
import MessageBubble from '../MessageBubble';
import { Ticket, Message } from '../../types';
import { trpc } from '../../utils/trpc';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../../../../server/trpc/router';

type AiConfig = inferRouterOutputs<AppRouter>['partner']['getAiConfig'];

interface CursorInfo {
  hasMore: boolean;
  loading: boolean;
  nextCursor?: string;
}

interface MessageListProps {
  ticket: Ticket;
  messages: Message[];
  cursorInfo?: CursorInfo;
  onLoadOlder: () => void;
  focusMode: boolean;
  compact: boolean;
  // Scroll management — parent needs to know scroll position for unread tracking
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  bottomRef: React.RefObject<HTMLDivElement | null>;
  onScroll: () => void;
}

export default function MessageList({
  ticket, messages, cursorInfo, onLoadOlder,
  focusMode, compact,
  scrollContainerRef, bottomRef, onScroll,
}: MessageListProps) {
  const { user, typingUsers, participantsOnline } = useStoreShallow(s => ({
    user: s.user,
    typingUsers: s.typingUsers,
    participantsOnline: s.participantsOnline,
  }));
  const t = useT();
  const { role: activeRole } = usePartner();

  // AI config for MessageBubble
  const aiConfigQuery = trpc.partner.getAiConfig.useQuery(undefined, {
    staleTime: 60_000,
  });
  const aiConfig = aiConfigQuery.data;

  const ticketId = ticket.id;
  const isSupport = isSupportLike(activeRole);
  const ticketMessages = messages;

  // Typing users for this ticket (exclude self)
  const ticketTyping = (typingUsers[ticketId] || []).filter(
    (tu: { userId: string }) => tu.userId !== user?.id
  );

  // Message grouping: same sender within 2 minutes
  const isGroupStart = (msg: Message, idx: number) => {
    if (idx === 0) return true;
    const prev = ticketMessages[idx - 1];
    if (!prev) return true;
    return prev.senderId !== msg.senderId ||
      new Date(msg.timestamp || msg.createdAt || '').getTime() -
      new Date(prev.timestamp || prev.createdAt || '').getTime() > 120_000;
  };
  const isGroupEnd = (msg: Message, idx: number) => {
    if (idx === ticketMessages.length - 1) return true;
    const next = ticketMessages[idx + 1];
    if (!next) return true;
    return next.senderId !== msg.senderId ||
      new Date(next.timestamp || next.createdAt || '').getTime() -
      new Date(msg.timestamp || msg.createdAt || '').getTime() > 120_000;
  };

  // Paste the message area JSX from ChatWindow here.
  // This is the section from {/* Messages */} to just before {/* Input */}.
  // Includes: load-older button, scroll container with map, typing indicator, bottomRef.
  return (
    // ... messages JSX moved from ChatWindow
    <></>
  );
}
```

> **Implementation note:** The implementer must:
> 1. Move the `{/* Messages */}` section from ChatWindow into MessageList's return
> 2. Add missing imports: `usePartner`, `isSupportLike` 
> 3. The `aiConfig` tRPC query currently lives in ChatWindow — move it here since only MessageBubble uses it
> 4. The scroll refs (`scrollContainerRef`, `bottomRef`) are passed from parent since ChatWindow needs them for auto-scroll logic in socket handlers
> 5. The message grouping logic (`isGroupStart`/`isGroupEnd`) — check current ChatWindow for the exact implementation; the above is the pattern, adjust to match

- [ ] **Step 2: Update ChatWindow to import and use MessageList**

In `ChatWindow.tsx`, replace the messages JSX block with:

```tsx
import { ChatHeader, MessageList } from './chat';

// Inside the return, replace the messages section with:
<MessageList
  ticket={ticket}
  messages={ticketMessages}
  cursorInfo={cursorInfo}
  onLoadOlder={loadOlderMessages}
  focusMode={focusMode}
  compact={compact ?? false}
  scrollContainerRef={scrollContainerRef}
  bottomRef={bottomRef}
  onScroll={handleScroll}
/>
```

Also remove from ChatWindow:
- The `aiConfig` tRPC query (if it was only used for MessageBubble)
- The message grouping helper functions (if they existed inline)
- The typing indicator JSX

- [ ] **Step 3: Typecheck**

Run: `docker compose exec client npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add client/src/components/chat/MessageList.tsx client/src/components/ChatWindow.tsx
git commit -m "refactor: extract MessageList from ChatWindow (~200 lines)"
```

---

### Task 4: Extract `ComposeArea.tsx`

**Files:**
- Create: `client/src/components/chat/ComposeArea.tsx`
- Modify: `client/src/components/ChatWindow.tsx` (remove compose JSX, import ComposeArea)

The compose area spans from `{/* Input */}` (line ~908) to the end of the return. It includes: AI revert bar, media preview strip, textarea, whisper toggle, file upload button, emoji picker, AI improve button, and send button.

- [ ] **Step 1: Create ComposeArea component**

```tsx
// client/src/components/chat/ComposeArea.tsx
import React, { useState, useRef, useEffect } from 'react';
import { useStoreShallow } from '../../store/useStore';
import { getSocket } from '../../hooks/useSocket';
import { useT } from '../../i18n';
import { usePartner } from '../../hooks/usePartner';
import { isSupportLike } from '../../utils/roles';
import { Ticket, Message } from '../../types';
import { trpc } from '../../utils/trpc';
import { REACTION_EMOJIS } from '../../constants';

interface ComposeAreaProps {
  ticket: Ticket;
  isClosed: boolean;
  isSupport: boolean;
  focusMode: boolean;
  compact: boolean;
  // AI improve state — shared with header (header shows "improving" spinner)
  improving: boolean;
  setImproving: (v: boolean) => void;
  originalText: string | null;
  setOriginalText: (v: string | null) => void;
}

export default function ComposeArea({
  ticket, isClosed, isSupport, focusMode, compact,
  improving, setImproving, originalText, setOriginalText,
}: ComposeAreaProps) {
  const { user, activePartnerId } = useStoreShallow(s => ({
    user: s.user,
    activePartnerId: s.activePartnerId,
  }));
  const t = useT();
  const { manifest } = usePartner();

  // Local state — these are compose-only concerns
  const [text, setText] = useState('');
  const [whisperMode, setWhisperMode] = useState(false);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isTypingRef = useRef(false);

  // Revoke Object URL on cleanup
  useEffect(() => {
    return () => { if (mediaPreview) URL.revokeObjectURL(mediaPreview); };
  }, [mediaPreview]);

  const autoResize = () => {
    const el = textareaRef.current;
    if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; }
  };

  // Move these functions from ChatWindow:
  // - emitTyping()
  // - stopTyping()
  // - uploadFile()
  // - handleFileChange()
  // - handlePaste()
  // - clearMedia()
  // - doSend()
  // - sendMessage()
  // - handleImprove()
  // - revertImprove()
  // - improveAndSend()

  // Paste the input area JSX from ChatWindow here.
  // This is from {/* Input */} to the closing </div> of the outer container.
  return (
    // ... compose JSX moved from ChatWindow
    <></>
  );
}
```

> **Implementation note:** The implementer must:
> 1. Move all compose-related state from ChatWindow: `text`, `whisperMode`, `mediaUrl`, `mediaPreview`, `uploading`, `showEmojiPicker` (lines 40-46, 58)
> 2. Move compose-related refs: `textareaRef`, `fileRef`, `typingTimeoutRef`, `isTypingRef` (lines 67, 90-92)
> 3. Move compose-related functions: `autoResize`, `emitTyping`, `stopTyping`, `uploadFile`, `handleFileChange`, `handlePaste`, `clearMedia`, `doSend`, `sendMessage`, `handleImprove`, `revertImprove`, `improveAndSend` (lines 69-498)
> 4. The `improving`/`setImproving` and `originalText`/`setOriginalText` state is passed from parent because the header uses `improving` to show a spinner
> 5. The `doSend` function emits `message:send` on the socket — this stays in ComposeArea since it owns the send trigger
> 6. The `textareaRef` is needed by ChatWindow's imperative handle (`focusTextarea`). Expose it: either pass a ref from parent, or expose via `forwardRef`/`useImperativeHandle`. Simplest: pass `textareaRef` from parent as a prop.

- [ ] **Step 2: Handle textareaRef for imperative handle**

The `ChatWindowHandle.focusTextarea` needs access to the textarea. Add a ref prop:

```tsx
// In ComposeArea interface, add:
textareaRef: React.RefObject<HTMLTextAreaElement | null>;

// In ComposeArea, use props.textareaRef instead of creating a local ref
```

In ChatWindow, keep `textareaRef` as a local ref and pass it down:

```tsx
<ComposeArea
  textareaRef={textareaRef}
  // ... other props
/>
```

- [ ] **Step 3: Update ChatWindow to import and use ComposeArea**

In `ChatWindow.tsx`, replace the compose JSX block with:

```tsx
import { ChatHeader, MessageList, ComposeArea } from './chat';

// Inside the return, replace the input section with:
<ComposeArea
  ticket={ticket}
  isClosed={isClosed}
  isSupport={isSupport}
  focusMode={focusMode}
  compact={compact ?? false}
  improving={improving}
  setImproving={setImproving}
  originalText={originalText}
  setOriginalText={setOriginalText}
  textareaRef={textareaRef}
/>
```

Remove from ChatWindow:
- All compose-related state: `text`, `whisperMode`, `mediaUrl`, `mediaPreview`, `uploading`, `showEmojiPicker`
- All compose-related refs: `fileRef`, `typingTimeoutRef`, `isTypingRef`
- All compose-related functions: `autoResize`, `emitTyping`, `stopTyping`, `uploadFile`, `handleFileChange`, `handlePaste`, `clearMedia`, `doSend`, `sendMessage`, `handleImprove`, `revertImprove`, `improveAndSend`
- The media preview cleanup `useEffect` (line 49)

Keep in ChatWindow:
- `textareaRef` (needed by imperative handle)
- `improving` / `setImproving` / `originalText` / `setOriginalText` (shared with header)

- [ ] **Step 4: Typecheck**

Run: `docker compose exec client npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add client/src/components/chat/ComposeArea.tsx client/src/components/ChatWindow.tsx
git commit -m "refactor: extract ComposeArea from ChatWindow (~300 lines)"
```

---

### Task 5: Clean up ChatWindow shell and verify

**Files:**
- Modify: `client/src/components/ChatWindow.tsx`

After Tasks 2-4, ChatWindow should be ~350 lines. This task cleans up any unused imports, dead code, and verifies the refactor is complete.

- [ ] **Step 1: Audit remaining ChatWindow code**

ChatWindow should now contain ONLY:
1. Imports (React, types, sub-components, store, socket)
2. `forwardRef` wrapper with `ChatWindowProps` interface
3. Store selectors: `user`, `messages`, `messageCursors`, `setMessageLoading`, `participantsOnline`, `setParticipantOnline`, `tickets`, `setMessages`, `activePartnerId`, `focusMode`, `setRatingPrompt`
4. Shared state: `closing`, `improving`, `setImproving`, `originalText`, `setOriginalText`, `summary`, `setSummary`, `summarizing`, `setSummarizing`, `showSummary`, `setShowSummary`, `viewers`, `setViewers`, `showTransferMenu`, `setShowTransferMenu`, `_unreadCount`, `setUnreadCount`
5. Refs: `textareaRef`, `scrollContainerRef`, `bottomRef`, `isNearBottomRef`, `prevMessageCountRef`, `initialScrollDoneRef`
6. `useImperativeHandle` for `ChatWindowHandle`
7. tRPC message history query (lines 100-125)
8. All `useEffect` hooks for: initial message load, auto-scroll, ticket close auto-prompt, window focus read markers, viewer tracking socket subscription, participant online tracking
9. Functions: `loadOlderMessages`, `handleScroll`, `handleSummarize`, `closeTicket`, `transferTicket`, `handleViewers`
10. Return JSX: thin shell with `ChatHeader`, `MessageList`, `ComposeArea`

Remove any unused imports (`Eye`, `REACTION_EMOJIS`, etc. that moved to sub-components).

- [ ] **Step 2: Remove unused imports**

Check each import at the top of ChatWindow. Remove any that are no longer referenced:
- `Eye` from lucide-react → moved to ChatHeader
- `SlaIndicator` → moved to ChatHeader
- `MessageBubble` → moved to MessageList
- `REACTION_EMOJIS` → moved to ComposeArea (if used there)
- Any type imports only used in extracted code

- [ ] **Step 3: Typecheck**

Run: `docker compose exec client npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Run client tests**

Run: `docker compose exec client npm test`
Expected: All existing tests pass (the only ChatWindow-related test is the PlatformView test, which imports ChatWindow indirectly)

- [ ] **Step 5: Manual smoke test**

Open the app in browser. Verify:
1. SupportView: open a ticket → header renders correctly (dept badge, name, labels, transfer, close)
2. Type a message and send → message appears in the list
3. Whisper mode toggle works
4. File upload works (attach an image)
5. AI improve button works (if AI is enabled)
6. Transfer menu opens and lists departments
7. Close ticket works
8. Typing indicator shows when other party types
9. Scroll to load older messages works
10. AgentView: open a ticket → chat works the same

- [ ] **Step 6: Commit**

```bash
git add client/src/components/ChatWindow.tsx
git commit -m "refactor: clean up ChatWindow shell — remove unused imports and dead code"
```

---

### Task 6: Update barrel export and verify all imports

**Files:**
- Modify: `client/src/components/chat/index.ts`
- Verify: all files importing ChatWindow still work

- [ ] **Step 1: Verify barrel export is correct**

```ts
// client/src/components/chat/index.ts
export { default as ChatHeader } from './ChatHeader';
export { default as MessageList } from './MessageList';
export { default as ComposeArea } from './ComposeArea';
```

- [ ] **Step 2: Check no external file imports sub-components directly**

The sub-components should only be imported via ChatWindow (which imports from `./chat/`). No other file in the codebase should import ChatHeader, MessageList, or ComposeArea directly. Verify:

Run: `docker compose exec client grep -r "from.*chat/ChatHeader\|from.*chat/MessageList\|from.*chat/ComposeArea" src/ --include="*.tsx" --include="*.ts" | grep -v ChatWindow | grep -v index`
Expected: No results (only ChatWindow imports them)

- [ ] **Step 3: Full typecheck and test**

Run: `docker compose exec client npx tsc --noEmit && docker compose exec client npm test`
Expected: All pass

- [ ] **Step 4: Final commit**

```bash
git add -A client/src/components/chat/
git commit -m "refactor(track-0): complete ChatWindow decomposition — ChatHeader, MessageList, ComposeArea"
```

---

## Summary

After Track 0, the file structure is:

```
client/src/components/
  ChatWindow.tsx          (~350 lines — thin shell)
  chat/
    index.ts              (barrel export)
    ChatHeader.tsx         (~280 lines — header, labels, transfer, summary, viewers)
    MessageList.tsx        (~200 lines — scroll, messages, typing, pagination)
    ComposeArea.tsx        (~300 lines — input, upload, whisper, AI improve, send)
```

Feature tracks A-G will now target the appropriate sub-component instead of inflating a single mega-file.
