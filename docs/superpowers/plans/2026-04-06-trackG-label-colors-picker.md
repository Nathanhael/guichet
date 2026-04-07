# Track G: Label Colors + Inline Label Picker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix label badges to show actual colors (instead of all-grey) and add an inline label picker to the chat header so support/admin can tag tickets without leaving the chat.

**Architecture:** Extract shared `COLOR_BG_MAP` utility, update label rendering in `ChatHeader`, create new `LabelPicker` component. No backend changes — the `ticket:labels:update` socket handler already exists.

**Tech Stack:** React 19, TypeScript, Socket.io client, Tailwind CSS

**Depends on:** Track 0 (ChatWindow decomposition) — `ChatHeader.tsx` must exist.

---

### Task 1: Extract shared label color utility

**Files:**
- Create: `client/src/utils/labelColors.ts`
- Modify: `client/src/components/admin/AdminLabels.tsx` (import from shared util)

- [ ] **Step 1: Create the shared utility**

```ts
// client/src/utils/labelColors.ts

export const LABEL_COLORS = [
  { key: 'indigo', bg: 'bg-indigo-500', ring: 'ring-indigo-500' },
  { key: 'emerald', bg: 'bg-emerald-500', ring: 'ring-emerald-500' },
  { key: 'amber', bg: 'bg-amber-500', ring: 'ring-amber-500' },
  { key: 'rose', bg: 'bg-rose-500', ring: 'ring-rose-500' },
  { key: 'sky', bg: 'bg-sky-500', ring: 'ring-sky-500' },
  { key: 'pink', bg: 'bg-pink-500', ring: 'ring-pink-500' },
  { key: 'slate', bg: 'bg-slate-500', ring: 'ring-slate-500' },
] as const;

export type LabelColorKey = typeof LABEL_COLORS[number]['key'];

/** Map color key to Tailwind bg class. Used in ChatHeader labels and AdminLabels. */
export const COLOR_BG_MAP: Record<string, string> = Object.fromEntries(
  LABEL_COLORS.map((c) => [c.key, c.bg]),
);

/** Map color key to Tailwind ring class. Used in AdminLabels color picker. */
export const COLOR_RING_MAP: Record<string, string> = Object.fromEntries(
  LABEL_COLORS.map((c) => [c.key, c.ring]),
);
```

- [ ] **Step 2: Update AdminLabels to import from shared util**

In `client/src/components/admin/AdminLabels.tsx`, find the local `COLORS` array and `COLOR_BG_MAP`:

```ts
// Remove these local definitions:
const COLORS = [ ... ] as const;
const COLOR_BG_MAP: Record<string, string> = ...;
```

Replace with:
```ts
import { LABEL_COLORS, COLOR_BG_MAP, COLOR_RING_MAP } from '../../utils/labelColors';

// Replace references to local COLORS with LABEL_COLORS
// Replace references to local ring map with COLOR_RING_MAP
```

Update all references in AdminLabels:
- `COLORS` → `LABEL_COLORS`
- `typeof COLORS[number]['key']` → `LabelColorKey` (import it)
- Color picker rendering that uses `c.ring` → use `COLOR_RING_MAP[c.key]`

- [ ] **Step 3: Typecheck**

Run: `docker compose exec client npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add client/src/utils/labelColors.ts client/src/components/admin/AdminLabels.tsx
git commit -m "refactor(track-g): extract shared label color utility from AdminLabels"
```

---

### Task 2: Fix label colors in ChatHeader

**Files:**
- Modify: `client/src/components/chat/ChatHeader.tsx`

- [ ] **Step 1: Import color map**

```ts
import { COLOR_BG_MAP } from '../../utils/labelColors';
```

- [ ] **Step 2: Update label badge rendering**

Find the label rendering section (moved from ChatWindow, originally around line 550-565). Current code:

```tsx
<span
  key={id}
  className={`text-[8px] font-bold px-1.5 py-0.5 uppercase tracking-widest bg-bg-elevated text-text-primary border border-border-heavy`}
>
  {info.text}
</span>
```

Replace with:
```tsx
<span
  key={id}
  className={`text-[8px] font-bold px-1.5 py-0.5 uppercase tracking-widest ${
    info.color && COLOR_BG_MAP[info.color]
      ? `${COLOR_BG_MAP[info.color]} text-white`
      : 'bg-bg-elevated text-text-primary border border-border-heavy'
  }`}
>
  {info.name}
</span>
```

> **Note:** The Label interface has `name` and `color` fields. Check whether the current code uses `info.text` or `info.name` — the Label type has `name: string`, not `text`. Fix accordingly.

- [ ] **Step 3: Typecheck**

Run: `docker compose exec client npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add client/src/components/chat/ChatHeader.tsx
git commit -m "feat(track-g): render label badges with actual colors in ChatHeader"
```

---

### Task 3: Create LabelPicker component

**Files:**
- Create: `client/src/components/chat/LabelPicker.tsx`

- [ ] **Step 1: Write the component**

```tsx
// client/src/components/chat/LabelPicker.tsx
import { useState, useRef, useEffect } from 'react';
import { getSocket } from '../../hooks/useSocket';
import { useT } from '../../i18n';
import { Label } from '../../types';
import { COLOR_BG_MAP } from '../../utils/labelColors';
import { Plus, Check } from 'lucide-react';

interface LabelPickerProps {
  ticketId: string;
  currentLabels: string[];
  allLabels: Label[];
}

export default function LabelPicker({ ticketId, currentLabels, allLabels }: LabelPickerProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [optimisticLabels, setOptimisticLabels] = useState<string[]>(currentLabels);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Sync optimistic state when props change (e.g., after server broadcast)
  useEffect(() => {
    setOptimisticLabels(currentLabels);
  }, [currentLabels]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  function toggleLabel(labelId: string) {
    const newLabels = optimisticLabels.includes(labelId)
      ? optimisticLabels.filter((id) => id !== labelId)
      : [...optimisticLabels, labelId];

    setOptimisticLabels(newLabels);
    getSocket().emit('ticket:labels:update', { ticketId, labels: newLabels });
  }

  if (allLabels.length === 0) return null;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        className="text-[8px] font-bold px-1.5 py-0.5 uppercase tracking-widest bg-bg-elevated text-text-secondary border border-border-heavy hover:text-text-primary"
        aria-label={t('add_label') || 'Add label'}
        title={t('add_label') || 'Add label'}
      >
        <Plus size={10} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 bg-bg-surface border border-border-heavy z-50 min-w-[180px] max-h-[200px] overflow-y-auto animate-fade-in">
          {allLabels.map((label) => {
            const isActive = optimisticLabels.includes(label.id);
            const bgClass = COLOR_BG_MAP[label.color] || 'bg-slate-500';
            return (
              <button
                key={label.id}
                onClick={() => toggleLabel(label.id)}
                className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-bg-elevated text-left"
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${bgClass}`} />
                <span className="font-mono text-[10px] text-text-primary flex-1 truncate">
                  {label.name}
                </span>
                {isActive && (
                  <Check size={12} className="text-accent-blue shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Export from barrel**

Add to `client/src/components/chat/index.ts`:
```ts
export { default as LabelPicker } from './LabelPicker';
```

- [ ] **Step 3: Typecheck**

Run: `docker compose exec client npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add client/src/components/chat/LabelPicker.tsx client/src/components/chat/index.ts
git commit -m "feat(track-g): add LabelPicker component with optimistic toggle"
```

---

### Task 4: Wire LabelPicker into ChatHeader

**Files:**
- Modify: `client/src/components/chat/ChatHeader.tsx`

- [ ] **Step 1: Import LabelPicker**

```ts
import LabelPicker from './LabelPicker';
```

- [ ] **Step 2: Add LabelPicker after label badges**

Find the labels section in ChatHeader. After the `.map()` that renders label badges, add the picker:

```tsx
{/* Active Labels Display */}
{!focusMode && !compact && (
  <div className="flex flex-wrap items-center gap-1 ml-2">
    {(liveTicket.labels || []).map((id: string) => {
      const info = getLabelInfo(id);
      if (!info) return null;
      return (
        <span
          key={id}
          className={`text-[8px] font-bold px-1.5 py-0.5 uppercase tracking-widest ${
            info.color && COLOR_BG_MAP[info.color]
              ? `${COLOR_BG_MAP[info.color]} text-white`
              : 'bg-bg-elevated text-text-primary border border-border-heavy'
          }`}
        >
          {info.name}
        </span>
      );
    })}
    {/* Label picker — support/admin only */}
    {isSupport && (
      <LabelPicker
        ticketId={ticket.id}
        currentLabels={liveTicket.labels || []}
        allLabels={allLabels || []}
      />
    )}
  </div>
)}
```

> **Note:** The label section now always renders the wrapper `div` (even with 0 labels) so the `+` button is always visible for support/admin. The `liveTicket.labels && liveTicket.labels.length > 0` guard is removed from the outer conditional — we want the picker to show even when no labels are assigned yet.

- [ ] **Step 3: Typecheck**

Run: `docker compose exec client npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add client/src/components/chat/ChatHeader.tsx
git commit -m "feat(track-g): wire LabelPicker into ChatHeader for support/admin users"
```

---

### Task 5: Add i18n key and verify

**Files:**
- Modify: i18n translation files

- [ ] **Step 1: Add translation key**

| Key | EN | NL | FR |
|-----|----|----|-----|
| `add_label` | `Add label` | `Label toevoegen` | `Ajouter un label` |

- [ ] **Step 2: Manual smoke test**

1. Open a ticket as support → see colored label badges (not grey)
2. See `+` button after labels
3. Click `+` → dropdown opens with all partner labels, active ones have a checkmark
4. Click a label to toggle it on → badge appears immediately (optimistic)
5. Click an active label to toggle it off → badge disappears immediately
6. Click outside dropdown → closes
7. Press Escape → closes
8. Open as agent → no `+` button visible (agents can't manage labels)
9. Verify AdminLabels still works (CRUD, color picker)

- [ ] **Step 3: Run existing tests**

Run: `docker compose exec client npm test`
Expected: All pass

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat(track-g): complete label colors + inline label picker"
```

---

## Summary

Track G delivers:
1. **Shared utility** (`labelColors.ts`) — eliminates duplicate color maps between AdminLabels and ChatHeader
2. **Colored label badges** — labels show their actual color instead of uniform grey
3. **Inline label picker** — support/admin can tag tickets directly from the chat header via a `+` dropdown
