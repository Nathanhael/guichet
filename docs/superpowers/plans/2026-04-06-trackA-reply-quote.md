# Track A: Reply/Quote (Inline Quote Block) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reply-to-message functionality with an inline quote block (Teams/WhatsApp pattern) — compose preview, server-side snippet embedding, and click-to-scroll in the chat.

**Architecture:** New `replyToId` column on `messages` table, socket protocol extension, `QuoteBlock` sub-component in `chat/`, compose banner in `ComposeArea`, reply button in `MessageBubble`.

**Tech Stack:** React 19, TypeScript, Drizzle ORM (PostgreSQL), Socket.io, Tailwind CSS

**Depends on:** Track 0 (ChatWindow decomposition)

---

### Task 1: Database migration — add `replyToId` column

**Files:**
- Modify: `server/db/schema.ts`

- [ ] **Step 1: Add the column to the messages table**

In `server/db/schema.ts`, find the `messages` table definition. Add after the `deletedAt` column:

```ts
replyToId: text('reply_to_id').references(() => messages.id, { onDelete: 'set null' }),
```

- [ ] **Step 2: Add index**

In the table's index block, add:

```ts
replyToIdx: index('idx_messages_reply_to_id').on(table.replyToId),
```

- [ ] **Step 3: Generate and apply migration**

Run:
```bash
docker compose exec server npx drizzle-kit generate
docker compose exec server npx drizzle-kit push
```

- [ ] **Step 4: Commit**

```bash
git add server/db/schema.ts server/drizzle/
git commit -m "feat(track-a): add replyToId column to messages table"
```

---

### Task 2: Server — resolve reply snippet on send and query

**Files:**
- Modify: `server/services/messageQueries.ts`
- Modify: `server/trpc/routers/message.ts`
- Modify: `server/utils/messageMapper.ts`

- [ ] **Step 1: Add query to resolve reply snippet**

In `server/services/messageQueries.ts`, add:

```ts
/**
 * Fetches the reply-to snippet for a message.
 * Returns: { id, senderName, text (truncated), mediaUrl }
 */
export async function resolveReplySnippet(replyToId: string): Promise<{
  id: string;
  senderName: string;
  text: string;
  mediaUrl: string | null;
} | null> {
  const row = await db
    .select({
      id: messages.id,
      senderName: messages.senderName,
      text: messages.text,
      mediaUrl: messages.mediaUrl,
      deletedAt: messages.deletedAt,
    })
    .from(messages)
    .where(eq(messages.id, replyToId))
    .limit(1);

  if (!row.length) return null;
  const r = row[0];

  return {
    id: r.id,
    senderName: r.senderName || 'Unknown',
    text: r.deletedAt
      ? ''  // deleted messages show empty text, client renders "Message deleted"
      : (r.text || '[Attachment]').slice(0, 100),
    mediaUrl: r.mediaUrl || null,
  };
}
```

- [ ] **Step 2: Update message.list tRPC query to embed reply snippets**

In `server/trpc/routers/message.ts`, after fetching the message rows, resolve reply snippets:

```ts
// After fetching rows and mapping:
const mappedMessages = rows.map(mapMessageRow);

// Resolve reply snippets in parallel
const withReplies = await Promise.all(
  mappedMessages.map(async (msg) => {
    if (!msg.replyToId) return msg;
    const snippet = await resolveReplySnippet(msg.replyToId);
    return { ...msg, replyTo: snippet };
  })
);

return { messages: withReplies, nextCursor };
```

- [ ] **Step 3: Update messageMapper to include replyToId**

In `server/utils/messageMapper.ts`, ensure `replyToId` is included in the mapped output:

```ts
// Add to the return object:
replyToId: row.replyToId || null,
```

- [ ] **Step 4: Typecheck**

Run: `docker compose exec server npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add server/services/messageQueries.ts server/trpc/routers/message.ts server/utils/messageMapper.ts
git commit -m "feat(track-a): resolve reply snippets in message queries"
```

---

### Task 3: Socket handler — accept replyToId on message:send

**Files:**
- Modify: `server/socket/handlers.ts`

- [ ] **Step 1: Accept replyToId in message:send handler**

Find the `message:send` handler. Update the payload interface to accept `replyToId`:

```ts
// In the message:send handler, destructure replyToId from payload:
const { ticketId, text, mediaUrl, whisper, replyToId } = data;
```

- [ ] **Step 2: Store replyToId when inserting the message**

When calling `insertMessage` (or however messages are saved), include `replyToId`:

```ts
// Add replyToId to the insert:
replyToId: replyToId || null,
```

- [ ] **Step 3: Resolve and embed snippet in the broadcast**

After saving, resolve the snippet and include it in the `message:new` broadcast:

```ts
// After save, before emitting message:new:
let replyTo = null;
if (replyToId) {
  replyTo = await resolveReplySnippet(replyToId);
}

// Include in the emitted message object:
const socketMessage = {
  ...mappedMessage,
  replyTo,
};

io.to(Rooms.ticket(ticketId)).emit('message:new', socketMessage);
```

- [ ] **Step 4: Typecheck**

Run: `docker compose exec server npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add server/socket/handlers.ts
git commit -m "feat(track-a): accept replyToId in message:send, embed snippet in broadcast"
```

---

### Task 4: Client types — add replyTo fields

**Files:**
- Modify: `client/src/types/index.ts`

- [ ] **Step 1: Add replyTo fields to Message interface**

```ts
export interface Message {
  // ... existing fields
  replyToId?: string | null;
  replyTo?: {
    id: string;
    senderName: string;
    text: string;
    mediaUrl?: string | null;
  } | null;
}
```

- [ ] **Step 2: Typecheck**

Run: `docker compose exec client npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add client/src/types/index.ts
git commit -m "feat(track-a): add replyTo fields to client Message type"
```

---

### Task 5: Create QuoteBlock component

**Files:**
- Create: `client/src/components/chat/QuoteBlock.tsx`

- [ ] **Step 1: Write the component**

```tsx
// client/src/components/chat/QuoteBlock.tsx
import { useT } from '../../i18n';

interface QuoteBlockProps {
  senderName: string;
  text: string;
  isDeleted?: boolean;
  onClick?: () => void;
}

/**
 * Compact quote block shown above a reply message.
 * Clicking scrolls to the original message (if in view).
 */
export default function QuoteBlock({ senderName, text, isDeleted, onClick }: QuoteBlockProps) {
  const t = useT();

  return (
    <div
      onClick={onClick}
      className={`border-l-[3px] border-accent-blue pl-2 py-1 mb-1.5 bg-bg-elevated ${
        onClick ? 'cursor-pointer hover:bg-bg-surface' : ''
      }`}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter') onClick(); } : undefined}
    >
      <div className="font-mono text-[9px] font-bold text-accent-blue truncate">
        {senderName}
      </div>
      <div className="text-[11px] text-text-secondary truncate">
        {isDeleted
          ? <em className="text-text-muted">{t('message_deleted') || 'Message deleted'}</em>
          : (text || '[Attachment]')
        }
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Export from barrel**

Add to `client/src/components/chat/index.ts`:
```ts
export { default as QuoteBlock } from './QuoteBlock';
```

- [ ] **Step 3: Commit**

```bash
git add client/src/components/chat/QuoteBlock.tsx client/src/components/chat/index.ts
git commit -m "feat(track-a): add QuoteBlock component for reply rendering"
```

---

### Task 6: Render QuoteBlock in MessageBubble

**Files:**
- Modify: `client/src/components/MessageBubble.tsx`

- [ ] **Step 1: Import QuoteBlock**

```ts
import { QuoteBlock } from './chat';
```

- [ ] **Step 2: Add quote block rendering above message body**

Inside the MessageBubble, before the message text content, add:

```tsx
{/* Reply quote block */}
{message.replyTo && (
  <QuoteBlock
    senderName={message.replyTo.senderName}
    text={message.replyTo.text}
    isDeleted={!message.replyTo.text && !message.replyTo.mediaUrl}
    onClick={() => {
      // Scroll to original message if it exists in the DOM
      const el = document.getElementById(`msg-${message.replyTo!.id}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('bg-accent-blue/10');
        setTimeout(() => el.classList.remove('bg-accent-blue/10'), 1000);
      }
    }}
  />
)}
```

- [ ] **Step 3: Add id attribute to message wrapper for scroll targeting**

Find the outer `div` of MessageBubble and add an id:

```tsx
<div
  id={`msg-${message.id}`}
  className={`group flex items-end gap-0 ...`}
  // ... existing props
>
```

- [ ] **Step 4: Add transition class for highlight flash**

Add to the message wrapper:
```tsx
className={`... transition-colors duration-150`}
```

- [ ] **Step 5: Typecheck**

Run: `docker compose exec client npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add client/src/components/MessageBubble.tsx
git commit -m "feat(track-a): render QuoteBlock in MessageBubble with click-to-scroll"
```

---

### Task 7: Add reply button to MessageBubble action bar

**Files:**
- Modify: `client/src/components/MessageBubble.tsx`

- [ ] **Step 1: Add onReply prop**

Update the `MessageBubbleProps` interface:

```ts
interface MessageBubbleProps {
  message: Message;
  ticketId: string;
  isGroupStart?: boolean;
  isGroupEnd?: boolean;
  aiConfig?: AiConfig;
  onReply?: (message: Message) => void;  // NEW
}
```

Update the destructured props:
```ts
export default function MessageBubble({ message, ticketId, isGroupStart = true, isGroupEnd = true, aiConfig, onReply }: MessageBubbleProps) {
```

- [ ] **Step 2: Add reply button to the action bar**

Find the existing action buttons (edit/delete, around the `showActions` section). Add a reply button before the edit button:

```tsx
{showActions && !editing && (
  <div className={`absolute top-0 ${isMine ? 'left-0 -translate-x-full pl-1' : 'right-0 translate-x-full pr-1'} flex gap-0.5 opacity-0 group-hover:opacity-100`}>
    {/* Reply button — always available for non-deleted messages */}
    {onReply && (
      <button
        onClick={() => onReply(message)}
        title={t('reply') || 'Reply'}
        className="p-1 hover:bg-bg-elevated text-text-secondary hover:text-text-primary"
      >
        <CornerUpLeft size={14} />
      </button>
    )}
    {canEdit && (
      // ... existing edit button
    )}
    {canDelete && (
      // ... existing delete button
    )}
  </div>
)}
```

- [ ] **Step 3: Import the icon**

```ts
import { CornerUpLeft } from 'lucide-react';
```

(Add to existing lucide imports if there are any, or add a new import line.)

- [ ] **Step 4: Typecheck**

Run: `docker compose exec client npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add client/src/components/MessageBubble.tsx
git commit -m "feat(track-a): add reply button to MessageBubble action bar"
```

---

### Task 8: Wire reply state through ChatWindow and ComposeArea

**Files:**
- Modify: `client/src/components/ChatWindow.tsx`
- Modify: `client/src/components/chat/MessageList.tsx`
- Modify: `client/src/components/chat/ComposeArea.tsx`

- [ ] **Step 1: Add replyingTo state to ChatWindow**

```ts
const [replyingTo, setReplyingTo] = useState<Message | null>(null);
```

- [ ] **Step 2: Pass onReply callback to MessageList**

```tsx
<MessageList
  // ... existing props
  onReply={(msg: Message) => setReplyingTo(msg)}
/>
```

- [ ] **Step 3: MessageList passes onReply to each MessageBubble**

In `MessageList.tsx`, add `onReply` to props and pass it through:

```tsx
interface MessageListProps {
  // ... existing
  onReply?: (message: Message) => void;
}

// In the map:
<MessageBubble
  // ... existing props
  onReply={onReply}
/>
```

- [ ] **Step 4: Pass replyingTo state to ComposeArea**

```tsx
<ComposeArea
  // ... existing props
  replyingTo={replyingTo}
  onClearReply={() => setReplyingTo(null)}
/>
```

- [ ] **Step 5: ComposeArea renders reply banner and sends replyToId**

Update `ComposeAreaProps`:
```ts
interface ComposeAreaProps {
  // ... existing
  replyingTo: Message | null;
  onClearReply: () => void;
}
```

Add reply banner above the textarea:
```tsx
{/* Reply-to banner */}
{replyingTo && (
  <div className="flex items-start gap-2 px-4 py-2 bg-bg-elevated border-l-[3px] border-accent-blue">
    <div className="flex-1 min-w-0">
      <div className="font-mono text-[9px] font-bold text-accent-blue truncate">
        {t('replying_to') || 'Replying to'} {replyingTo.senderName}
      </div>
      <div className="text-[11px] text-text-secondary truncate">
        {replyingTo.text || '[Attachment]'}
      </div>
    </div>
    <button
      onClick={onClearReply}
      className="text-text-secondary hover:text-text-primary p-1 shrink-0"
      aria-label={t('cancel_reply') || 'Cancel reply'}
    >
      <X size={14} />
    </button>
  </div>
)}
```

Import `X` from lucide-react.

Update the `doSend` function to include `replyToId`:
```ts
function doSend(finalText: string) {
  // ... existing logic
  getSocket().emit('message:send', {
    ticketId: ticket.id,
    text: finalText,
    mediaUrl: mediaUrl || undefined,
    whisper: whisperMode ? 1 : 0,
    replyToId: replyingTo?.id || undefined,  // NEW
  });
  // ... existing cleanup
  onClearReply();  // Clear reply state after send
}
```

- [ ] **Step 6: Handle Escape to clear reply**

In ComposeArea, add a keyboard handler to the textarea:
```tsx
onKeyDown={(e) => {
  if (e.key === 'Escape' && replyingTo) {
    e.preventDefault();
    onClearReply();
  }
  // ... existing Enter-to-send logic
}}
```

- [ ] **Step 7: Typecheck**

Run: `docker compose exec client npx tsc --noEmit`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add client/src/components/ChatWindow.tsx client/src/components/chat/MessageList.tsx client/src/components/chat/ComposeArea.tsx
git commit -m "feat(track-a): wire reply state through ChatWindow, MessageList, ComposeArea"
```

---

### Task 9: Add i18n keys and verify

**Files:**
- Modify: i18n translation files

- [ ] **Step 1: Add translation keys**

| Key | EN | NL | FR |
|-----|----|----|-----|
| `reply` | `Reply` | `Antwoorden` | `Répondre` |
| `replying_to` | `Replying to` | `Antwoord op` | `Réponse à` |
| `cancel_reply` | `Cancel reply` | `Annuleer antwoord` | `Annuler la réponse` |
| `message_deleted` | `Message deleted` | `Bericht verwijderd` | `Message supprimé` |

- [ ] **Step 2: Manual smoke test**

1. Open a ticket with messages
2. Hover a message → see reply icon (↩) in action bar
3. Click reply → banner appears above textarea with sender name + text preview
4. Type a reply and send → message appears with quote block above it
5. Click the quote block → scrolls to original, highlights it briefly
6. Press Escape in textarea → clears the reply banner
7. Click × on reply banner → clears it
8. Reply to a deleted message → quote shows "Message deleted" in italic
9. Reply to a media-only message → quote shows "[Attachment]"

- [ ] **Step 3: Run tests**

Run: `docker compose exec client npm test && docker compose exec server npm test`
Expected: All pass

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat(track-a): complete reply/quote with inline quote block"
```

---

## Summary

Track A delivers end-to-end reply functionality:
1. **Database:** `replyToId` column with FK + index
2. **Server:** snippet resolution at send time, embedded in socket broadcast and tRPC queries
3. **Client:** `QuoteBlock` component, reply button in MessageBubble, compose banner, click-to-scroll with highlight
