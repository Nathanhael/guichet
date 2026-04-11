# Plan: WYSIWYG Compose Area with Tiptap

**Status:** Draft — not yet scheduled
**Scope:** Replace the plain `<textarea>` in `ComposeArea` with a Tiptap-based rich-text editor so support staff see rendered markdown (**bold**, *italic*, `code`, blockquotes, lists) as they type instead of raw `**bold**` syntax.
**Estimated effort:** 1.5–2 days of focused work. Not a drive-by change.

---

## Why Tiptap (and not Lexical / Slate / ProseMirror raw)

- **Markdown fit.** Tiptap has an official `tiptap-markdown` extension that ships with serialization in both directions (HTML ↔ markdown). Tessera's server already stores markdown in `messages.text` and the renderer uses a sanitized markdown pipeline — Tiptap matches the existing on-disk format without schema changes.
- **React-native.** `@tiptap/react` is first-class. Lexical is also Meta-backed but its markdown story is weaker and the React adapter layers are a moving target.
- **Small surface area.** ProseMirror directly is the right answer for Notion-grade rich editors — overkill for a chat box. Slate's API stability has been shaky.
- **Pluggable.** Tessera needs a curated subset (Bold, Italic, Strikethrough, Code, Blockquote, BulletList). Tiptap's StarterKit bundles exactly these and you opt out of nothing you don't use.
- **Keyboard bindings preserved.** Tiptap honors standard markdown shortcuts (`Ctrl+B`, `Ctrl+I`, etc.) out of the box and lets us keep custom ones (`Enter` = send, `Shift+Enter` = newline, `Esc` = clear reply-to).

---

## Scope

### In scope

1. Swap `<textarea>` for `<EditorContent editor={editor} />` from `@tiptap/react`.
2. Retrofit the 6-button `FormatToolbar` to call Tiptap commands (`chain().toggleBold().run()` etc.) instead of wrapping raw markdown in the text buffer.
3. Preserve every existing compose feature:
   - AI improve (replace editor content, preserve the "revert to original" flow)
   - Drafts auto-save (serialize to markdown on every change, hydrate from markdown on mount)
   - Canned response picker (`/` trigger — replace selection with the canned body)
   - Reply-to preview (unchanged, sits above the editor)
   - File attachment strip (unchanged, sits above the editor)
   - Drag & drop files (move handlers from the wrapper div to the editor's `handleDrop` prop)
   - Paste screenshots (Tiptap's `handlePaste` instead of `onPaste`)
   - Whisper mode toggle (unchanged visually, editor body text inherits the whisper styles)
   - Character counter (use `editor.storage.characterCount` from `@tiptap/extension-character-count`)
   - Emoji picker (insert at current selection via `chain().insertContent(emoji).run()`)
   - `Enter` = send, `Shift+Enter` = newline (custom `Keymap` extension)
   - `Escape` = clear reply-to / dismiss canned picker
4. Serialize to markdown on send — server still receives `text` as a markdown string, nothing downstream changes.
5. Hydrate drafts from stored markdown on mount / ticket switch.
6. Port placeholder text (`Type a message…` / `Private note for support staff…`).

### Out of scope (explicit non-goals)

- **Tables.** Support chat doesn't need tables. Leaving them out keeps the keymap simple.
- **Images inline in the editor body.** Images stay as attachments, rendered as chips above the compose row (current behaviour). Inline image embedding would require server-side markdown image URL handling and a different rendering path.
- **Live link previews in the editor.** Cards render on sent messages only (see earlier discussion). Could add later but not part of this migration.
- **Heading levels.** Chat doesn't need H1–H6.
- **Mention autocomplete (@user).** Separate future feature — Tiptap has `@tiptap/extension-mention` but the UX (autocomplete popover, user list) is its own project.

---

## Steps

### 1. Install (est. 10 min)

```bash
docker compose exec client npm install \
  @tiptap/react \
  @tiptap/starter-kit \
  @tiptap/extension-placeholder \
  @tiptap/extension-character-count \
  tiptap-markdown
```

StarterKit bundles:
- Document, Text, Paragraph — required base
- Bold, Italic, Strike, Code, CodeBlock
- BulletList, OrderedList, ListItem
- Blockquote, HardBreak, HorizontalRule
- History (undo/redo)

Disable in the config: `heading`, `horizontalRule`, `codeBlock` (keep inline `code` only), `orderedList` (Tessera toolbar has BulletList only).

### 2. New `useComposeEditor` hook (est. 2 hours)

Extract the Tiptap setup into a hook so `ComposeArea` stays readable.

```tsx
// client/src/hooks/useComposeEditor.ts
import { useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import CharacterCount from '@tiptap/extension-character-count';
import { Markdown } from 'tiptap-markdown';

export function useComposeEditor({
  initialContent,
  placeholder,
  onUpdate,
  onSubmit,
  onEscape,
}: UseComposeEditorArgs) {
  return useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        horizontalRule: false,
        codeBlock: false,
        orderedList: false,
      }),
      Placeholder.configure({ placeholder }),
      CharacterCount.configure({ limit: 5000 }),
      Markdown.configure({
        html: false,              // never render raw HTML
        transformPastedText: true, // parse pasted markdown
        bulletListMarker: '-',
        linkify: true,
      }),
    ],
    content: initialContent, // markdown string — Markdown extension parses it
    autofocus: true,
    onUpdate({ editor }) {
      onUpdate(editor.storage.markdown.getMarkdown());
    },
    editorProps: {
      handleKeyDown(_view, event) {
        if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
          event.preventDefault();
          onSubmit();
          return true;
        }
        if (event.key === 'Escape') {
          onEscape?.();
          return true;
        }
        return false;
      },
      handlePaste(view, event) {
        // Screenshot paste — delegate to existing handlePaste from ComposeArea
        // via a ref forwarded into the hook
        return false; // fall through to default paste
      },
      handleDrop(view, event) {
        // File drop — same as handlePaste, delegate to existing addFiles()
        return false;
      },
    },
  });
}
```

### 3. Refactor `FormatToolbar` to take an `editor` prop (est. 1 hour)

Instead of `textareaRef + onTextChange + getText`, take the Tiptap `Editor` instance. Each action calls `editor.chain().focus().toggleBold().run()` etc. Active state highlights via `editor.isActive('bold')`.

```tsx
<button
  type="button"
  onClick={() => editor.chain().focus().toggleBold().run()}
  className={`fmt-btn ${editor.isActive('bold') ? 'active' : ''}`}
>
  <Bold className="w-3.5 h-3.5" strokeWidth={2.5} />
</button>
```

Bonus: active-state indication (the current plain-text toolbar has no way to know if the cursor is inside an existing bold span).

### 4. Wire up `ComposeArea` (est. 3–4 hours)

Replace `<textarea>` with `<EditorContent editor={editor} />`. Delete the `text` / `setText` state — the editor owns its content. Replace all previous `text` reads with `editor.storage.markdown.getMarkdown()`.

Points of surgery:

- **Drafts** — useEffect writes `editor.storage.markdown.getMarkdown()` to sessionStorage every 400ms. Hydrate on key change by calling `editor.commands.setContent(savedMarkdown)`.
- **doSend()** — read markdown from editor, pass to server as today. On successful send, `editor.commands.clearContent()`.
- **AI improve** — `editor.commands.setContent(result.improved)` after the API call. Store the previous markdown in `originalText` as before; "revert" calls `setContent(originalText)`.
- **Canned response** — same, `editor.commands.setContent(body)` on pick. The `/` trigger needs to look at the markdown buffer, not a text-state variable. Use `editor.on('update', ...)` to watch for a leading `/`.
- **Emoji picker** — `editor.chain().focus().insertContent(emoji).run()`.
- **Character counter** — read from `editor.storage.characterCount.characters()`; display when > 3500 exactly as today.
- **Send button disable logic** — `!editor || editor.isEmpty` replaces `!text.trim()`.
- **Drag & drop** — move handlers into the editor's `handleDrop` prop or leave on the wrapper (Tiptap's `editable` area sits inside so drop events bubble up — test both).
- **Paste screenshots** — Tiptap's `handlePaste` gets first crack; if the paste contains image files, call the existing `addFiles()` helper and return `true` (we consumed the paste).

### 5. Retrofit `MessageContent` (est. 30 min)

Currently renders markdown via the existing `marked`/`remark`-based pipeline. Double-check that what Tiptap-Markdown serializes round-trips correctly through the sent-message render path. In particular:
- Strikethrough (`~~`)
- Nested inline formatting
- Empty lines between paragraphs

If any round-trip diff shows up, either tune Tiptap-Markdown's serializer options or teach the reader to accept both flavours.

### 6. Tests (est. 3 hours)

- **Unit:** useComposeEditor returns an editor; toggling Bold on selection wraps in `**…**` when serialized; Enter calls onSubmit; Shift+Enter inserts a hard break.
- **Component:** `ComposeArea.test.tsx` — render, type text, click Bold, verify the serialized markdown has `**`, click Send, verify `message:send` was emitted with the markdown payload.
- **E2E:** one new Playwright spec that types some markdown in the compose area, clicks format buttons, sends, and asserts the rendered bubble on the other side of the conversation shows the formatting correctly.

### 7. Docs (est. 30 min)

- Update `docs/BRUTALIST_DESIGN_SPEC.md` with the editor's styling notes.
- Write a `CHANGELOG.md` entry under the next version.
- Screenshot before/after for the release notes.

---

## Risks & mitigations

### Round-trip fidelity

**Risk:** user types `**bold**`, Tiptap parses to a bold run, serializes back to `**bold**`, sent to server, stored, fetched, rendered by `MessageContent` through `marked` — and the final render differs subtly (whitespace, escaping, nested ambiguity).

**Mitigation:** add a round-trip test fixture. Take 10 canonical chat messages with various formatting, run them through the full cycle (editor → serialize → store → fetch → render), compare pixel-equivalent output. Fix serializer options until all 10 match.

### Bundle size

**Risk:** Tiptap + ProseMirror add ~70 KB gzipped to the client bundle.

**Mitigation:** code-split the compose area so only support/agent chat views load it. The rest of Tessera (platform cockpit, admin panels, login) don't need the editor.

### Whisper styling

**Risk:** the current `.bubble-whisper .msg-markdown { font-family: mono }` only applies to rendered sent messages, not the live editor. Whisper mode inside the editor needs its own font override.

**Mitigation:** add `.ProseMirror.whisper-active { font-family: mono; … }` in `index.css`. One-line CSS.

### Accessibility

**Risk:** screen readers need to be able to navigate rich-text regions correctly.

**Mitigation:** Tiptap sets `role="textbox"` + `aria-multiline="true"` on `.ProseMirror`. Add an `aria-label` prop to the `<EditorContent>` wrapper matching the current `aria-label="Type a message"`. Run through NVDA/VoiceOver in the E2E test baseline.

### Canned response `/` trigger race

**Risk:** currently the textarea's `onChange` checks `val.startsWith('/')` synchronously. With Tiptap, the content updates asynchronously after keystrokes, and the first character check has to happen against the markdown serialization.

**Mitigation:** subscribe to `editor.on('update', ...)` and check the leading character of `getMarkdown()`. Debounce 50ms to avoid firing during rapid typing.

---

## Acceptance criteria

- [ ] Support staff see **bold**, *italic*, ~~strikethrough~~, `code`, blockquote, and bullet lists rendered inline as they type. No raw `**` visible.
- [ ] All 7 compose features from the in-scope list still work: AI improve, drafts, canned responses, reply-to, attachments, drag & drop, paste screenshots, whisper mode, character counter, emoji, Enter to send, Escape to clear reply.
- [ ] A message typed in the editor and sent by one user renders identically on the receiver side.
- [ ] Draft saved, tab reloaded, draft restored in the editor with formatting intact.
- [ ] AI improve replaces the editor content; revert restores the pre-improve content with formatting intact.
- [ ] Canned response replaces the editor content with the canned body.
- [ ] Bundle size impact on the support view chunk is measured and documented (target: < 80 KB gzipped increase).
- [ ] No Playwright regressions on the existing E2E suite.
- [ ] The new round-trip test fixture passes for 10 canonical messages.

---

## Open questions

1. **Keep both the old textarea fallback and the Tiptap editor behind a feature flag for one release cycle?** Safer rollout, more maintenance cost. My recommendation: **yes**, flag on `VITE_USE_RICH_EDITOR`, default on in dev, off in prod for the first release, flip on after 1 week of dev usage with no regressions.
2. **Preserve markdown syntax escape hatch?** Some users prefer typing `**` even in a WYSIWYG editor. Tiptap supports "input rules" that auto-convert markdown sequences to formatting as you type — enable them so `**hello**` still becomes **hello** in the editor. This is the default in StarterKit.
3. **Agent (customer) side — do they get the editor too?** The current compose is shared between `AgentView` and `SupportView`. Agents probably don't need formatting (and might be confused by it). Consider rendering a simpler plain `<textarea>` for `role === 'agent'` and the full editor for support — or render the editor for both but hide the format toolbar for agents.

---

## Dependencies / blockers

- None in the codebase. All of the above is additive; nothing else needs to land first.
- Visual QA needs a support chat pair (two-browser test). Current dev workflow already supports this via Chrome + Edge.

---

## Rollout

1. Land the migration behind `VITE_USE_RICH_EDITOR=true` in `docker-compose.yml`.
2. Run the full Playwright suite including the new round-trip spec.
3. Dev-use it for a week. Fix any regressions.
4. Flip the flag on in `docker-compose.prod.yml`.
5. Monitor for 48h in prod, roll back the flag if any regressions surface.
6. After two weeks stable, delete the old textarea path and the feature flag.

---

## Related

- `docs/mockups/compose-area.html` — the current non-WYSIWYG compose redesign (Ghost icon, unified box, drafts, drag&drop, strikethrough). Tiptap migration sits *on top* of this visual pass, not in place of it.
- `[[learnings/tessera-user-role-login-response-gap]]` — potentially affects how we distinguish agent vs support compose (see Open Question #3).
