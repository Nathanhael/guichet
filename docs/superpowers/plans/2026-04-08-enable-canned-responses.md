# Enable Canned Responses — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-enable the fully-built canned response feature by removing the feature gate and re-wiring the ComposeArea picker integration.

**Architecture:** Two files change. `server/constants.ts` has the feature gate array — remove one entry. `client/src/components/chat/ComposeArea.tsx` has 3 commented-out wiring points — restore them with a new `showCannedPicker` state variable. The `CannedResponsePicker` component and tRPC router are untouched — they're already complete.

**Tech Stack:** React 19, tRPC 11, Zustand, Drizzle ORM (PostgreSQL)

---

### Task 1: Remove Feature Gate

**Files:**
- Modify: `server/constants.ts:32-37`

- [ ] **Step 1: Remove `'cannedResponse'` from `DISABLED_FEATURES`**

Edit `server/constants.ts`. Change the type and array:

```ts
// Before (line 32-37):
export type DisabledFeature = 'cannedResponse' | 'knowledgeBase' | 'webhooks';
export const DISABLED_FEATURES: readonly DisabledFeature[] = [
  'cannedResponse',
  'knowledgeBase',
  'webhooks',
];

// After:
export type DisabledFeature = 'knowledgeBase' | 'webhooks';
export const DISABLED_FEATURES: readonly DisabledFeature[] = [
  'knowledgeBase',
  'webhooks',
];
```

- [ ] **Step 2: Verify server still compiles**

Run: `docker compose exec server npx tsc --noEmit`
Expected: Clean exit, no errors.

- [ ] **Step 3: Commit**

```bash
git add server/constants.ts
git commit -m "feat: remove cannedResponse feature gate"
```

---

### Task 2: Add Click-Outside Handler to CannedResponsePicker

**Files:**
- Modify: `client/src/components/CannedResponsePicker.tsx:30,33,102-104`

The picker has no click-outside-to-close behavior. The emoji picker in ComposeArea uses a `mousedown` listener pattern — replicate it here.

- [ ] **Step 1: Add a wrapper ref and click-outside effect**

In `CannedResponsePicker`, the component already has `listRef` on the inner list div. Add a new `wrapperRef` on a wrapping `<div>` and a `mousedown` effect that calls `onClose` when clicking outside.

Add after line 34 (`const [selectedIndex, setSelectedIndex] = useState(0);`):

```tsx
const wrapperRef = useRef<HTMLDivElement>(null);

// Close on click outside
useEffect(() => {
  function handleClickOutside(e: MouseEvent) {
    if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
      onClose();
    }
  }
  document.addEventListener('mousedown', handleClickOutside);
  return () => document.removeEventListener('mousedown', handleClickOutside);
}, [onClose]);
```

Then wrap both return paths (the "no matches" div at line 93 and the main list at line 102) with a `<div ref={wrapperRef}>`. Specifically:

For the "no matches" return (line 92-98), change to:

```tsx
if (filtered.length === 0 && query) {
  return (
    <div ref={wrapperRef}>
      <div className="absolute bottom-full left-0 right-0 mb-1 bg-bg-surface border border-border-heavy p-4 z-50">
        <p className="text-xs text-text-muted italic">{t('no_canned_responses') || 'No matching responses'}</p>
      </div>
    </div>
  );
}
```

For the main list return (line 102-140), wrap the existing `<div ref={listRef}>` inside a `<div ref={wrapperRef}>`:

```tsx
return (
  <div ref={wrapperRef}>
    <div
      ref={listRef}
      className="absolute bottom-full left-0 right-0 mb-1 bg-bg-surface border border-border-heavy max-h-64 overflow-y-auto z-50"
    >
      {/* ...existing content unchanged... */}
    </div>
  </div>
);
```

- [ ] **Step 2: Verify client compiles**

Run: `docker compose exec client npx tsc --noEmit`
Expected: Clean exit, no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/CannedResponsePicker.tsx
git commit -m "feat: add click-outside-to-close for CannedResponsePicker"
```

---

### Task 3: Re-wire ComposeArea — State and Import

**Files:**
- Modify: `client/src/components/chat/ComposeArea.tsx:1,44`

- [ ] **Step 1: Add CannedResponsePicker import**

Add after line 9 (`import Toast from '../Toast';`):

```tsx
import CannedResponsePicker from '../CannedResponsePicker';
```

- [ ] **Step 2: Add `showCannedPicker` state**

Add after line 44 (`const [showEmojiPicker, setShowEmojiPicker] = useState(false);`):

```tsx
const [showCannedPicker, setShowCannedPicker] = useState(false);
```

- [ ] **Step 3: Verify client compiles**

Run: `docker compose exec client npx tsc --noEmit`
Expected: Clean exit (unused import warning is fine — we wire it next).

- [ ] **Step 4: Commit**

```bash
git add client/src/components/chat/ComposeArea.tsx
git commit -m "feat: add CannedResponsePicker import and state to ComposeArea"
```

---

### Task 4: Re-wire ComposeArea — Render, Trigger, Key Guard

**Files:**
- Modify: `client/src/components/chat/ComposeArea.tsx:527-544`

This task wires the three `DISABLED_FEATURE` sites.

- [ ] **Step 1: Site A — Render the picker (line 528)**

Replace line 528:
```tsx
          {/* DISABLED_FEATURE: CannedResponsePicker removed until production-ready */}
```

With:
```tsx
          {isSupport && showCannedPicker && (
            <CannedResponsePicker
              inputText={text}
              dept={ticket.dept}
              onSelect={(body) => {
                setText(body);
                setShowCannedPicker(false);
                textareaRef.current?.focus();
                autoResize();
              }}
              onClose={() => setShowCannedPicker(false)}
            />
          )}
```

- [ ] **Step 2: Site B — onChange trigger (line 536)**

Replace line 536:
```tsx
              // DISABLED_FEATURE: canned picker "/" trigger removed until production-ready
```

With:
```tsx
              if (isSupport) {
                if (val.startsWith('/')) {
                  setShowCannedPicker(true);
                } else if (showCannedPicker) {
                  setShowCannedPicker(false);
                }
              }
```

- [ ] **Step 3: Site C — onKeyDown guard (line 541)**

Replace line 541:
```tsx
              // DISABLED_FEATURE: canned picker key guard removed until production-ready
```

With:
```tsx
              if (showCannedPicker) {
                if (['ArrowUp', 'ArrowDown', 'Enter'].includes(e.key)) {
                  return; // CannedResponsePicker handles these via global keydown listener
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setShowCannedPicker(false);
                  return;
                }
              }
```

- [ ] **Step 4: Verify client compiles**

Run: `docker compose exec client npx tsc --noEmit`
Expected: Clean exit, no errors.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/chat/ComposeArea.tsx
git commit -m "feat: re-enable canned response picker in ComposeArea"
```

---

### Task 5: Clean Up ChatWindow Stale Comment

**Files:**
- Modify: `client/src/components/ChatWindow.tsx:38`

- [ ] **Step 1: Remove stale disabled-feature comment**

Line 38 in ChatWindow.tsx has:
```tsx
  // DISABLED_FEATURE: const [showCannedPicker, setShowCannedPicker] = useState(false);
```

Delete this line entirely — the state now lives in ComposeArea where it belongs.

- [ ] **Step 2: Commit**

```bash
git add client/src/components/ChatWindow.tsx
git commit -m "chore: remove stale DISABLED_FEATURE comment from ChatWindow"
```

---

### Task 6: Manual Smoke Test

No code changes — verify the feature works end-to-end.

- [ ] **Step 1: Ensure containers are running**

Run: `docker compose up -d`

- [ ] **Step 2: Create a canned response via Admin panel**

1. Log in as an admin user
2. Navigate to AdminView → Canned Responses tab
3. Create a response: Title = "Greeting", Body = "Hello {{agentName}}, how can I help?", Shortcut = "hi"
4. Verify it appears in the list

- [ ] **Step 3: Test picker in SupportView**

1. Log in as a support user (or switch to support role)
2. Open an active ticket's ChatWindow
3. Type `/` in the compose area
4. Verify: picker popup appears above the textarea showing "Greeting"
5. Type `/hi` — verify it filters to the "Greeting" response
6. Press Enter — verify the textarea is replaced with "Hello [your name], how can I help?"
7. Verify the `/` prefix is gone and the expanded text is ready to send

- [ ] **Step 4: Test keyboard navigation**

1. Type `/` to open the picker
2. Press ↑↓ to navigate — verify highlight moves
3. Press Escape — verify picker closes
4. Press Enter on normal text (without `/`) — verify message sends normally

- [ ] **Step 5: Test agent cannot see picker**

1. Log in as an agent
2. Open a ticket, type `/` in compose area
3. Verify: NO picker appears — just the literal `/` character in the textarea

- [ ] **Step 6: Test click-outside**

1. As support, type `/` to open picker
2. Click anywhere outside the picker
3. Verify: picker closes
