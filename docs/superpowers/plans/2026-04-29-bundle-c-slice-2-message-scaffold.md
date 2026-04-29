# Bundle C / Slice 2 — `<Message>` Scaffold + React.lazy Fragment Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce `<Message>` at `client/src/components/chat/Message.tsx` as the new public chat-message API exposing the RFC #64 prop interface. Land the React.lazy + Suspense boundary for `AttachmentGrid`, `QuoteBlock`, and `LinkPreviewCard` inside `MessageContent.tsx` so the lazy benefit is real immediately. Switch `MessageList.tsx` to render `<Message>`. `MessageBubble.tsx` survives (deletion is slice #78), so during this slice `<Message>` is a thin wrapper that delegates to MessageBubble — but the lazy boundary lives one level deeper, in MessageContent, so plain-text messages already pay zero parse cost for the three fragments.

**Architecture:** Path-of-least-diff. Two parallel changes ship in one slice:
- `MessageContent.tsx` swaps its three eager imports of fragment components for `React.lazy(() => import('./AttachmentGrid'))` etc., wraps each with a `<Suspense>` boundary whose fallback is a stable-height div. Existing tests for MessageContent continue to pass because the visible behavior is unchanged for any path that mounts the fragments; for plain-text paths the fragments aren't mounted at all.
- A new `Message.tsx` exposes the RFC's prop interface (`onReply`, `aiConfig`, `ticketId`, `highlightQuery`, `isSearchMatch`, `isCurrentSearchMatch`, `suppressActions`, `isGroupStart`, `isGroupEnd`) and delegates to `<MessageBubble>` for now. Slice #78 absorbs the MessageBubble body into Message.
- `MessageList.tsx` switches its render to `<Message>`. Visual + behavioral output is unchanged.

**Tech Stack:** React 19 (`React.lazy`, `<Suspense>`), TypeScript, Vitest + jsdom + @testing-library/react, Tailwind 4.

**Parent issue:** [#77](https://github.com/Nathanhael/guichet/issues/77) (PRD #75, RFC #64). Blocks: [#78](https://github.com/Nathanhael/guichet/issues/78). Blocked by: [#76](https://github.com/Nathanhael/guichet/issues/76) (slice 1 — must merge first).

---

## Pre-flight: Decisions Locked Before Coding

### D1. Lazy boundary lives in `MessageContent.tsx`, not in `Message.tsx`.
The RFC describes the lazy boundary as a property of `<Message>`, but the smallest correct change places it in `MessageContent` because (a) MessageContent is the only file that imports the three fragments today, (b) every code path that renders a chat message already routes through MessageContent, (c) once Message wraps MessageBubble (which calls MessageContent), the lazy benefit reaches every mount point automatically. Slice #78 will fold MessageContent into Message internals, at which point the lazy boundary moves with it. The boundary is not duplicated.

### D2. `<Message>` location: `client/src/components/chat/Message.tsx`.
Resolves RFC Q2: chat-domain co-location wins over historical mirroring of MessageBubble's top-level home.

### D3. No eager preload of lazy chunks.
Resolves RFC Q3: lazy chunks load on demand. The 150ms `fade-in` design token plus a stable `min-height` Suspense fallback covers first-attachment flicker. If telemetry later flags the flicker, intersection-observer prefetch is a future RFC.

### D4. `<Message>` is a thin wrapper around `<MessageBubble>` in this slice.
Slice #78 inlines the MessageBubble body. In slice 2, Message's body is essentially `return <MessageBubble {...mappedProps} />`. The prop mapping is 1:1 except `<Message>` sources `ticketId` from props and threads it down (today MessageBubble takes ticketId as a separate prop; Message's interface keeps it optional but threads through).

### D5. `MessageList` is the only callsite to switch in this slice.
Other places that import `MessageBubble` directly stay on the old import. Slice #78 either updates those callsites or adds a re-export shim. (Verified at slice 2 task 3.)

### D6. Suspense fallback heights.
- `AttachmentGrid`: `min-h-[80px]` — typical attachment row is roughly that tall. Prevents CLS on the bubble's metadata row.
- `QuoteBlock`: `min-h-[44px]` — single-line quote.
- `LinkPreviewCard`: `min-h-[80px]` — thumbnail + title + description.

### D7. The existing `chat/index.ts` barrel re-export of the three fragments is left untouched in this slice.
Other consumers may import via the barrel today. Slice #78 removes the per-fragment exports from the barrel and verifies no consumer remains.

### D8. Test mock-graph blast radius — verify-can-fail strategy.
Bundle A slice 7 broke partial-db-mock tests when modules moved; the analogue here is jsdom resolving lazy chunks unintentionally because Vitest's default config eagerly transforms all imports. The verify-can-fail test in `Message.lazy.test.tsx` mounts a plain-text message and asserts no Suspense boundary fired (no fallback div in the DOM, no module load attempted). Then a second negative-control test mounts a message-with-attachment and asserts the same probe DOES detect a boundary. If the probe returns identical results for both, the assertion is no-op and the suite fails — the assertion's failure mode is itself asserted.

### Open question — no production callsite of `MessageContent` outside `MessageBubble`.
Verified in pre-flight: `Grep MessageContent` returns only `MessageBubble.tsx` and the chat barrel. Safe to refactor MessageContent's imports without callsite coordination.

---

## File Structure

### Files to create

| Path | Responsibility |
|---|---|
| `client/src/components/chat/Message.tsx` | New public API. Thin wrapper around `<MessageBubble>` with RFC #64 prop shape. |
| `client/src/components/chat/__tests__/Message.test.tsx` | Boundary tests covering MessageBubble's behaviors via the wrapper. |
| `client/src/components/chat/__tests__/Message.lazy.test.tsx` | Lazy-fragment boundary tests + verify-can-fail probe. |

### Files to modify

| Path | Change |
|---|---|
| `client/src/components/chat/MessageContent.tsx` | Swap `import AttachmentGrid from './AttachmentGrid'` (and Quote, LinkPreview) for `React.lazy(() => import('./AttachmentGrid'))`. Wrap each conditional render with `<Suspense fallback={<div style={{minHeight}} />}>`. Behavior identical for the eager case; lazy for the absent case. |
| `client/src/components/chat/MessageList.tsx` | Replace `<MessageBubble ... />` with `<Message ... />`. Update the import. Prop mapping is a 1:1 rename (the new Message prop interface is a superset). |
| `client/src/test/helpers.tsx` | Add factories: `makeMessageWithAttachment`, `makeMessageWithQuote`, `makeMessageWithLinkPreview`, `makeDeletedMessage`. |
| `CHANGELOG.md` | Unreleased entry: "Bundle C slice 2 — Message scaffold + React.lazy fragment boundary." |

### Files NOT touched in this slice

- `client/src/components/MessageBubble.tsx` — kept as-is; MessageBubble.test.tsx also kept. Slice #78 deletes both.
- `client/src/components/chat/AttachmentGrid.tsx`, `QuoteBlock.tsx`, `LinkPreviewCard.tsx`, `DeliveryStatus.tsx` — sources unchanged. Only their import path in MessageContent changes from eager to lazy.
- `client/src/components/chat/index.ts` — barrel exports unchanged. Slice #78 removes per-fragment exports.
- Per-fragment test files (if they exist) — kept; slice #78 deletes them.

---

## Conventions

- **Test runner:** `docker compose exec client npm test -- <path/to/file.test.tsx>`. Vitest passthrough.
- **Type check:** `docker compose exec client npx tsc --noEmit -p .`
- **CI:** `powershell -File scripts/ci.ps1` (final task only).
- **Server reload:** NOT required — client-only slice.
- **Commit style:** `feat(chat): <description>` for new component code, `refactor(chat): <description>` for the lazy split + MessageList switch, `test(chat): <description>` for test-only commits.
- **Branch:** create a feature branch off main named `feat/bundle-c-slice-2-message-scaffold`.

---

## Tasks

### Task 1: Refactor `MessageContent.tsx` — swap eager fragment imports for `React.lazy`

**Files:**
- Modify: `client/src/components/chat/MessageContent.tsx`

- [ ] **Step 1: Read the current file**

Run: `Read client/src/components/chat/MessageContent.tsx`. Note: imports `AttachmentGrid`, `QuoteBlock`, `LinkPreviewCard` eagerly. Each is rendered conditionally on `message.attachments`, `message.replyTo`, `message.linkPreviews` respectively.

- [ ] **Step 2: Rewrite the imports + add Suspense**

Replace the top of the file (imports through line 5):

```tsx
import { lazy, Suspense } from 'react';
import BionicText from '../BionicText';
import { Message } from '../../types';
import { hasMarkdownSyntax, renderMarkdown } from '../../utils/markdown';
import { getFileTypeLabel } from '../../utils/fileUtils';
import { FileText } from 'lucide-react';
import { highlightText } from '../../utils/highlightText';
import useStore from '../../store/useStore';

const AttachmentGrid = lazy(() => import('./AttachmentGrid'));
const QuoteBlock = lazy(() => import('./QuoteBlock'));
const LinkPreviewCard = lazy(() => import('./LinkPreviewCard'));
```

Wrap each conditional render with `<Suspense>`. For the QuoteBlock IIFE block (top of body):

```tsx
{message.replyTo && (() => {
  const reply = message.replyTo;
  return (
    <Suspense fallback={<div style={{ minHeight: 44 }} aria-hidden="true" />}>
      <QuoteBlock
        senderName={reply.senderName}
        text={reply.text}
        isDeleted={!reply.text && !reply.mediaUrl}
        onClick={/* unchanged */}
      />
    </Suspense>
  );
})()}
```

For the AttachmentGrid block:

```tsx
{!isDeleted && message.attachments && message.attachments.length > 0 && (
  <Suspense fallback={<div style={{ minHeight: 80 }} aria-hidden="true" />}>
    <AttachmentGrid attachments={message.attachments} ticketId={message.ticketId} />
  </Suspense>
)}
```

For the LinkPreviewCard block (note: today it's a `.map()` of multiple previews; one Suspense wraps the whole flex container):

```tsx
{!isDeleted && message.linkPreviews && message.linkPreviews.length > 0 && (
  <Suspense fallback={<div style={{ minHeight: 80 }} aria-hidden="true" />}>
    <div className="flex flex-col gap-1">
      {message.linkPreviews.map((preview) => (
        <LinkPreviewCard key={preview.url} {...preview} />
      ))}
    </div>
  </Suspense>
)}
```

The legacy single-image / file block (the `(() => { ... })()` IIFE for `message.mediaUrl` without `message.attachments`) does NOT wrap in Suspense — it doesn't import a fragment.

- [ ] **Step 3: Type-check passes**

Run: `docker compose exec client npx tsc --noEmit -p .`
Expected: No errors. `lazy` returns `LazyExoticComponent<typeof X>`; React handles the typing.

- [ ] **Step 4: Existing MessageBubble tests still pass**

Run: `docker compose exec client npm test -- MessageBubble --run`
Expected: PASS — visible behavior unchanged for the paths the test exercises. If a test asserts on synchronous render of a fragment in a quoted/attachment message, it will fail because `lazy` defers — adjust the test to await the Suspense boundary using `await screen.findByText(...)` instead of `getByText(...)`.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/chat/MessageContent.tsx
git commit -m "refactor(chat): MessageContent lazy-loads attachment/quote/link-preview fragments"
```

---

### Task 2: Add test factories for lazy-fragment messages

**Files:**
- Modify: `client/src/test/helpers.tsx`

- [ ] **Step 1: Append the factories**

```tsx
import type { Message } from '../types';

let _msgIdCounter = 0;
export function makeMessage(overrides: Partial<Message> = {}): Message {
  _msgIdCounter += 1;
  return {
    id: `msg-${_msgIdCounter}`,
    ticketId: 't-1',
    senderId: 'u-1',
    senderName: 'Alice',
    senderRole: 'agent',
    senderLang: 'en',
    text: `Test message ${_msgIdCounter}`,
    timestamp: new Date(2026, 3, 29, 12, 0, _msgIdCounter).toISOString(),
    createdAt: new Date(2026, 3, 29, 12, 0, _msgIdCounter).toISOString(),
    reactions: {},
    ...overrides,
  } as Message;
}

export function makeMessageWithAttachment(overrides: Partial<Message> = {}): Message {
  return makeMessage({
    attachments: [{ url: '/uploads/x.png', name: 'x.png', mime: 'image/png' }],
    ...overrides,
  });
}

export function makeMessageWithQuote(overrides: Partial<Message> = {}): Message {
  return makeMessage({
    replyTo: { id: 'msg-orig', senderName: 'Bob', text: 'Original message' },
    ...overrides,
  });
}

export function makeMessageWithLinkPreview(overrides: Partial<Message> = {}): Message {
  return makeMessage({
    linkPreviews: [{ url: 'https://example.com', title: 'Example', description: 'Site description' }],
    ...overrides,
  });
}

export function makeDeletedMessage(overrides: Partial<Message> = {}): Message {
  return makeMessage({
    deletedAt: new Date().toISOString(),
    text: '',
    ...overrides,
  });
}
```

Note: the exact shape of `Message['attachments']`, `replyTo`, `linkPreviews` should match `client/src/types/index.ts`. If TypeScript complains, inspect the types file and adjust field names.

- [ ] **Step 2: Type-check passes**

Run: `docker compose exec client npx tsc --noEmit -p .`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/test/helpers.tsx
git commit -m "test(chat): factories for message variants (attachment/quote/link/deleted)"
```

---

### Task 3: Create `<Message>` as a thin wrapper around `<MessageBubble>`

**Files:**
- Create: `client/src/components/chat/Message.tsx`

- [ ] **Step 1: Write the wrapper**

```tsx
// client/src/components/chat/Message.tsx
//
// Public chat-message API. Slice 2 (Bundle C #77): thin wrapper around
// MessageBubble. Slice 3 (#78) inlines MessageBubble's body and deletes
// MessageBubble.tsx.
//
// The lazy boundary for AttachmentGrid / QuoteBlock / LinkPreviewCard
// lives in MessageContent.tsx and reaches Message via the wrapped
// MessageBubble call path. Plain-text messages pay zero parse cost for
// the three fragments.

import MessageBubble from '../MessageBubble';
import type { Message as MessageType } from '../../types';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../../../../server/trpc/router';

type AiConfig = inferRouterOutputs<AppRouter>['partner']['getAiConfig'];

export interface MessageProps {
  message: MessageType;
  ticketId?: string;
  isGroupStart?: boolean;
  isGroupEnd?: boolean;
  onReply?: (message: MessageType) => void;
  suppressActions?: boolean;
  highlightQuery?: string;
  isSearchMatch?: boolean;
  isCurrentSearchMatch?: boolean;
  aiConfig?: AiConfig;
}

export default function Message({
  message,
  ticketId,
  isGroupStart = true,
  isGroupEnd = true,
  onReply,
  suppressActions,
  highlightQuery,
  isSearchMatch,
  isCurrentSearchMatch,
  aiConfig,
}: MessageProps) {
  // MessageBubble requires ticketId. Source from props, fall back to
  // message.ticketId for callers that haven't yet threaded ticketId through.
  const resolvedTicketId = ticketId ?? message.ticketId;
  return (
    <MessageBubble
      message={message}
      ticketId={resolvedTicketId}
      isGroupStart={isGroupStart}
      isGroupEnd={isGroupEnd}
      onReply={onReply}
      suppressActions={suppressActions}
      highlightQuery={highlightQuery}
      isSearchMatch={isSearchMatch}
      isCurrentSearchMatch={isCurrentSearchMatch}
      aiConfig={aiConfig}
    />
  );
}
```

- [ ] **Step 2: Type-check passes**

Run: `docker compose exec client npx tsc --noEmit -p .`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/chat/Message.tsx
git commit -m "feat(chat): Message component as thin wrapper around MessageBubble"
```

---

### Task 4: Switch `MessageList` to render `<Message>`

**Files:**
- Modify: `client/src/components/chat/MessageList.tsx`

- [ ] **Step 1: Read the current file**

Run: `Read client/src/components/chat/MessageList.tsx`. Note: MessageBubble is imported from `../MessageBubble` and rendered around line 227.

- [ ] **Step 2: Update the import + render**

Replace `import MessageBubble from '../MessageBubble';` with:

```tsx
import Message from './Message';
```

Replace the `<MessageBubble ... />` JSX block (around line 227) with `<Message ... />`. Prop mapping is 1:1.

- [ ] **Step 3: Verify other callsites of MessageBubble still resolve**

Run: `Grep "from '../MessageBubble'" client/src` and `Grep "from '\\./MessageBubble'" client/src`.
Expected: zero or more callsites remain. If any remain (other than tests of MessageBubble itself), they're left as-is — slice #78 either migrates them or adds a re-export shim.

- [ ] **Step 4: Type-check passes**

Run: `docker compose exec client npx tsc --noEmit -p .`

- [ ] **Step 5: Existing chat tests still pass**

Run: `docker compose exec client npm test -- chat --run`
Expected: PASS. The visual behavior is unchanged because Message is a 1:1 wrapper.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/chat/MessageList.tsx
git commit -m "refactor(chat): MessageList renders <Message> (slice 2 wrapper)"
```

---

### Task 5: `Message.test.tsx` — boundary tests covering MessageBubble behaviors

**Files:**
- Create: `client/src/components/chat/__tests__/Message.test.tsx`

This test file mirrors what `MessageBubble.test.tsx` covers today, but renders `<Message>`. Once slice #78 deletes MessageBubble, this is the single source of truth.

- [ ] **Step 1: Write the tests**

```tsx
// client/src/components/chat/__tests__/Message.test.tsx
//
// Boundary tests for the public Message component. Covers the same
// behaviors as MessageBubble.test.tsx; that file is deleted in slice #78.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Message from '../Message';
import {
  makeMessage,
  makeDeletedMessage,
} from '../../../test/helpers';

// Stub the global socket so action-bar buttons don't NPE.
vi.mock('../../../hooks/useSocket', () => ({
  getSocket: () => ({ connected: true, emit: vi.fn() }),
}));

// Stub the i18n hook to pass-through keys.
vi.mock('../../../i18n', () => ({ useT: () => (k: string) => k }));

// Stub the auto-translation hook (no live translation in tests).
vi.mock('../../../hooks/useTranslation', () => ({
  useAutoTranslation: () => ({
    translated: null,
    loading: false,
    translate: vi.fn(),
    showOriginal: false,
    setShowOriginal: vi.fn(),
    needsTranslation: false,
  }),
}));

// Stub the Zustand store. Provides a minimal `user` and a `bionicReading: false`.
vi.mock('../../../store/useStore', () => ({
  default: { getState: () => ({ openLightbox: vi.fn() }) },
  useStoreShallow: (selector: (s: unknown) => unknown) =>
    selector({ user: { id: 'u-1', name: 'Alice', lang: 'en', role: 'agent' }, bionicReading: false }),
}));

describe('Message — text rendering', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the message text', () => {
    const m = makeMessage({ text: 'Hello world' });
    render(<Message message={m} />);
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('renders the sender name on group-start of a non-mine message', () => {
    const m = makeMessage({ senderId: 'u-other', senderName: 'Bob', text: 'hi' });
    render(<Message message={m} isGroupStart={true} />);
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('does not render the sender name when isGroupStart=false', () => {
    const m = makeMessage({ senderId: 'u-other', senderName: 'Bob', text: 'hi' });
    render(<Message message={m} isGroupStart={false} />);
    expect(screen.queryByText('Bob')).not.toBeInTheDocument();
  });
});

describe('Message — deleted state', () => {
  it('renders the deleted-message label', () => {
    const m = makeDeletedMessage();
    render(<Message message={m} />);
    expect(screen.getByText('message_deleted')).toBeInTheDocument();
  });
});

describe('Message — search highlight', () => {
  it('applies the current-match background when isCurrentSearchMatch=true', () => {
    const m = makeMessage({ id: 'm-current', text: 'searchable text' });
    const { container } = render(<Message message={m} isCurrentSearchMatch={true} />);
    const wrapper = container.querySelector('#msg-m-current');
    expect(wrapper?.className).toMatch(/accent-soft/);
  });

  it('applies the non-current match background when isSearchMatch=true', () => {
    const m = makeMessage({ id: 'm-match', text: 'searchable text' });
    const { container } = render(<Message message={m} isSearchMatch={true} />);
    const wrapper = container.querySelector('#msg-m-match');
    expect(wrapper?.className).toMatch(/bg-elevated/);
  });
});

describe('Message — reply action', () => {
  it('calls onReply when the reply button is clicked in the action bar', async () => {
    const onReply = vi.fn();
    const m = makeMessage({ senderId: 'u-other', text: 'reply to me' });
    render(<Message message={m} onReply={onReply} />);

    // Hover-intent reveals the action bar; we trigger it by mouseEnter on the row.
    const row = screen.getByText('reply to me').closest('[id^="msg-"]');
    expect(row).not.toBeNull();
    fireEvent.mouseEnter(row!);

    await waitFor(() => expect(screen.getByLabelText('reply')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('reply'));
    expect(onReply).toHaveBeenCalledWith(m);
  });
});

describe('Message — suppressActions', () => {
  it('does not show the action bar on hover when suppressActions=true', () => {
    const m = makeMessage({ senderId: 'u-other', text: 'no actions' });
    render(<Message message={m} suppressActions={true} />);
    const row = screen.getByText('no actions').closest('[id^="msg-"]');
    fireEvent.mouseEnter(row!);
    expect(screen.queryByLabelText('reply')).not.toBeInTheDocument();
  });
});
```

The exact assertion shapes (e.g. `getByLabelText('reply')`) depend on the i18n keys MessageBubble emits. If a test fails because the label key differs, inspect MessageBubble's `aria-label` and update.

- [ ] **Step 2: Run the tests, expect pass**

Run: `docker compose exec client npm test -- chat/__tests__/Message.test.tsx --run`
Expected: PASS — Message wraps MessageBubble; behavior matches.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/chat/__tests__/Message.test.tsx
git commit -m "test(chat): Message boundary tests (text, deleted, search, reply, suppressActions)"
```

---

### Task 6: `Message.lazy.test.tsx` — Suspense boundary + verify-can-fail probe

**Files:**
- Create: `client/src/components/chat/__tests__/Message.lazy.test.tsx`

- [ ] **Step 1: Write the lazy-boundary tests**

```tsx
// client/src/components/chat/__tests__/Message.lazy.test.tsx
//
// Asserts:
// 1. Plain-text messages do NOT trigger a Suspense boundary — verified by
//    asserting no fallback element appears in the DOM and the message text
//    renders synchronously.
// 2. Messages with attachments / quote / link-preview DO trigger a Suspense
//    boundary — verified by waitFor on the rendered fragment.
// 3. Verify-can-fail: the same probe used in (1) flags positive in (2),
//    proving the assertion isn't a no-op.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import Message from '../Message';
import {
  makeMessage,
  makeMessageWithAttachment,
  makeMessageWithQuote,
  makeMessageWithLinkPreview,
} from '../../../test/helpers';

// Same stubs as Message.test.tsx — keep parity to isolate lazy behavior.
vi.mock('../../../hooks/useSocket', () => ({ getSocket: () => ({ connected: true, emit: vi.fn() }) }));
vi.mock('../../../i18n', () => ({ useT: () => (k: string) => k }));
vi.mock('../../../hooks/useTranslation', () => ({
  useAutoTranslation: () => ({
    translated: null, loading: false, translate: vi.fn(),
    showOriginal: false, setShowOriginal: vi.fn(), needsTranslation: false,
  }),
}));
vi.mock('../../../store/useStore', () => ({
  default: { getState: () => ({ openLightbox: vi.fn() }) },
  useStoreShallow: (selector: (s: unknown) => unknown) =>
    selector({ user: { id: 'u-1', name: 'Alice', lang: 'en', role: 'agent' }, bionicReading: false }),
}));

/**
 * Probe: returns true when an aria-hidden Suspense fallback is currently in
 * the DOM. Our MessageContent fallbacks are `<div style={{minHeight: N}} aria-hidden="true" />`.
 */
function hasFallbackInDom(container: HTMLElement): boolean {
  return container.querySelectorAll('div[aria-hidden="true"][style*="min-height"]').length > 0;
}

describe('Message — lazy fragments', () => {
  beforeEach(() => vi.clearAllMocks());

  it('plain-text message: no Suspense fallback ever appears', async () => {
    const m = makeMessage({ text: 'plain' });
    const { container } = render(<Message message={m} />);
    expect(screen.getByText('plain')).toBeInTheDocument();
    // Wait one microtask cycle to confirm no fallback flickered in.
    await Promise.resolve();
    expect(hasFallbackInDom(container)).toBe(false);
  });

  it('attachment message: AttachmentGrid renders after Suspense resolves', async () => {
    const m = makeMessageWithAttachment({ text: 'with file' });
    const { container } = render(<Message message={m} />);
    // Wait for the lazy chunk to resolve and the grid to mount.
    await waitFor(() => {
      // AttachmentGrid renders an <a> or <button> for the attachment.
      // Probe by alt text or filename presence.
      expect(container.querySelector('img[alt], a[href*="/uploads/"]')).not.toBeNull();
    });
  });

  it('quote message: QuoteBlock renders after Suspense resolves', async () => {
    const m = makeMessageWithQuote({ text: 'reply text' });
    render(<Message message={m} />);
    await waitFor(() => {
      // QuoteBlock renders the original sender name.
      expect(screen.getByText('Bob')).toBeInTheDocument();
    });
  });

  it('link-preview message: LinkPreviewCard renders after Suspense resolves', async () => {
    const m = makeMessageWithLinkPreview({ text: 'see this' });
    render(<Message message={m} />);
    await waitFor(() => {
      // LinkPreviewCard renders the preview title.
      expect(screen.getByText('Example')).toBeInTheDocument();
    });
  });
});

describe('Message — verify-can-fail probe', () => {
  it('the fallback probe is non-trivial: detects the boundary on attachment messages', async () => {
    const plain = makeMessage({ text: 'plain' });
    const withAttachment = makeMessageWithAttachment();

    const plainResult = render(<Message message={plain} />);
    await Promise.resolve();
    const plainHasFallback = hasFallbackInDom(plainResult.container);
    plainResult.unmount();

    const attachResult = render(<Message message={withAttachment} />);
    // BEFORE the lazy chunk resolves, the fallback IS in the DOM. Probe it
    // before the await.
    const attachHasFallback = hasFallbackInDom(attachResult.container);

    expect(plainHasFallback).toBe(false);
    expect(attachHasFallback).toBe(true);
    // If either of those is wrong, the probe is broken — and so are the
    // assertions in the previous describe block.
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `docker compose exec client npm test -- chat/__tests__/Message.lazy.test.tsx --run`
Expected: PASS for the four `Message — lazy fragments` cases AND the verify-can-fail case.

If `verify-can-fail` fails because both probes return the same result, inspect the lazy import behavior — the fallback may not be rendering as expected. If the lazy chunk resolves synchronously in jsdom (it shouldn't, but Vitest's deps-optimization may inline), use `vi.dynamicImportSettled()` or similar to confirm.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/chat/__tests__/Message.lazy.test.tsx
git commit -m "test(chat): lazy-fragment Suspense boundary + verify-can-fail probe"
```

---

### Task 7: CHANGELOG entry

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add the Unreleased entry**

```markdown
- **Bundle C slice 2 — `<Message>` scaffold + React.lazy fragment boundary** (issue #77) — new `client/src/components/chat/Message.tsx` exposes the public chat-message API; thin wrapper around `MessageBubble` for the slice (slice #78 absorbs the body). `MessageContent.tsx` now lazy-loads `AttachmentGrid`, `QuoteBlock`, and `LinkPreviewCard` via `React.lazy` + `<Suspense>`; plain-text messages pay zero parse cost for the three fragments. `MessageList.tsx` renders `<Message>` instead of `<MessageBubble>` directly. Two new test files: `Message.test.tsx` (covers MessageBubble behaviors via the wrapper) and `Message.lazy.test.tsx` (asserts the lazy boundary including a verify-can-fail probe). Unblocks slice #78 (cleanup).
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog entry for Bundle C slice 2 (Message scaffold + lazy boundary)"
```

---

### Task 8: Run local CI

**Files:**
- None (verification only)

- [ ] **Step 1: Run scripts/ci.ps1**

Run: `powershell -File scripts/ci.ps1`

Expected: ALL GREEN
- typecheck: ✓
- test-client: ✓ (Message + Message.lazy + existing chat suites pass; existing MessageBubble tests still pass because Message is a 1:1 wrapper)
- test-server: ✓ (no server changes)
- migrate: ✓ (no schema changes)
- e2e: ✓ — chat E2E specs pass unchanged. If a spec breaks, the most likely cause is a Suspense flicker that the old eager render didn't have; investigate and add the missing `await` if necessary.

- [ ] **Step 2: Open the PR**

```bash
git push -u origin feat/bundle-c-slice-2-message-scaffold
gh pr create --title "feat(chat): Bundle C slice 2 — Message scaffold + React.lazy fragment boundary" --body "$(cat <<'EOF'
Closes #77 · Parent #75 · RFC #64 · Builds on #76

## Summary
- New `<Message>` at `client/src/components/chat/Message.tsx` exposes the public chat-message API per RFC #64. Thin wrapper around `MessageBubble`; slice #78 inlines the body.
- `MessageContent.tsx` now lazy-loads `AttachmentGrid`, `QuoteBlock`, and `LinkPreviewCard` via `React.lazy` with stable-height Suspense fallbacks (`min-h-[80px]` for grid + link preview, `min-h-[44px]` for quote).
- `MessageList.tsx` renders `<Message>` instead of `<MessageBubble>` directly. Visual + behavioral output unchanged.
- New test factories in `client/src/test/helpers.tsx`: `makeMessage`, `makeMessageWithAttachment`, `makeMessageWithQuote`, `makeMessageWithLinkPreview`, `makeDeletedMessage`.
- New tests: `Message.test.tsx` (text, deleted, search highlight, reply, suppressActions); `Message.lazy.test.tsx` (lazy boundary + verify-can-fail probe).

## What this PR does NOT do
- Does not delete `MessageBubble.tsx` or its test file — slice #78.
- Does not delete per-fragment test files (if they exist) — slice #78.
- Does not remove fragment exports from `chat/index.ts` — slice #78.
- Does not run the bundle-size guardrail — slice #78 (after MessageBubble is gone).

## Test plan
- [x] `docker compose exec client npx tsc --noEmit -p .` — 0 errors
- [x] `docker compose exec client npm test` — Message + Message.lazy + existing chat suites pass; MessageBubble tests still pass
- [x] `docker compose exec server npm test` — server unchanged
- [x] Chat E2E specs pass unchanged
- [x] Manual smoke: open a ticket with a plain-text message, an attachment, a quoted reply, and a link preview; confirm all render correctly

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review Checklist (run before declaring plan complete)

**1. Spec coverage** — every issue #77 acceptance row has a task:

| Acceptance criterion | Task |
|---|---|
| `chat/Message.tsx` exists with default export | Task 3 |
| MessageProps interface matches RFC #64 | Task 3 |
| Lazy-load AttachmentGrid via React.lazy + Suspense (only when attachments non-empty) | Task 1 |
| Lazy-load QuoteBlock via React.lazy + Suspense (only when replyTo non-null) | Task 1 |
| Lazy-load LinkPreviewCard via React.lazy + Suspense (only when linkPreviews non-empty) | Task 1 |
| Suspense fallback is stable-height (min-h-[80px] / min-h-[44px]) | Task 1, D6 |
| MessageList renders Message for every message | Task 4 |
| Message.test.tsx covers MessageBubble behavior union | Task 5 |
| Message.lazy.test.tsx covers the three lazy paths | Task 6 |
| Verify-can-fail assertion + its failure mode is asserted | Task 6, D8 |
| MessageBubble.tsx NOT deleted | (No task — explicitly preserved) |
| MessageBubble.test.tsx NOT deleted | (No task — explicitly preserved) |
| No render-only smoke tests | (Convention) |
| CHANGELOG entry | Task 7 |
| `scripts/ci.ps1` passes | Task 8 |
| Existing chat E2E specs pass unchanged | Task 8 |

**2. Placeholder scan** — no "TBD", no "implement later", no "similar to Task N" — all code shown inline.

**3. Type consistency** — `MessageProps` shape consistent across Tasks 3, 5, 6. Lazy import targets (`./AttachmentGrid`, `./QuoteBlock`, `./LinkPreviewCard`) consistent in Task 1.

**4. Open scope items surfaced (not silenced):**
- The slice 2 acceptance from issue #77 says the lazy boundary lives in `<Message>`. D1 reframes: it lives in `<MessageContent>`, which is reachable via Message. The benefit is identical; the cleanup in slice #78 absorbs MessageContent into Message internals, so the boundary reaches its RFC-stated home.
- Other callsites of `MessageBubble` (outside MessageList + MessageBubble.test.tsx) — task 4 step 3 verifies; if any exist, they're intentionally left for slice #78.
- The verify-can-fail test is sensitive to Vitest's lazy-import handling. If Vitest synchronously resolves the dynamic import in jsdom, the probe needs adjustment (use `await` settling).

---

## End

Slice 2 ships: `<Message>` is the new public API, the lazy boundary covers the three fragment paths, and plain-text messages pay zero parse cost for them. Slice #78 cleanup deletes MessageBubble and runs the bundle-size guardrail.
