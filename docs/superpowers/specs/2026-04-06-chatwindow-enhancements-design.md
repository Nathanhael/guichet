# ChatWindow Enhancements — Design Spec

**Date:** 2026-04-06
**Status:** Approved
**Scope:** 8 tracks (1 refactor + 7 features) enhancing the ChatWindow/MessageBubble experience

## Overview

Eight independent tracks that modernize Guichet's chat experience. Track 0 (refactor) ships first to create clean extraction boundaries. Feature tracks A-G ship separately after that — no cross-dependencies. Ordered by execution sequence.

---

## Track 0 — ChatWindow Decomposition (Refactor)

### Problem
`ChatWindow.tsx` is 1,136 lines and growing. Adding reply/quote, unread divider, multi-file preview, and label picker will push it past 1,400 lines. The file mixes header logic, message rendering, compose area, scroll management, and socket emissions — making it hard to reason about, test, or extend.

### Design

**Extract three sub-components from ChatWindow:**

#### `ChatHeader.tsx` (~250 lines extracted)
Owns:
- Ticket info display (dept badge, agent name, ticket ID)
- Label badges + label picker (Track G lands here)
- Reference fields display
- SLA indicator
- Action buttons: transfer menu, close/leave, summarize
- Summary panel (AI summary display/dismiss)
- Viewer badges (collision detection)

Props:
```ts
interface ChatHeaderProps {
  ticket: Ticket;
  liveTicket: Ticket;
  isSupport: boolean;
  isClosed: boolean;
  focusMode: boolean;
  compact: boolean;
  onClose?: () => void;
}
```

#### `MessageList.tsx` (~200 lines extracted)
Owns:
- Scroll container with ref management
- Message rendering loop (maps messages to `MessageBubble`)
- "Load older messages" button and cursor-based pagination trigger
- Scroll position tracking (`isNearBottom`)
- Auto-scroll on new messages
- Unread divider rendering (Track B lands here)
- Jump-to-bottom FAB (Track B lands here)
- Date separators (future enhancement)

Props:
```ts
interface MessageListProps {
  ticket: Ticket;
  messages: Message[];
  cursorInfo?: { hasMore: boolean; loading: boolean; nextCursor?: string };
  onLoadOlder: () => void;
  onReply: (message: Message) => void;  // callback to set replyingTo in parent
  unreadCount: number;
  onScrollToBottom: () => void;
}
```

#### `ComposeArea.tsx` (~300 lines extracted)
Owns:
- Textarea with auto-resize
- Send button and Enter-to-send logic
- Whisper mode toggle
- Reply-to banner (Track A lands here)
- File preview bar (Track E lands here)
- File upload handler (button, paste, drag-drop)
- Typing indicator emission (start/stop)
- AI improve button
- Canned response trigger (currently disabled)
- Media URL state and upload progress

Props:
```ts
interface ComposeAreaProps {
  ticket: Ticket;
  isClosed: boolean;
  isSupport: boolean;
  replyingTo: Message | null;
  onClearReply: () => void;
  onSend: (payload: { text: string; replyToId?: string; attachments?: Attachment[] }) => void;
  focusMode: boolean;
  compact: boolean;
}
```

#### `ChatWindow.tsx` (thin shell, ~350 lines remaining)
Retains:
- `forwardRef` / `useImperativeHandle` for `ChatWindowHandle`
- Shared state: `replyingTo`, `unreadCount`, `firstUnreadIndex`
- Socket event subscriptions (message:new, message:edited, message:deleted, etc.)
- Ticket lifecycle effects (close auto-prompt, viewer tracking)
- Participant online/offline tracking
- Wires the three sub-components together via props/callbacks

**Extraction rules:**
- No behavior changes — pure structural refactor
- All existing tests must pass unchanged
- Socket emissions stay in the component that owns the UX trigger (e.g., typing emit stays in `ComposeArea`, viewer tracking stays in `ChatWindow`)
- Shared state that crosses component boundaries (e.g., `replyingTo` set by `MessageList` reply click, consumed by `ComposeArea`) lives in `ChatWindow` and is passed via props/callbacks

**File locations:**
- `client/src/components/chat/ChatHeader.tsx`
- `client/src/components/chat/MessageList.tsx`
- `client/src/components/chat/ComposeArea.tsx`
- `client/src/components/ChatWindow.tsx` (stays in place, imports from `./chat/`)

**MessageBubble sub-components (extracted alongside feature tracks):**
As Tracks A, C, D, E, F land, extract from `MessageBubble.tsx`:
- `components/chat/QuoteBlock.tsx` — reply/quote rendering (Track A)
- `components/chat/LinkPreviewCard.tsx` — OG preview card (Track D)
- `components/chat/AttachmentGrid.tsx` — multi-file rendering (Track E)
- `components/chat/DeliveryStatus.tsx` — checkmark icons (Track F)

These are extracted with their respective feature tracks, not during Track 0.

---

## Track A — Reply/Quote (Inline Quote Block)

### Problem
No way to reference a specific message in a conversation. In busy tickets with multiple participants, context gets lost.

### Design

**Pattern:** Inline quote block (Teams/WhatsApp style). Not threaded — a ticket IS the thread.

**Database migration:**
- New column on `messages`: `replyToId TEXT REFERENCES messages(id) ON DELETE SET NULL`
- Index: `idx_messages_reply_to_id` on `replyToId`
- `ON DELETE SET NULL` ensures deleted originals degrade gracefully

**Socket protocol:**
- `message:send` payload gains optional `replyToId: string`
- `message:new` broadcast includes embedded snippet:
  ```ts
  replyTo?: {
    id: string;
    senderName: string;
    text: string;       // truncated to 100 chars server-side
    mediaUrl?: string;
  }
  ```
- Server resolves the snippet at send time so clients don't need a second fetch
- For paginated/historical messages, the `message.list` tRPC query joins `replyToId` to embed the same snippet shape

**Client — compose area (ChatWindow):**
- New state: `replyingTo: Message | null`
- Clicking reply icon (in MessageBubble action bar, alongside edit/delete) sets `replyingTo`
- A dismissible banner renders above the textarea:
  ```
  ┌─────────────────────────────────────────┐
  │ ↩ Replying to {senderName}          [×] │
  │ {truncated text, 1 line, secondary}     │
  └─────────────────────────────────────────┘
  ```
- Styled: `bg-bg-elevated`, left 3px `border-accent-blue`, mono sender name, secondary text
- Send includes `replyToId` then clears `replyingTo`
- Escape key or × button clears without sending
- Keyboard shortcut: consider `Ctrl+Shift+R` on focused message (future enhancement)

**Client — message rendering (MessageBubble):**
- If `message.replyTo` exists, render a compact quote block above the message body inside the bubble:
  ```
  ┌─ accent-blue 3px border ──────────────┐
  │ {senderName}          (mono, 9px, bold)│
  │ {text preview}   (secondary, 11px, 1ln)│
  └────────────────────────────────────────┘
  Actual reply message text here...
  ```
- Clicking the quote block smooth-scrolls the message container to the original message
- Original message gets a 1-second background highlight flash (`bg-accent-blue/10`, 150ms fade-in/out)
- If original was deleted: quote shows "Message deleted" in `text-text-muted` italic
- If original is not in the currently loaded page (scrolled out of pagination): quote block shows text but click is a no-op (no scroll target)

**Edge cases:**
- Reply to a whisper: only visible to users who can see whispers
- Reply to a reply: works normally (no nested quote rendering — just shows the direct parent)
- Reply to a media-only message: quote shows "[Attachment]" as text

---

## Track B — Unread Divider + Jump-to-Bottom FAB

### Problem
`_unreadCount` is tracked but never displayed. Users scrolled up have no indication of new messages and no quick way to return to the bottom.

### Design

**Unread divider:**
- When new messages arrive while the user is scrolled up OR the window is unfocused, record `firstUnreadIndex` (index in the message array where unread messages begin)
- Render a horizontal divider at that position in the message list:
  ```
  ──────────── NEW MESSAGES ────────────
  ```
- Styled: `border-t border-accent-blue`, label centered with `bg-bg-surface` padding to break the line, `font-mono text-[8px] uppercase tracking-widest text-accent-blue`
- Divider persists until: user scrolls to bottom, window regains focus + read markers sent, or FAB is clicked
- Removal uses 150ms fade-out (respects minimal motion rules)

**Jump-to-bottom FAB:**
- Floating button positioned bottom-right of the message scroll container, 16px above the compose area, 16px from right edge
- Only visible when `isNearBottom === false` (existing `isNearBottomRef` already tracks this — promote to state for reactivity)
- Content: `↓` arrow icon (Lucide `ArrowDown`, 14px) + unread count badge if > 0
- Badge: `bg-accent-blue text-btn-text-inverse font-mono text-[9px]` inline next to arrow
- Button styled: `bg-bg-elevated border border-border-heavy` — no border-radius (brutalist, it's a button not an avatar)
- Hover: `bg-bg-surface`
- Click action: `scrollTo({ top: scrollHeight, behavior: 'smooth' })`, clear `unreadCount`, remove divider, clear `firstUnreadIndex`

**State changes:**
- Remove underscore prefix from `_unreadCount` — wire to FAB badge and divider logic
- New state: `firstUnreadIndex: number | null`
- New state or promoted ref: `showScrollButton: boolean` (derived from scroll position)
- Reset conditions: scroll to bottom, window focus + mark-read, FAB click

---

## Track C — Markdown Rendering

### Problem
No text formatting support. Agents can't share structured steps, code snippets, or emphasize key terms.

### Design

**New dependencies:**
- `marked` — lightweight markdown parser (~35KB gzipped)
- `dompurify` — XSS sanitization (~15KB gzipped)
- Installed via `docker compose exec client npm install marked dompurify @types/dompurify`

**Supported syntax:**
| Syntax | Renders as |
|--------|-----------|
| `**bold**` | **bold** |
| `*italic*` | *italic* |
| `` `inline code` `` | `inline code` |
| ```` ``` ```` fenced code blocks | Monospaced block |
| `~~strikethrough~~` | ~~strikethrough~~ |
| `- item` / `1. item` | Unordered/ordered lists |
| `> quote` | Blockquote |
| `[text](url)` | Clickable link |

**Not supported (intentionally excluded):**
- Tables, task lists, headings (h1-h6), horizontal rules, images-via-markdown
- These add complexity without supporting the primary support-chat use case

**Rendering pipeline (`MessageBubble`):**
```
message.text
  -> marked.parse(text, { breaks: true, gfm: true })
  -> DOMPurify.sanitize(html, { ALLOWED_TAGS: [...], ALLOWED_ATTR: ['href', 'target', 'rel'] })
  -> rendered via sanitized HTML with className "msg-markdown"
```

Note: All HTML output is sanitized through DOMPurify before rendering. The DOMPurify
allowlist restricts to: `p, br, strong, em, del, code, pre, ul, ol, li, blockquote, a`.
This is a standard secure pattern — DOMPurify strips any tags/attributes not in the allowlist,
preventing XSS even if marked produces unexpected output.

**Configuration:**
- `marked` options: `breaks: true` (newlines become line breaks), `gfm: true` (GitHub-flavored for strikethrough)
- `DOMPurify` allowlist: `p, br, strong, em, del, code, pre, ul, ol, li, blockquote, a`
- Links: auto-add `target="_blank" rel="noopener noreferrer"`

**Interaction with existing features:**
- `BionicText` component: markdown rendering takes precedence. If message contains markdown syntax markers (`**`, `` ` ``, `- `, `> `), use markdown pipeline. Otherwise, `BionicText` still applies for accessibility.
- Detection heuristic: check if text matches `/(\*\*|__|~~|`|^>\s|^[-*+]\s|^\d+\.\s)/m` — if any match, use markdown pipeline; otherwise use `BionicText`. This is a cheap pre-check, not a full parse.
- Message editing: edit textarea shows raw markdown (not rendered)
- AI message improvement: AI output may include markdown — works naturally
- Auto-translation: translated text preserves markdown syntax (translators handle inline markup)

**Styling (scoped under `.msg-markdown`):**
- `strong`: `font-bold`
- `em`: `italic`
- `del`: `line-through text-text-secondary`
- `code` (inline): `bg-bg-elevated font-mono text-[12px] px-1 py-0.5 border border-border`
- `pre > code`: `block bg-bg-elevated font-mono text-[12px] p-3 border border-border overflow-x-auto`
- `blockquote`: `border-l-[3px] border-accent-blue pl-3 text-text-secondary`
- `ul/ol`: standard indentation, `text-[13px]` Inter
- `a`: `text-accent-blue underline-offset-2 hover:underline`
- `li`: `mb-1`
- No border-radius on any element

**Compose area:**
- No live preview or WYSIWYG — raw markdown input, rendered on send
- Keeps input fast for agents who type quickly

---

## Track D — Link Previews (Server-Side OG Unfurling)

### Problem
Pasted URLs appear as plain text. Users must click to understand what's being shared.

### Design

**Database migration:**
- New column on `messages`: `linkPreviews JSONB DEFAULT NULL`
- Schema:
  ```ts
  type LinkPreview = {
    url: string;
    title?: string;
    description?: string;
    image?: string;
    siteName?: string;
  };
  // Column stores: LinkPreview[] | null
  ```

**Server — unfurling service (`server/services/linkPreview.ts`):**
- Extract URLs from message text via regex (standard URL pattern)
- Max **3 URLs per message** (first 3 found)
- Per-URL fetch with **2-second timeout**, max **2 redirects**
- Fetch with `Accept: text/html` header, read only the first 50KB of the response body (abort after), then parse `<meta property="og:*">` tags from the partial HTML
- Sanitize all extracted values through a text sanitizer (strip HTML tags, truncate title to 120 chars, description to 200 chars)

**SSRF protection:**
- Reject URLs with: `file://`, `ftp://`, IP literals in RFC1918 ranges (`10.*`, `172.16-31.*`, `192.168.*`), loopback (`127.*`, `::1`), link-local (`169.254.*`)
- Reject hostnames resolving to private IPs (DNS rebinding protection: resolve hostname, check IP, then fetch)
- Allowlist: `http://` and `https://` only

**Async fire-and-forget pattern:**
1. `message:send` handler saves message immediately (no delay)
2. After save, kicks off async unfurl (non-blocking)
3. On completion, updates `messages.linkPreviews` in DB
4. Emits new socket event: `message:linkPreview` with `{ ticketId, messageId, linkPreviews: LinkPreview[] }`
5. If unfurl fails or all URLs time out: no event emitted, column stays null

**Socket protocol:**
- New event: `message:linkPreview` (server to client)
- Client merges `linkPreviews` into the existing message in the Zustand store

**Client rendering (MessageBubble):**
- Below the message text (and below reply quote if present), render each preview as a compact card:
  ```
  ┌─────────────────────────────────────────┐
  │ ┌──────┐  siteName (mono, 8px, muted)   │
  │ │ OG   │  Title (bold, 12px)             │
  │ │ img  │  Description (secondary, 11px,  │
  │ │60x60 │  2-line clamp)                  │
  │ └──────┘                                 │
  └─────────────────────────────────────────┘
  ```
- Styled: `bg-bg-elevated`, `border border-border`, no border-radius
- Image: 60x60px, `object-cover`, falls back to site favicon or generic link icon if no `og:image`
- Entire card clickable: opens URL in new tab with `rel="noopener noreferrer"`
- No preview card rendered for URLs that failed to unfurl
- Multiple previews stack vertically with 4px gap

**Caching (future enhancement, not in v1):**
- Redis cache for OG data keyed by URL, 24h TTL — avoids re-fetching when same URL is shared again
- Not required for initial implementation; the JSONB column serves as permanent cache per-message

---

## Track E — Multi-File Upload + Broader File Types

### Problem
Single image uploads only. Agents can't share documents, and sending multiple screenshots requires multiple messages.

### Design

**Database migration:**
- New column on `messages`: `attachments JSONB DEFAULT NULL`
- Schema:
  ```ts
  type Attachment = {
    url: string;
    name: string;       // original filename
    mimeType: string;
    size: number;        // bytes
  };
  // Column stores: Attachment[] | null
  ```
- Existing `mediaUrl` column preserved for backward compatibility (old single-image messages)
- New messages use `attachments`; `mediaUrl` no longer written to for new messages

**Server changes (`server/routes/uploads.ts`):**
- New MIME types added to allowlist:
  ```
  image/png, image/jpeg, image/webp          (existing)
  application/pdf                             (new)
  application/msword                          (new — .doc)
  application/vnd.openxmlformats-officedocument.wordprocessingml.document  (new — .docx)
  application/vnd.openxmlformats-officedocument.spreadsheetml.sheet       (new — .xlsx)
  application/vnd.ms-excel                    (new — .xls)
  text/csv                                    (new)
  text/plain                                  (new — .txt)
  ```
- New endpoint: `POST /api/v1/uploads/multi`
  - Uses `multer.array('files', 5)` — max 5 files
  - 5MB per-file limit retained
  - Returns: `Array<{ url, name, mimeType, size }>`
  - Rate limited same as existing upload endpoint
- Existing `POST /api/v1/uploads` preserved (backward compat)
- `file-type` validation (magic bytes): extend to cover new document types

**Socket protocol:**
- `message:send` gains optional `attachments: Attachment[]`
- `message:new` broadcast includes `attachments` array

**Client — compose area (ChatWindow):**
- File input: `accept` attribute updated, `multiple` enabled
- Selection handler enforces max 5 files, shows toast on excess
- Preview bar above textarea (between reply banner and input):
  ```
  ┌────────────────────────────────────────────┐
  │ [img1 thumb] [img2 thumb] [📄 report.pdf] │
  │     [×]          [×]          [×]          │
  └────────────────────────────────────────────┘
  ```
- Images: 48x48px thumbnails with x overlay to remove
- Documents: file type icon + truncated filename with x overlay to remove
- Drag-and-drop: extend existing drop zone to handle multi-file (whole chat area)
- Clipboard paste: still single-image (browser limitation)

**Client — MessageBubble rendering:**
- Check `message.attachments` first; fall back to `message.mediaUrl` for old messages
- **Image grid layout:**
  - 1 image: full width (max 300px)
  - 2 images: side by side, equal width
  - 3+ images: 2-column grid
  - All images clickable to open in new tab (or lightbox — future enhancement)
- **Document file cards:**
  ```
  ┌─────────────────────────────────┐
  │ [icon]  report.pdf        1.2MB │
  │         [DOWNLOAD]              │
  └─────────────────────────────────┘
  ```
  - Icon by MIME type: PDF icon, spreadsheet icon for XLS/XLSX/CSV, document icon for DOC/DOCX/TXT
  - Filename: mono, 11px, truncated with ellipsis
  - Size: secondary, 9px
  - Download button: `btn-secondary` style, mono uppercase
  - Styled: `bg-bg-elevated border border-border`, no border-radius
- Mixed content (images + documents): images grid first, then document cards below

**GDPR consideration:**
- Uploaded files follow existing GDPR purge behavior (files are on disk in `server/uploads/`)
- `attachments` JSONB column purged alongside message text in GDPR service

---

## Track F — Delivery Checkmarks (WhatsApp Style)

### Problem
Current `R`/`D` text is cryptic and lacks the "sent" state. Users expect visual delivery progression.

### Design

**No backend changes.** Uses existing `deliveredAt` and `readAt` columns.

**State derivation:**
| State | Condition | Visual |
|-------|-----------|--------|
| Sent | `deliveredAt === null && readAt === null` | Single check grey |
| Delivered | `deliveredAt !== null && readAt === null` | Double check grey |
| Read | `readAt !== null` | Double check blue |

**Rendering (MessageBubble, own messages only):**
- Replace `{message.readAt ? 'R' : 'D'}` with an inline SVG component `<DeliveryStatus />`
- SVG checkmarks: 14px tall, sharp angles (no curves — brutalist), 1.5px stroke
- Single check: one angled stroke
- Double check: two overlapping angled strokes (second offset 4px right)
- Colors: grey state uses `var(--color-text-secondary)`, blue state uses `var(--color-accent-blue)`
- Positioned inline after the timestamp on the same line
- Tooltip on hover: "Sent" / "Delivered" / "Read" (accessibility)

**Edge cases:**
- Deleted messages: no checkmarks rendered
- Whisper messages: checkmarks still shown (staff sees delivery status)
- Messages without `deliveredAt` (pre-existing data): show single check (sent) as safe default
- System messages: no checkmarks

**Component:**
- New component: `client/src/components/chat/DeliveryStatus.tsx` (inside `chat/` subfolder per Track 0 convention)
- Props: `{ deliveredAt?: string | null, readAt?: string | null }`
- Pure presentational, no state

---

## Track G — Label Colors + Inline Label Picker

### Problem
Label badges in the ChatWindow header ignore the `color` field — all render as identical grey badges. Additionally, support/admin users have no way to assign labels to a ticket from the chat view (the `ticket:labels:update` socket handler exists but has no UI trigger in the chat flow).

### Design

**Part 1: Label colors (fix)**
- Map `info.color` key (indigo/emerald/amber/rose/sky/pink/slate) to its Tailwind `bg-{color}-500` class
- Extract `COLOR_BG_MAP` from `AdminLabels` into a shared utility: `client/src/utils/labelColors.ts`
  ```ts
  export const LABEL_COLORS = [
    { key: 'indigo', bg: 'bg-indigo-500' },
    { key: 'emerald', bg: 'bg-emerald-500' },
    { key: 'amber', bg: 'bg-amber-500' },
    { key: 'rose', bg: 'bg-rose-500' },
    { key: 'sky', bg: 'bg-sky-500' },
    { key: 'pink', bg: 'bg-pink-500' },
    { key: 'slate', bg: 'bg-slate-500' },
  ] as const;

  export const COLOR_BG_MAP: Record<string, string> = Object.fromEntries(
    LABEL_COLORS.map(c => [c.key, c.bg]),
  );
  ```
- `AdminLabels` imports from shared util instead of defining its own
- `ChatHeader` (after Track 0 extraction) renders label badges with:
  `${COLOR_BG_MAP[info.color] || 'bg-bg-elevated'} text-white font-mono text-[8px] uppercase tracking-widest px-1.5 py-0.5`
- Fallback: if color key is missing or unknown, use current grey styling (`bg-bg-elevated text-text-primary border border-border-heavy`)

**Part 2: Inline label picker (new)**
- A `+` button renders after the last label badge in the `ChatHeader`
- Only visible for support/admin roles (not agents) — uses existing `isSupportLike()` check
- Hidden in `focusMode` and `compact` mode (consistent with existing label display logic)
- Clicking opens a dropdown positioned below the button:
  ```
  ┌───────────────────────────┐
  │ ● indigo   Bug        [✓]│
  │ ● emerald  Feature       │
  │ ● rose     Urgent        │
  │ ● amber    Follow-up     │
  └───────────────────────────┘
  ```
- Each row: colored circle (6px, `bg-{color}-500 rounded-full`), label name (`font-mono text-[10px]`), checkmark if currently applied
- Clicking a label toggles it: builds the new full label array and emits `ticket:labels:update` via socket
- Optimistic update: immediately update `liveTicket.labels` in local state, revert on error
- Dropdown closes on: outside click or Escape key
- Styled: `bg-bg-surface border border-border-heavy`, no border-radius, max-height `200px` with `overflow-y-auto`
- The `rounded-full` on the 6px color dot is acceptable — it's a decorative indicator dot, not a UI element

**Component:**
- New component: `client/src/components/chat/LabelPicker.tsx`
- Props: `{ ticketId: string; currentLabels: string[]; allLabels: Label[] }`
- Self-contained: manages dropdown open/close state, emits socket event directly

**No backend changes** — `ticket:labels:update` socket handler already handles validation, partner scoping, label count limits (`MAX_LABELS_PER_TICKET`), and broadcasts `ticket:labels:updated`.

---

## Cross-Track Considerations

**Execution order:**
1. **Track 0** (refactor) — must ship first, creates clean targets for all feature tracks
2. **Tracks B, F, G** (pure UI) — no migrations, can ship in any order after Track 0
3. **Tracks A, C, D, E** (features with deps/migrations) — independent, any order

**Migration ordering:** Tracks A, D, E each add a column to `messages`. If shipped close together, they can share one migration. If shipped weeks apart, separate migrations are fine — all are additive (nullable columns, no breaking changes).

**Testing:**
- Each track gets its own test file(s)
- Server: unit tests for new services (link preview, multi-upload), socket handler tests for new events
- Client: Vitest + jsdom for new components (QuoteBlock, DeliveryStatus, AttachmentGrid, LinkPreviewCard)
- E2E: Playwright tests for reply flow, file upload flow, scroll-to-bottom behavior

**Brutalist design compliance:**
- No border-radius on any new element (except existing avatar exception)
- No gradients, no shadows
- All colors via CSS custom property tokens
- Motion: 150ms fade only, respect `prefers-reduced-motion`
- Typography: JetBrains Mono for chrome, Inter for content
