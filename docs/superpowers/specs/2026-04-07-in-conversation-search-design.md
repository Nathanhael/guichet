# In-Conversation Search — Design Spec

**Date:** 2026-04-07
**Status:** ✅ Shipped (stamped 2026-04-18)
**Scope:** Client-side search within a single ticket's messages (Ctrl+F + header icon)
**Evidence:** `client/src/components/chat/SearchBar.tsx` live; `utils/highlightText.tsx` for hit rendering.

## Overview

Add a search bar to the chat area that lets users find messages within the current ticket. Pure client-side — filters and highlights the already-loaded messages array using case-insensitive substring matching. No backend changes.

---

## Trigger

- **Ctrl+F** keyboard shortcut — intercepted via `useKeyboardShortcuts` hook before browser default fires. Only active when a ticket chat is open.
- **Search icon** in the ChatHeader — a small magnifying glass button in the header action bar. Clicking it opens the search bar and focuses the input.

---

## UI — SearchBar Component

**Location:** Renders between ChatHeader and the message scroll container inside MessageList's wrapper.

**Layout:**
```
┌─────────────────────────────────────────────────────┐
│ 🔍 [search input_______________] 3 of 12  [↑][↓][×]│
└─────────────────────────────────────────────────────┘
```

**Elements:**
- Search icon (Lucide `Search`, 14px) — decorative, left of input
- Text input — `font-mono text-[11px]`, full-width, no border-radius, `bg-bg-surface`
- Match counter — `text-text-secondary font-mono text-[10px]`, shows "N of M" when matches exist, hidden when input is empty
- Up arrow button (Lucide `ChevronUp`, 14px) — previous match
- Down arrow button (Lucide `ChevronDown`, 14px) — next match
- Close button (Lucide `X`, 14px) — closes search bar

**Styling:**
- Bar: `bg-bg-elevated border-b border-border px-4 py-2 flex items-center gap-2`
- No border-radius on input or buttons
- 150ms fade-in on open (consistent with panel animations)

---

## Search Logic

**Matching:**
- Case-insensitive substring match on `message.text` (the display text, not raw markdown)
- Searches all messages currently loaded in the `messages[ticketId]` array
- Deleted messages (`message.deletedAt`) are excluded from results
- System messages are included in search (they may contain useful transfer/close notes)
- Empty query = no highlights, counter hidden

**Match tracking:**
- `matchedMessageIds: string[]` — ordered list of message IDs that match the query
- `currentMatchIndex: number` — which match is currently focused (0-based)
- Both derived/recomputed on every query change

---

## Highlighting

**Two levels:**
1. **All matches:** Messages whose text contains the query get a subtle background tint: `bg-accent-amber/10` on the bubble wrapper
2. **Current match:** The focused match gets a stronger tint: `bg-accent-amber/25` and auto-scrolls into view via `scrollIntoView({ behavior: 'smooth', block: 'center' })`

**Text highlighting:**
- Within matching message bubbles, wrap the matched substring(s) in `<mark>` elements
- Style: `mark { background: var(--color-accent-amber); color: var(--color-text-primary); padding: 0 1px; }` (added to `index.css`)
- The `MessageContent` component receives the search query and wraps matches when rendering text
- Markdown-rendered messages: highlight is applied post-render on the DOM text nodes (simpler than modifying the markdown pipeline)

---

## Navigation

| Action | Key | Button |
|--------|-----|--------|
| Next match | `Enter` or `↓` | Down arrow button |
| Previous match | `Shift+Enter` or `↑` | Up arrow button |
| Close search | `Escape` | × button |
| Open search | `Ctrl+F` | Search icon in header |

- Navigation wraps around (after last match, goes to first)
- Focus stays in the search input during navigation (typing continues filtering)
- When search closes: clear highlights, clear query, return focus to compose textarea

---

## State Management

**State lives in ChatWindow (thin shell):**
```ts
const [searchOpen, setSearchOpen] = useState(false);
const [searchQuery, setSearchQuery] = useState('');
```

**Derived in SearchBar or MessageList:**
```ts
const matchedMessageIds = useMemo(() => {
  if (!searchQuery.trim()) return [];
  const q = searchQuery.toLowerCase();
  return messages
    .filter(m => !m.deletedAt && m.text?.toLowerCase().includes(q))
    .map(m => m.id);
}, [messages, searchQuery]);
```

**Props flow:**
- `ChatWindow` → `ChatHeader`: `onOpenSearch: () => void`
- `ChatWindow` → `MessageList`: `searchQuery: string`, `searchOpen: boolean`, `onSearchChange`, `onSearchClose`, `onSearchNavigate`
- `MessageList` renders `SearchBar` when `searchOpen === true`
- `MessageList` passes `searchQuery` to each `MessageBubble` for highlighting
- `MessageBubble` → `MessageContent`: `highlightQuery?: string`

---

## Components

### New: `client/src/components/chat/SearchBar.tsx`

Self-contained search bar UI. Props:
```ts
interface SearchBarProps {
  query: string;
  onQueryChange: (q: string) => void;
  matchCount: number;
  currentMatchIndex: number;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}
```

### Modified: `client/src/components/chat/ChatHeader.tsx`
- Add search icon button (Lucide `Search`, 14px) in the header action bar
- `onClick` calls `onOpenSearch` prop

### Modified: `client/src/components/ChatWindow.tsx`
- Add `searchOpen` and `searchQuery` state
- Add Ctrl+F handler (intercepts browser default when chat is focused)
- Pass search props to MessageList and ChatHeader

### Modified: `client/src/components/chat/MessageList.tsx`
- Render `SearchBar` above the scroll container when `searchOpen`
- Apply background highlight classes to matching message wrappers
- Handle scroll-to-current-match when `currentMatchIndex` changes

### Modified: `client/src/components/chat/MessageContent.tsx`
- Accept optional `highlightQuery: string` prop
- When set, wrap matching substrings in `<mark>` elements in the rendered text
- For plain text / BionicText: string replacement before render
- For markdown: apply highlights to text nodes in the rendered HTML

### Modified: `client/src/index.css`
- Add `mark` element styling for search highlights

---

## Edge Cases

- **No matches:** Counter shows "0 results". No highlighting. Up/down buttons disabled.
- **Query changes while navigated:** Reset `currentMatchIndex` to 0, re-derive matches.
- **New message arrives during search:** Re-derive matches (new message may match). Keep `currentMatchIndex` stable if possible.
- **Ticket switch while search is open:** Close search bar, clear state.
- **Very long messages:** Only the first occurrence in each message is scrolled to, but all occurrences within the message text are highlighted.

---

## i18n

| Key | EN | NL | FR |
|-----|----|----|-----|
| `search_in_conversation` | Search in conversation | Zoeken in gesprek | Rechercher dans la conversation |
| `search_results_count` | `{current} of {total}` | `{current} van {total}` | `{current} sur {total}` |
| `no_results` | No results | Geen resultaten | Aucun résultat |

---

## Brutalist Compliance

- No border-radius on search input or buttons
- `font-mono` for input text and counter
- Colors via CSS custom properties only (`--color-accent-amber` for highlights)
- 150ms fade-in only, no decorative motion
- No shadows on the search bar
