# In-Conversation Search — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a client-side search bar (Ctrl+F + header icon) that highlights and navigates matching messages within the current ticket's chat.

**Architecture:** New `SearchBar` component in `chat/`, search state owned by `ChatWindow`, match highlighting passed down through `MessageList` → `MessageBubble` → `MessageContent`. Text highlighting via `<mark>` elements with a shared `highlightText()` utility. Ctrl+F intercepted in ChatWindow via a local `useEffect` keydown listener.

**Tech Stack:** React 19, TypeScript, Lucide icons, Tailwind CSS tokens

---

### Task 1: Create text highlight utility

**Files:**
- Create: `client/src/utils/highlightText.tsx`

- [ ] **Step 1: Create the utility**

```tsx
// client/src/utils/highlightText.tsx
import React from 'react';

/**
 * Wraps all occurrences of `query` in `text` with <mark> elements.
 * Case-insensitive. Returns an array of React nodes.
 * If query is empty or not found, returns the original text as-is.
 */
export function highlightText(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;

  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  const parts = text.split(regex);

  if (parts.length === 1) return text; // no match

  return parts.map((part, i) =>
    regex.test(part)
      ? <mark key={i}>{part}</mark>
      : part
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `docker compose exec client npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add client/src/utils/highlightText.tsx
git commit -m "feat(search): add highlightText utility for marking query matches"
```

---

### Task 2: Add `<mark>` CSS styles

**Files:**
- Modify: `client/src/index.css`

- [ ] **Step 1: Add mark styles**

At the end of `client/src/index.css`, add:

```css
/* ── In-conversation search highlights ────────────────────────────── */
mark {
  background: var(--color-accent-amber, #f59e0b);
  color: var(--color-text-primary);
  padding: 0 1px;
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/index.css
git commit -m "feat(search): add mark element CSS for search highlights"
```

---

### Task 3: Create SearchBar component

**Files:**
- Create: `client/src/components/chat/SearchBar.tsx`

- [ ] **Step 1: Write the component**

```tsx
// client/src/components/chat/SearchBar.tsx
import { useRef, useEffect } from 'react';
import { Search, ChevronUp, ChevronDown, X } from 'lucide-react';
import { useT } from '../../i18n';

interface SearchBarProps {
  query: string;
  onQueryChange: (q: string) => void;
  matchCount: number;
  currentMatchIndex: number;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}

export default function SearchBar({
  query, onQueryChange, matchCount, currentMatchIndex, onNext, onPrev, onClose,
}: SearchBarProps) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      onPrev();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      onNext();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      onPrev();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      onNext();
    }
  }

  const hasQuery = query.trim().length > 0;
  const hasMatches = matchCount > 0;

  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-bg-elevated border-b border-border animate-fade-in">
      <Search size={14} className="text-text-secondary shrink-0" />
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={t('search_in_conversation') || 'Search in conversation'}
        className="flex-1 bg-bg-surface border border-border px-2 py-1 font-mono text-[11px] text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue"
        aria-label={t('search_in_conversation') || 'Search in conversation'}
      />
      {hasQuery && (
        <span className="font-mono text-[10px] text-text-secondary shrink-0 min-w-[60px] text-right">
          {hasMatches
            ? `${currentMatchIndex + 1} / ${matchCount}`
            : (t('no_results') || 'No results')
          }
        </span>
      )}
      <button
        onClick={onPrev}
        disabled={!hasMatches}
        className="p-1 text-text-secondary hover:text-text-primary disabled:opacity-30"
        aria-label="Previous match"
      >
        <ChevronUp size={14} />
      </button>
      <button
        onClick={onNext}
        disabled={!hasMatches}
        className="p-1 text-text-secondary hover:text-text-primary disabled:opacity-30"
        aria-label="Next match"
      >
        <ChevronDown size={14} />
      </button>
      <button
        onClick={onClose}
        className="p-1 text-text-secondary hover:text-text-primary"
        aria-label="Close search"
      >
        <X size={14} />
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Export from barrel**

Add to `client/src/components/chat/index.ts`:
```ts
export { default as SearchBar } from './SearchBar';
```

- [ ] **Step 3: Typecheck**

Run: `docker compose exec client npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 4: Commit**

```bash
git add client/src/components/chat/SearchBar.tsx client/src/components/chat/index.ts
git commit -m "feat(search): add SearchBar component with navigation and keyboard shortcuts"
```

---

### Task 4: Add search state to ChatWindow and Ctrl+F handler

**Files:**
- Modify: `client/src/components/ChatWindow.tsx`

- [ ] **Step 1: Add search state**

After the existing `useState` declarations (around line 44), add:

```ts
const [searchOpen, setSearchOpen] = useState(false);
const [searchQuery, setSearchQuery] = useState('');
```

- [ ] **Step 2: Add Ctrl+F keyboard handler**

Add a `useEffect` that intercepts Ctrl+F when the chat is active:

```ts
// Ctrl+F to open in-conversation search
useEffect(() => {
  function handleKeyDown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      setSearchOpen(true);
    }
  }
  document.addEventListener('keydown', handleKeyDown);
  return () => document.removeEventListener('keydown', handleKeyDown);
}, []);
```

- [ ] **Step 3: Add search close handler that resets state and refocuses textarea**

```ts
function closeSearch() {
  setSearchOpen(false);
  setSearchQuery('');
  textareaRef.current?.focus();
}
```

- [ ] **Step 4: Close search on ticket switch**

In the existing `useEffect` that reacts to `ticketId` changes (the one that loads messages), add at the top:

```ts
setSearchOpen(false);
setSearchQuery('');
```

- [ ] **Step 5: Pass search props to ChatHeader**

Add to the `<ChatHeader>` JSX:
```tsx
onOpenSearch={() => setSearchOpen(true)}
```

- [ ] **Step 6: Pass search props to MessageList**

Add to the `<MessageList>` JSX:
```tsx
searchOpen={searchOpen}
searchQuery={searchQuery}
onSearchQueryChange={setSearchQuery}
onSearchClose={closeSearch}
```

- [ ] **Step 7: Typecheck**

Run: `docker compose exec client npx tsc --noEmit`
Expected: Errors for new props not yet accepted by ChatHeader/MessageList (fixed in Tasks 5-6)

- [ ] **Step 8: Commit**

```bash
git add client/src/components/ChatWindow.tsx
git commit -m "feat(search): add search state, Ctrl+F handler, and prop passing in ChatWindow"
```

---

### Task 5: Add search icon to ChatHeader

**Files:**
- Modify: `client/src/components/chat/ChatHeader.tsx`

- [ ] **Step 1: Add `onOpenSearch` to ChatHeaderProps**

```ts
interface ChatHeaderProps {
  // ... existing props
  onOpenSearch?: () => void;
}
```

Destructure it in the function params.

- [ ] **Step 2: Add search icon button in the header action bar**

In the header's right-side action area (near the summarize/transfer buttons), add:

```tsx
{/* Search button */}
{onOpenSearch && (
  <button
    onClick={onOpenSearch}
    className={`text-text-secondary hover:text-text-primary ${focusMode ? 'p-1' : 'p-2'}`}
    aria-label={t('search_in_conversation') || 'Search in conversation'}
    title={t('search_in_conversation') || 'Search in conversation'}
  >
    <Search size={14} />
  </button>
)}
```

Import `Search` from `lucide-react`.

- [ ] **Step 3: Typecheck**

Run: `docker compose exec client npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add client/src/components/chat/ChatHeader.tsx
git commit -m "feat(search): add search icon button to ChatHeader"
```

---

### Task 6: Wire SearchBar into MessageList with match highlighting

**Files:**
- Modify: `client/src/components/chat/MessageList.tsx`

- [ ] **Step 1: Add search props to MessageListProps**

```ts
interface MessageListProps {
  // ... existing props
  searchOpen?: boolean;
  searchQuery?: string;
  onSearchQueryChange?: (q: string) => void;
  onSearchClose?: () => void;
}
```

Destructure them.

- [ ] **Step 2: Add match computation with useMemo**

```ts
import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { SearchBar } from './';

// Inside the component, after destructuring props:
const [currentMatchIndex, setCurrentMatchIndex] = useState(0);

const matchedMessageIds = useMemo(() => {
  if (!searchQuery?.trim()) return [];
  const q = searchQuery.toLowerCase();
  return ticketMessages
    .filter(m => !m.deletedAt && m.text?.toLowerCase().includes(q))
    .map(m => m.id);
}, [ticketMessages, searchQuery]);

// Reset match index when query or matches change
useEffect(() => {
  setCurrentMatchIndex(0);
}, [matchedMessageIds.length, searchQuery]);

const navigateMatch = useCallback((direction: 'next' | 'prev') => {
  if (matchedMessageIds.length === 0) return;
  setCurrentMatchIndex(prev => {
    const next = direction === 'next'
      ? (prev + 1) % matchedMessageIds.length
      : (prev - 1 + matchedMessageIds.length) % matchedMessageIds.length;
    // Scroll to the matched message
    const el = document.getElementById(`msg-${matchedMessageIds[next]}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return next;
  });
}, [matchedMessageIds]);
```

- [ ] **Step 3: Render SearchBar above the scroll container**

Inside the return, before the scroll container `<div ref={scrollContainerRef} ...>`, add:

```tsx
{searchOpen && onSearchQueryChange && onSearchClose && (
  <SearchBar
    query={searchQuery || ''}
    onQueryChange={onSearchQueryChange}
    matchCount={matchedMessageIds.length}
    currentMatchIndex={currentMatchIndex}
    onNext={() => navigateMatch('next')}
    onPrev={() => navigateMatch('prev')}
    onClose={onSearchClose}
  />
)}
```

- [ ] **Step 4: Add highlight classes to matching message wrappers**

In the message `.map()` loop, compute whether each message matches:

```ts
const isMatch = searchQuery?.trim() && matchedMessageIds.includes(msg.id);
const isCurrentMatch = isMatch && matchedMessageIds[currentMatchIndex] === msg.id;
```

Pass these to MessageBubble as new props (added in Task 7):

```tsx
<MessageBubble
  // ... existing props
  highlightQuery={searchQuery?.trim() ? searchQuery : undefined}
  isSearchMatch={!!isMatch}
  isCurrentSearchMatch={!!isCurrentMatch}
/>
```

- [ ] **Step 5: Scroll to first match when search opens with existing query**

```ts
useEffect(() => {
  if (searchOpen && matchedMessageIds.length > 0) {
    const el = document.getElementById(`msg-${matchedMessageIds[0]}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}, [searchOpen, matchedMessageIds]);
```

- [ ] **Step 6: Typecheck**

Run: `docker compose exec client npx tsc --noEmit`

- [ ] **Step 7: Commit**

```bash
git add client/src/components/chat/MessageList.tsx
git commit -m "feat(search): wire SearchBar into MessageList with match tracking and navigation"
```

---

### Task 7: Pass highlight props through MessageBubble to MessageContent

**Files:**
- Modify: `client/src/components/MessageBubble.tsx`
- Modify: `client/src/components/chat/MessageContent.tsx`

- [ ] **Step 1: Add highlight props to MessageBubbleProps**

```ts
interface MessageBubbleProps {
  // ... existing props
  highlightQuery?: string;
  isSearchMatch?: boolean;
  isCurrentSearchMatch?: boolean;
}
```

Destructure them.

- [ ] **Step 2: Apply background highlight to the bubble wrapper**

Find the outer `<div>` of the message bubble (the one with `id={`msg-${message.id}`}`). Add conditional classes:

```tsx
<div
  id={`msg-${message.id}`}
  className={`group flex items-end gap-0 ${isCurrentSearchMatch ? 'bg-accent-amber/25' : isSearchMatch ? 'bg-accent-amber/10' : ''} transition-colors duration-150`}
  // ... existing props
>
```

- [ ] **Step 3: Pass highlightQuery to MessageContent**

```tsx
<MessageContent
  // ... existing props
  highlightQuery={highlightQuery}
/>
```

- [ ] **Step 4: Add highlightQuery to MessageContentProps**

In `client/src/components/chat/MessageContent.tsx`:

```ts
interface MessageContentProps {
  // ... existing props
  highlightQuery?: string;
}
```

Destructure it.

- [ ] **Step 5: Apply text highlighting in MessageContent**

Import the utility:
```ts
import { highlightText } from '../../utils/highlightText';
```

In the text rendering section, where plain text or BionicText is rendered (non-markdown, non-deleted), wrap with `highlightText`:

For plain text rendering, replace direct text output with:
```tsx
{highlightQuery ? highlightText(displayText, highlightQuery) : displayText}
```

For BionicText, pass the highlight query if BionicText supports it, or wrap the output. Simplest: when `highlightQuery` is set, skip BionicText and use `highlightText` instead (search mode overrides bionic reading temporarily).

For markdown-rendered content: highlighting inside sanitized HTML is complex. For v1, the bubble background highlight is sufficient — don't try to highlight within markdown-rendered HTML.

- [ ] **Step 6: Typecheck**

Run: `docker compose exec client npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 7: Commit**

```bash
git add client/src/components/MessageBubble.tsx client/src/components/chat/MessageContent.tsx
git commit -m "feat(search): pass highlight props through MessageBubble to MessageContent"
```

---

### Task 8: Add i18n keys and typecheck

**Files:**
- Modify: `client/src/locales/en.ts`
- Modify: `client/src/locales/nl.ts`
- Modify: `client/src/locales/fr.ts`

- [ ] **Step 1: Add translation keys**

| Key | EN | NL | FR |
|-----|----|----|-----|
| `search_in_conversation` | `Search in conversation` | `Zoeken in gesprek` | `Rechercher dans la conversation` |
| `no_results` | `No results` | `Geen resultaten` | `Aucun résultat` |

- [ ] **Step 2: Final typecheck**

Run: `docker compose exec client npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add client/src/locales/en.ts client/src/locales/nl.ts client/src/locales/fr.ts
git commit -m "feat(search): add i18n keys for in-conversation search"
```

---

### Task 9: Verify and final commit

- [ ] **Step 1: Run client tests**

Run: `docker compose exec client npm test`
Expected: All pass

- [ ] **Step 2: Manual smoke test checklist**

1. Open a ticket chat → press Ctrl+F → search bar appears at top of messages
2. Type a query → matching messages get yellow background, matched text gets `<mark>` highlight
3. Press Enter → jumps to next match, counter updates
4. Press Shift+Enter → jumps to previous match
5. Press Escape → search bar closes, highlights cleared, textarea focused
6. Click search icon (🔍) in header → search bar opens
7. Switch to different ticket tab → search bar closes automatically
8. Type query with no matches → "No results" shown, up/down disabled

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete in-conversation search (Ctrl+F + header icon)"
```

---

## Summary

| File | Action | Purpose |
|------|--------|---------|
| `client/src/utils/highlightText.tsx` | Create | `<mark>` wrapping utility |
| `client/src/index.css` | Modify | `mark` element styling |
| `client/src/components/chat/SearchBar.tsx` | Create | Search bar UI component |
| `client/src/components/chat/index.ts` | Modify | Barrel export for SearchBar |
| `client/src/components/ChatWindow.tsx` | Modify | Search state, Ctrl+F handler, prop passing |
| `client/src/components/chat/ChatHeader.tsx` | Modify | Search icon button |
| `client/src/components/chat/MessageList.tsx` | Modify | SearchBar rendering, match tracking, scroll-to-match |
| `client/src/components/MessageBubble.tsx` | Modify | Highlight props, background tint |
| `client/src/components/chat/MessageContent.tsx` | Modify | Text highlight via `highlightText()` |
| `client/src/locales/en.ts, nl.ts, fr.ts` | Modify | i18n keys |
