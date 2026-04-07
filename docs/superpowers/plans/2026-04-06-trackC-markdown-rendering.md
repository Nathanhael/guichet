# Track C: Markdown Rendering — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render markdown syntax (bold, italic, code, lists, blockquotes, links, strikethrough) in chat messages using `marked` + `DOMPurify` with brutalist-scoped styles.

**Architecture:** New dependencies installed in client container, markdown rendering utility, scoped CSS styles in `index.css`, detection heuristic to switch between markdown and BionicText in `MessageBubble`.

**Tech Stack:** React 19, TypeScript, `marked`, `dompurify`, Tailwind CSS

**Depends on:** Track 0 (ChatWindow decomposition) — for `chat/` directory, though changes mainly touch MessageBubble.

**Security:** All markdown HTML output is sanitized through DOMPurify with a strict allowlist before rendering. Only safe formatting tags pass through (`p`, `strong`, `em`, `code`, `pre`, `a`, etc.). No `<script>`, `<img>`, `<iframe>`, or event handler attributes can survive sanitization.

---

### Task 1: Install dependencies

**Files:**
- Modify: `client/package.json`

- [ ] **Step 1: Install marked and dompurify**

```bash
docker compose exec client npm install marked dompurify
docker compose exec client npm install -D @types/dompurify
```

> **Note:** `marked` ships with its own types. Only `dompurify` needs `@types`.

- [ ] **Step 2: Verify installation**

Run: `docker compose exec client node -e "require('marked'); require('dompurify'); console.log('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add client/package.json client/package-lock.json
git commit -m "feat(track-c): install marked + dompurify dependencies"
```

---

### Task 2: Create markdown rendering utility

**Files:**
- Create: `client/src/utils/markdown.ts`

- [ ] **Step 1: Write the utility**

```ts
// client/src/utils/markdown.ts
import { marked } from 'marked';
import DOMPurify from 'dompurify';

// Configure marked: newlines become <br>, GFM for strikethrough
marked.setOptions({
  breaks: true,
  gfm: true,
});

// DOMPurify allowlist — only safe inline/block elements
const PURIFY_CONFIG: DOMPurify.Config = {
  ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'del', 'code', 'pre', 'ul', 'ol', 'li', 'blockquote', 'a'],
  ALLOWED_ATTR: ['href', 'target', 'rel'],
};

// Add target="_blank" and rel="noopener noreferrer" to all links
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

/**
 * Detect if text contains markdown syntax worth rendering.
 * If false, BionicText should be used instead.
 */
export function hasMarkdownSyntax(text: string): boolean {
  return /(\*\*|__|~~|`|^>\s|^[-*+]\s|^\d+\.\s)/m.test(text);
}

/**
 * Parse markdown text to DOMPurify-sanitized HTML string.
 * Output is safe for rendering — all untrusted content is stripped.
 */
export function renderMarkdown(text: string): string {
  const rawHtml = marked.parse(text, { async: false }) as string;
  return DOMPurify.sanitize(rawHtml, PURIFY_CONFIG);
}
```

- [ ] **Step 2: Typecheck**

Run: `docker compose exec client npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add client/src/utils/markdown.ts
git commit -m "feat(track-c): add markdown rendering utility with DOMPurify sanitization"
```

---

### Task 3: Add scoped CSS styles for markdown content

**Files:**
- Modify: `client/src/index.css`

- [ ] **Step 1: Add `.msg-markdown` styles**

Add the following at the end of the CSS file (or in an appropriate section):

```css
/* ── Markdown message styles (Track C) ────────────────────────────── */
.msg-markdown p {
  margin: 0;
}
.msg-markdown p + p {
  margin-top: 0.25rem;
}
.msg-markdown strong {
  font-weight: 700;
}
.msg-markdown em {
  font-style: italic;
}
.msg-markdown del {
  text-decoration: line-through;
  color: var(--color-text-secondary);
}
.msg-markdown code {
  background: var(--color-bg-elevated);
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  padding: 1px 4px;
  border: 1px solid var(--color-border);
}
.msg-markdown pre {
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
  padding: 0.75rem;
  overflow-x: auto;
  margin: 0.5rem 0;
}
.msg-markdown pre code {
  background: none;
  padding: 0;
  border: none;
  font-size: 12px;
  display: block;
}
.msg-markdown blockquote {
  border-left: 3px solid var(--color-accent-blue);
  padding-left: 0.75rem;
  color: var(--color-text-secondary);
  margin: 0.25rem 0;
}
.msg-markdown ul,
.msg-markdown ol {
  padding-left: 1.5rem;
  margin: 0.25rem 0;
  font-size: 13px;
}
.msg-markdown li {
  margin-bottom: 0.25rem;
}
.msg-markdown a {
  color: var(--color-accent-blue);
  text-underline-offset: 2px;
}
.msg-markdown a:hover {
  text-decoration: underline;
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/index.css
git commit -m "feat(track-c): add scoped .msg-markdown CSS styles for chat messages"
```

---

### Task 4: Integrate markdown rendering in MessageBubble

**Files:**
- Modify: `client/src/components/MessageBubble.tsx`

- [ ] **Step 1: Import the utility**

```ts
import { hasMarkdownSyntax, renderMarkdown } from '../utils/markdown';
```

- [ ] **Step 2: Replace the text rendering logic**

Find where the message text is rendered. Currently it likely uses `BionicText` or renders `message.text` directly. Replace with conditional rendering:

- If the message is NOT a system message AND contains markdown syntax: render via `renderMarkdown()` into a `<div className="msg-markdown">` using DOMPurify-sanitized HTML
- Otherwise: render via `BionicText` (existing behavior)

The `renderMarkdown()` function returns DOMPurify-sanitized HTML. The strict allowlist (`p, br, strong, em, del, code, pre, ul, ol, li, blockquote, a`) means no script tags, event handlers, or dangerous elements can pass through.

- [ ] **Step 3: Handle system messages**

System messages should NOT be rendered as markdown — they contain auto-generated text. Add a guard so system messages always use plain text rendering.

- [ ] **Step 4: Typecheck**

Run: `docker compose exec client npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add client/src/components/MessageBubble.tsx
git commit -m "feat(track-c): integrate markdown rendering in MessageBubble with BionicText fallback"
```

---

### Task 5: Verify

- [ ] **Step 1: Manual smoke test**

Send these messages and verify rendering:

1. `**bold text**` renders as **bold text**
2. `*italic text*` renders as *italic text*
3. Inline code with backticks renders with mono background
4. `~~strikethrough~~` renders with line-through
5. Fenced code block (triple backticks) renders as code block
6. `- item 1\n- item 2` renders as bulleted list
7. `> quoted text` renders with blue left border
8. `[Google](https://google.com)` renders as clickable link, opens in new tab
9. Plain text without markdown renders via BionicText (if accessibility toggle is on)
10. System messages always plain text, no markdown
11. Edited message with markdown: edit textarea shows raw markdown

- [ ] **Step 2: Security verification**

Send these and verify they are SANITIZED (not rendered as active HTML):
1. `<script>alert('xss')</script>` rendered as escaped text
2. `<img src=x onerror=alert(1)>` stripped entirely
3. `[click](javascript:alert(1))` link href stripped

- [ ] **Step 3: Run existing tests**

Run: `docker compose exec client npm test`
Expected: All pass

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat(track-c): complete markdown rendering with DOMPurify sanitization"
```

---

## Summary

Track C adds markdown rendering to chat messages:
1. **Dependencies:** `marked` (parser) + `dompurify` (sanitizer)
2. **Utility:** `renderMarkdown()` with strict DOMPurify allowlist, `hasMarkdownSyntax()` detection heuristic
3. **Styles:** Scoped `.msg-markdown` CSS using design tokens (no border-radius, brutalist)
4. **Integration:** MessageBubble chooses markdown or BionicText based on content detection
