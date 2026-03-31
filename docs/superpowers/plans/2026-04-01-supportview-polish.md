# SupportView Polish Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 4 polish issues in SupportView: missing i18n keys, SavedViewPicker dropdown clipping, JOIN button prominence, and sidebar tab label fit.

**Architecture:** Surgical in-place fixes to existing components. No new files, no layout restructure. Portal pattern for dropdown escape from overflow-hidden ancestor.

**Tech Stack:** React 19, Tailwind CSS 4, ReactDOM.createPortal, i18n locale files

---

### Task 1: Add Missing i18n Keys

**Files:**
- Modify: `client/src/locales/en.ts` (insert after line 303, near `preview_mode`)
- Modify: `client/src/locales/nl.ts` (insert after line 300, near `preview_mode`)
- Modify: `client/src/locales/fr.ts` (insert after line 300, near `preview_mode`)

- [ ] **Step 1: Add keys to en.ts**

In `client/src/locales/en.ts`, after the `preview_mode` line, add:

```typescript
    waiting_for_expert: 'Waiting for expert',
    search_messages: 'Search messages…',
```

- [ ] **Step 2: Add keys to nl.ts**

In `client/src/locales/nl.ts`, after the `preview_mode` line, add:

```typescript
    waiting_for_expert: 'Wachten op expert',
    search_messages: 'Zoek berichten…',
```

- [ ] **Step 3: Add keys to fr.ts**

In `client/src/locales/fr.ts`, after the `preview_mode` line, add:

```typescript
    waiting_for_expert: 'En attente d\u2019un expert',
    search_messages: 'Rechercher des messages…',
```

- [ ] **Step 4: Verify in browser**

Reload SupportView. The TicketPreview join bar should now show "WAITING FOR EXPERT" (no underscores — the CSS `uppercase` transforms the properly-spaced translation). The search input placeholder should show "SEARCH MESSAGES…".

- [ ] **Step 5: Commit**

```bash
git add client/src/locales/en.ts client/src/locales/nl.ts client/src/locales/fr.ts
git commit -m "fix(i18n): add missing waiting_for_expert and search_messages keys

Raw i18n key fallback combined with CSS uppercase made status strings
appear as WAITING_FOR_EXPERT and SEARCH_MESSAGES in the UI."
```

---

### Task 2: Portal the SavedViewPicker Dropdown

**Files:**
- Modify: `client/src/components/support/SavedViewPicker.tsx`

The `<aside>` in QueueSidebar uses `overflow-hidden` for the collapse animation (w-80 → w-0). This clips the absolutely-positioned dropdown. Fix: render the dropdown via `ReactDOM.createPortal` positioned relative to the toggle button.

- [ ] **Step 1: Add imports and ref**

In `SavedViewPicker.tsx`, update the import and add a ref for positioning:

```typescript
import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
```

Inside the component function, add after the existing state declarations:

```typescript
const toggleRef = useRef<HTMLButtonElement>(null);
const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
```

- [ ] **Step 2: Add positioning effect**

Add a `useEffect` that recalculates position when the dropdown opens:

```typescript
useEffect(() => {
  if (isOpen && toggleRef.current) {
    const rect = toggleRef.current.getBoundingClientRect();
    setDropdownPos({
      top: rect.bottom + 4,
      left: rect.left,
    });
  }
}, [isOpen]);
```

- [ ] **Step 3: Add ref to toggle button**

On the existing toggle `<button>`, add the ref:

```tsx
<button
  ref={toggleRef}
  onClick={() => setIsOpen((v) => !v)}
  // ... rest of props unchanged
>
```

- [ ] **Step 4: Wrap dropdown in portal**

Replace the existing dropdown `{isOpen && (<div className="absolute top-full left-0 mt-1 w-56 ...">...</div>)}` block. Change the outer wrapper from `absolute top-full left-0 mt-1` to `fixed` with inline style positioning, and wrap it in `createPortal`:

```tsx
{isOpen && createPortal(
  <div
    className="fixed w-56 bg-[var(--color-bg-surface)] border border-[var(--color-border)] z-50 animate-fade-in"
    style={{ top: dropdownPos.top, left: dropdownPos.left }}
  >
    {/* ... all existing dropdown content (header, view list, save section) stays identical ... */}
  </div>,
  document.body
)}
```

Key changes:
- Remove `className="absolute top-full left-0 mt-1"` → use `className="fixed"` + inline `style`
- Wrap the entire `<div>` in `createPortal(..., document.body)`
- All inner content (header, view list, save section) stays exactly the same

- [ ] **Step 5: Add click-outside handler**

Add an effect to close the dropdown when clicking outside:

```typescript
useEffect(() => {
  if (!isOpen) return;
  function handleClick(e: MouseEvent) {
    if (
      toggleRef.current && !toggleRef.current.contains(e.target as Node)
    ) {
      // Check if click is inside the portal dropdown
      const dropdown = document.querySelector('[data-saved-view-dropdown]');
      if (dropdown && dropdown.contains(e.target as Node)) return;
      setIsOpen(false);
    }
  }
  document.addEventListener('mousedown', handleClick);
  return () => document.removeEventListener('mousedown', handleClick);
}, [isOpen]);
```

Add `data-saved-view-dropdown` attribute to the portal div:

```tsx
<div
  data-saved-view-dropdown
  className="fixed w-56 ..."
  style={{ top: dropdownPos.top, left: dropdownPos.left }}
>
```

- [ ] **Step 6: Verify in browser**

Open the SupportView sidebar. Click the bookmark icon. The dropdown should render on top of all content, not clipped by the sidebar boundary. Clicking outside should close it.

- [ ] **Step 7: Commit**

```bash
git add client/src/components/support/SavedViewPicker.tsx
git commit -m "fix(SavedViewPicker): render dropdown via portal to escape sidebar overflow

The sidebar aside uses overflow-hidden for its collapse animation,
which clipped the absolutely-positioned dropdown. Portal to document.body
with fixed positioning resolves the clipping."
```

---

### Task 3: Increase JOIN Button Prominence

**Files:**
- Modify: `client/src/components/TicketPreview.tsx`

The status text visually dominates the JOIN CTA. Fix: make JOIN larger, make status text secondary.

- [ ] **Step 1: Update the join bar styling**

In `TicketPreview.tsx`, find the join bar section (the `<>` fragment inside the non-closed ticket branch, around line 98-109). Replace:

```tsx
<p className="text-sm font-bold uppercase tracking-widest text-text-primary">{t('waiting_for_expert')}</p>
<button
  onClick={onJoin}
  disabled={joinDisabled}
  className={`px-6 py-2 text-[10px] font-bold uppercase tracking-widest ${joinDisabled
    ? 'btn-secondary opacity-20 cursor-not-allowed'
    : 'btn-primary'
    }`}
>
  {t('join')}
</button>
```

With:

```tsx
<p className="text-xs font-bold uppercase tracking-wide text-text-muted">{t('waiting_for_expert')}</p>
<button
  onClick={onJoin}
  disabled={joinDisabled}
  className={`px-8 py-3 text-xs font-bold uppercase tracking-widest ${joinDisabled
    ? 'btn-secondary opacity-20 cursor-not-allowed'
    : 'btn-primary'
    }`}
>
  {t('join')}
</button>
```

Changes:
- Status text: `text-sm` → `text-xs`, `tracking-widest` → `tracking-wide`, `text-text-primary` → `text-text-muted`
- Button: `px-6 py-2` → `px-8 py-3`, `text-[10px]` → `text-xs`

- [ ] **Step 2: Verify in browser**

Open a ticket preview in SupportView. The JOIN button should now be the visual anchor — larger and more prominent. The status text should read "WAITING FOR EXPERT" in muted color, visually secondary.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/TicketPreview.tsx
git commit -m "fix(TicketPreview): make JOIN button more prominent than status text

Increased button padding and font size. Reduced status text to muted
secondary styling so the primary CTA draws the eye."
```

---

### Task 4 (Optional): Improve Message Bubble Visibility

**Files:**
- Modify: `client/src/index.css` (dark mode tokens only)

Current dark mode bubble backgrounds:
- Received: `--color-bg-elevated` = `#27272a` (on base `#09090b`)
- Sent: `--color-own-msg-bg` = `#1e3a5f` (on base `#09090b`)

Text contrast is fine (WCAG AA passes). The issue is bubble-vs-background *distinction* — bubbles blend into the dark base. This is a global token change affecting all views, so proceed carefully.

- [ ] **Step 1: Evaluate and decide**

Check the bubble visibility in ChatWindow (active support chat) vs TicketPreview (read-only preview). If bubbles look fine in ChatWindow but bad in preview, the issue may be TicketPreview-specific (e.g. missing padding or different background). If it's global, consider bumping:
- `--color-bg-elevated` from `#27272a` to `#2d2d30` (subtle increase)
- `--color-own-msg-bg` from `#1e3a5f` to `#1e4070` (slightly brighter blue)

Only proceed if the change improves preview without degrading other views.

- [ ] **Step 2: If changing, update index.css dark mode tokens**

In the `.dark` section of `index.css`, update the specific values. Test across SupportView, AdminView, and ChatWindow to verify no regressions.

- [ ] **Step 3: Commit (if changed)**

```bash
git add client/src/index.css
git commit -m "fix(theme): bump dark mode bubble backgrounds for better distinction

Subtle lightness increase to message bubble backgrounds so they
stand out better against the #09090b base in dark mode."
```

---

## Execution Order

Tasks 1-3 are independent and can be parallelized. Task 4 is optional and should be done last (if at all) since it changes global tokens.
