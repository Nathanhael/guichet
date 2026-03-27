# Accessibility Popover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an accessibility popover to NavToolbar with toggles for dyslexic font (Lexend), bionic reading, monochrome, and focus mode — with server-side persistence.

**Architecture:** New `AccessibilityMenu` component in NavToolbar's children slot. Store toggles follow existing `toggleDarkMode` pattern. Server persistence via new `accessibility_prefs` JSONB column on `users` table, synced through login response and a new tRPC mutation. Hydration: localStorage for instant paint, server for authority.

**Tech Stack:** React 19, Zustand 5, tRPC 11, Drizzle ORM, PostgreSQL 18, Tailwind CSS 4

**Spec:** `docs/superpowers/specs/2026-03-27-accessibility-popover-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `client/src/components/AccessibilityMenu.tsx` | Popover trigger + toggle panel |
| Create | `client/src/components/__tests__/AccessibilityMenu.test.tsx` | Unit tests for the popover |
| Modify | `client/src/store/slices/uiSlice.ts` | Wire toggle stubs + hydration action |
| Modify | `client/src/index.css` | `.dyslexic-mode` CSS rule |
| Modify | `client/src/components/NavToolbar.tsx` | Render AccessibilityMenu in children slot |
| Modify | `client/src/components/admin/AdminKnowledgeBase.tsx` | Wrap preview body in BionicText |
| Modify | `client/src/components/admin/AdminCannedResponses.tsx` | Wrap preview body in BionicText |
| Modify | `client/src/types/index.ts` | Add `AccessibilityPrefs` interface + extend `User` |
| Modify | `server/db/schema.ts` | Add `accessibilityPrefs` column to users |
| Modify | `server/trpc/routers/user.ts` | Add `updateAccessibilityPrefs` mutation |
| Modify | `server/routes/auth.ts` | Include `accessibilityPrefs` in login response |
| Modify | `client/src/store/slices/authSlice.ts` | Hydrate a11y prefs on login |

---

### Task 1: Database — Add `accessibility_prefs` Column

**Files:**
- Modify: `server/db/schema.ts:55` (users table)

- [ ] **Step 1: Add column to schema**

In `server/db/schema.ts`, add the new column after `notificationPreferences` (line 55):

```typescript
// Find this line:
  notificationPreferences: jsonb('notification_preferences').default({}),

// Add after it:
  accessibilityPrefs: jsonb('accessibility_prefs').default({}).$type<{
    dyslexicMode?: boolean;
    bionicReading?: boolean;
    monochromeMode?: boolean;
    focusMode?: boolean;
  }>(),
```

- [ ] **Step 2: Generate and push migration**

```bash
docker compose exec server npx drizzle-kit generate
docker compose exec server npx drizzle-kit push
```

Expected: Migration adds `accessibility_prefs` JSONB column with `{}` default. Existing rows get empty object.

- [ ] **Step 3: Commit**

```bash
git add server/db/schema.ts
git commit -m "feat(db): add accessibility_prefs JSONB column to users table"
```

---

### Task 2: Types — Add `AccessibilityPrefs` Interface

**Files:**
- Modify: `client/src/types/index.ts:74-84`

- [ ] **Step 1: Add the interface and extend User**

In `client/src/types/index.ts`, add the `AccessibilityPrefs` interface before the `User` interface (before line 75):

```typescript
// Add before the User interface:
export interface AccessibilityPrefs {
  dyslexicMode?: boolean;
  bionicReading?: boolean;
  monochromeMode?: boolean;
  focusMode?: boolean;
}
```

Then extend the `User` interface to include it. Find the existing `User` interface:

```typescript
export interface User {
  id: string;
  name: string;
  role: UserRole;
  lang: 'nl' | 'fr' | 'en';
  isPlatformOperator: boolean;
  avatarUrl?: string;
  departments?: string[];
  dept?: string;
}
```

Replace with:

```typescript
export interface User {
  id: string;
  name: string;
  role: UserRole;
  lang: 'nl' | 'fr' | 'en';
  isPlatformOperator: boolean;
  avatarUrl?: string;
  departments?: string[];
  dept?: string;
  accessibilityPrefs?: AccessibilityPrefs;
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/types/index.ts
git commit -m "feat(types): add AccessibilityPrefs interface and extend User type"
```

---

### Task 3: CSS — Add `.dyslexic-mode` Rule

**Files:**
- Modify: `client/src/index.css`

- [ ] **Step 1: Add dyslexic mode CSS**

In `client/src/index.css`, add after the `.dark { ... }` block (after the dark mode token overrides):

```css
/* Dyslexic mode — swap content font to Lexend, keep JetBrains Mono for UI chrome */
:where(.dyslexic-mode, .dyslexic-mode *) {
  --font-sans: 'Lexend', ui-sans-serif, system-ui, sans-serif;
}
```

This overrides the `--font-sans` custom property (which maps to Inter) with Lexend. JetBrains Mono is referenced via `--font-mono` and remains untouched.

- [ ] **Step 2: Commit**

```bash
git add client/src/index.css
git commit -m "feat(css): add dyslexic-mode class to swap Inter to Lexend"
```

---

### Task 4: Store — Wire Up Toggle Actions + Hydration

**Files:**
- Modify: `client/src/store/slices/uiSlice.ts`

- [ ] **Step 1: Add `hydrateAccessibilityPrefs` to the interface**

In `client/src/store/slices/uiSlice.ts`, add to the `UISlice` interface (after line 23, before the closing `}`):

```typescript
// Find:
  setConnectionStatus: (status: 'connected' | 'disconnected' | 'reconnecting') => void;
}

// Replace with:
  setConnectionStatus: (status: 'connected' | 'disconnected' | 'reconnecting') => void;
  hydrateAccessibilityPrefs: (prefs: { dyslexicMode?: boolean; bionicReading?: boolean; monochromeMode?: boolean; focusMode?: boolean }) => void;
}
```

- [ ] **Step 2: Add localStorage hydration for dyslexicMode, bionicReading, focusMode**

Replace the initial state values for the three unhydrated fields:

```typescript
// Find:
  dyslexicMode: false,
  bionicReading: false,
  monochromeMode: localStorage.getItem('monochromeMode') !== 'false', // Default to true for now to keep the current look
  focusMode: false,

// Replace with:
  dyslexicMode: localStorage.getItem('dyslexicMode') === 'true',
  bionicReading: localStorage.getItem('bionicReading') === 'true',
  monochromeMode: localStorage.getItem('monochromeMode') !== 'false',
  focusMode: localStorage.getItem('focusMode') === 'true',
```

- [ ] **Step 3: Wire up `toggleDyslexicMode`**

Replace the stub:

```typescript
// Find:
  // TODO: stub implementation — wire up dyslexic mode toggle (e.g. toggle class on <html>, persist to localStorage)
  toggleDyslexicMode: () => {},

// Replace with:
  toggleDyslexicMode: () =>
    set((state) => {
      const next = !state.dyslexicMode;
      localStorage.setItem('dyslexicMode', String(next));
      if (next) document.documentElement.classList.add('dyslexic-mode');
      else document.documentElement.classList.remove('dyslexic-mode');
      return { dyslexicMode: next };
    }),
```

- [ ] **Step 4: Wire up `toggleBionicReading`**

Replace the stub:

```typescript
// Find:
  // TODO: stub implementation — wire up bionic reading toggle (persist to localStorage, update state)
  toggleBionicReading: () => {},

// Replace with:
  toggleBionicReading: () =>
    set((state) => {
      const next = !state.bionicReading;
      localStorage.setItem('bionicReading', String(next));
      return { bionicReading: next };
    }),
```

- [ ] **Step 5: Wire up `toggleFocusMode`**

Replace the stub:

```typescript
// Find:
  // TODO: stub implementation — wire up focus mode toggle (hide non-essential UI, persist to localStorage)
  toggleFocusMode: () => {},

// Replace with:
  toggleFocusMode: () =>
    set((state) => {
      const next = !state.focusMode;
      localStorage.setItem('focusMode', String(next));
      return { focusMode: next };
    }),
```

Note: SupportView and AgentView already conditionally hide sidebars based on `focusMode` state (`!focusMode && sidebarOpen`). No CSS class needed — the React conditional rendering handles it.

- [ ] **Step 6: Add `hydrateAccessibilityPrefs` action**

Add before the closing `});` of the slice (after `setConnectionStatus`):

```typescript
// Find:
  setConnectionStatus: (status) => set({ connectionStatus: status }),
});

// Replace with:
  setConnectionStatus: (status) => set({ connectionStatus: status }),

  hydrateAccessibilityPrefs: (prefs) =>
    set(() => {
      const dyslexicMode = prefs.dyslexicMode ?? false;
      const bionicReading = prefs.bionicReading ?? false;
      const monochromeMode = prefs.monochromeMode ?? true;
      const focusMode = prefs.focusMode ?? false;

      localStorage.setItem('dyslexicMode', String(dyslexicMode));
      localStorage.setItem('bionicReading', String(bionicReading));
      localStorage.setItem('monochromeMode', String(monochromeMode));
      localStorage.setItem('focusMode', String(focusMode));

      if (dyslexicMode) document.documentElement.classList.add('dyslexic-mode');
      else document.documentElement.classList.remove('dyslexic-mode');

      if (monochromeMode) document.documentElement.classList.add('monochrome-mode');
      else document.documentElement.classList.remove('monochrome-mode');

      return { dyslexicMode, bionicReading, monochromeMode, focusMode };
    }),
});
```

- [ ] **Step 7: Also apply classList on init for dyslexicMode**

The initial state reads from localStorage but doesn't apply the class. Add a self-invoking init block after the slice creator. However, Zustand slices don't support init hooks. Instead, add classList sync in the initial state using an IIFE pattern:

```typescript
// Find:
  dyslexicMode: localStorage.getItem('dyslexicMode') === 'true',

// Replace with:
  dyslexicMode: (() => {
    const v = localStorage.getItem('dyslexicMode') === 'true';
    if (v) document.documentElement.classList.add('dyslexic-mode');
    return v;
  })(),
```

This matches how `darkMode` works — its classList is applied elsewhere during app init.

- [ ] **Step 8: Commit**

```bash
git add client/src/store/slices/uiSlice.ts
git commit -m "feat(store): wire up a11y toggles with localStorage persistence and hydration"
```

---

### Task 5: AccessibilityMenu Component

**Files:**
- Create: `client/src/components/AccessibilityMenu.tsx`

- [ ] **Step 1: Create the component**

Create `client/src/components/AccessibilityMenu.tsx`:

```tsx
import { useState, useRef, useEffect } from 'react';
import useStore from '../store/useStore';

function ToggleSwitch({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <button
      role="switch"
      aria-checked={enabled}
      onClick={onToggle}
      className={`relative w-8 h-4 border ${
        enabled
          ? 'border-[var(--color-accent-blue)] bg-[var(--color-accent-blue)]/20'
          : 'border-[var(--color-border)] bg-transparent'
      }`}
    >
      <span
        className={`absolute top-[1px] w-3 h-3 ${
          enabled
            ? 'right-[2px] bg-[var(--color-accent-blue)]'
            : 'left-[2px] bg-[var(--color-text-muted)]'
        }`}
      />
    </button>
  );
}

export default function AccessibilityMenu() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const {
    dyslexicMode, toggleDyslexicMode,
    bionicReading, toggleBionicReading,
    monochromeMode, toggleMonochromeMode,
    focusMode, toggleFocusMode,
  } = useStore();

  const anyActive = dyslexicMode || bionicReading || monochromeMode || focusMode;

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`px-2 py-1 text-[10px] font-bold flex items-center justify-center border ${
          anyActive
            ? 'border-[var(--color-accent-blue)] text-[var(--color-accent-blue)]'
            : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
        }`}
        title="Accessibility Options"
        aria-expanded={open}
        aria-haspopup="true"
      >
        {/* Accessibility human figure icon */}
        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <circle cx="12" cy="4" r="2" />
          <path d="M12 8v8" />
          <path d="M6 10l6 2 6-2" />
          <path d="M9 22l3-6 3 6" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-56 border border-[var(--color-border)] bg-[var(--color-bg-surface)] z-50 p-3">
          <p className="text-[9px] font-bold uppercase tracking-widest opacity-60 mb-3 pb-2 border-b border-[var(--color-border)]">
            Accessibility
          </p>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px]">Dyslexic Font</span>
              <ToggleSwitch enabled={dyslexicMode} onToggle={toggleDyslexicMode} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px]">Bionic Reading</span>
              <ToggleSwitch enabled={bionicReading} onToggle={toggleBionicReading} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px]">Monochrome</span>
              <ToggleSwitch enabled={monochromeMode} onToggle={toggleMonochromeMode} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px]">Focus Mode</span>
              <ToggleSwitch enabled={focusMode} onToggle={toggleFocusMode} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/AccessibilityMenu.tsx
git commit -m "feat: create AccessibilityMenu popover component"
```

---

### Task 6: NavToolbar Integration

**Files:**
- Modify: `client/src/components/NavToolbar.tsx`

- [ ] **Step 1: Add AccessibilityMenu to NavToolbar**

```typescript
// Find:
import LanguageSwitcher from './LanguageSwitcher';
import DarkModeToggle from './DarkModeToggle';
import NotificationToggle from './NotificationToggle';

// Replace with:
import LanguageSwitcher from './LanguageSwitcher';
import DarkModeToggle from './DarkModeToggle';
import AccessibilityMenu from './AccessibilityMenu';
import NotificationToggle from './NotificationToggle';
```

```typescript
// Find:
      <DarkModeToggle />
      {children}

// Replace with:
      <DarkModeToggle />
      <AccessibilityMenu />
      {children}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/NavToolbar.tsx
git commit -m "feat: add AccessibilityMenu to NavToolbar"
```

---

### Task 7: Expand BionicText to KB Articles and Canned Responses

**Files:**
- Modify: `client/src/components/admin/AdminKnowledgeBase.tsx:355-362`
- Modify: `client/src/components/admin/AdminCannedResponses.tsx:290-295`

- [ ] **Step 1: Add BionicText to AdminKnowledgeBase preview**

In `client/src/components/admin/AdminKnowledgeBase.tsx`, add the import at the top:

```typescript
import BionicText from '../BionicText';
import useStore from '../../store/useStore';
```

Add inside the component function (near other state declarations):

```typescript
const { bionicReading } = useStore();
```

Find the article preview body rendering (around line 358-361):

```typescript
// Find:
    <div className="text-sm whitespace-pre-wrap text-[var(--color-text-secondary)] max-h-96 overflow-y-auto font-mono leading-relaxed">
      {a.body}
    </div>

// Replace with:
    <div className="text-sm whitespace-pre-wrap text-[var(--color-text-secondary)] max-h-96 overflow-y-auto font-mono leading-relaxed">
      {bionicReading ? <BionicText text={a.body} /> : a.body}
    </div>
```

- [ ] **Step 2: Add BionicText to AdminCannedResponses preview**

In `client/src/components/admin/AdminCannedResponses.tsx`, add the import at the top:

```typescript
import BionicText from '../BionicText';
import useStore from '../../store/useStore';
```

Add inside the component function (near other state declarations):

```typescript
const { bionicReading } = useStore();
```

Find the canned response body preview (around line 293-294):

```typescript
// Find:
    <p className="text-sm whitespace-pre-wrap opacity-80">{r.body}</p>

// Replace with:
    <p className="text-sm whitespace-pre-wrap opacity-80">
      {bionicReading ? <BionicText text={r.body} /> : r.body}
    </p>
```

- [ ] **Step 3: Commit**

```bash
git add client/src/components/admin/AdminKnowledgeBase.tsx client/src/components/admin/AdminCannedResponses.tsx
git commit -m "feat: expand BionicText to KB article and canned response previews"
```

---

### Task 8: Server — tRPC Mutation for Saving Prefs

**Files:**
- Modify: `server/trpc/routers/user.ts`

- [ ] **Step 1: Add the mutation**

In `server/trpc/routers/user.ts`, add the import for `users` table if not already imported (it is — `users` is imported from `../../db/schema.js`).

Add a new procedure to the router (before the closing `});`):

```typescript
  updateAccessibilityPrefs: protectedProcedure
    .input(
      z.object({
        dyslexicMode: z.boolean().optional(),
        bionicReading: z.boolean().optional(),
        monochromeMode: z.boolean().optional(),
        focusMode: z.boolean().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user.id;

      // Fetch current prefs to merge (not replace)
      const [row] = await db
        .select({ accessibilityPrefs: users.accessibilityPrefs })
        .from(users)
        .where(eq(users.id, userId));

      const current = (row?.accessibilityPrefs as Record<string, boolean>) ?? {};
      const merged = { ...current, ...input };

      await db
        .update(users)
        .set({ accessibilityPrefs: merged, updatedAt: new Date().toISOString() })
        .where(eq(users.id, userId));

      return { success: true };
    }),
```

- [ ] **Step 2: Commit**

```bash
git add server/trpc/routers/user.ts
git commit -m "feat(trpc): add updateAccessibilityPrefs mutation"
```

---

### Task 9: Server — Include Prefs in Login Response

**Files:**
- Modify: `server/routes/auth.ts`

- [ ] **Step 1: Add accessibilityPrefs to login responses**

In `server/routes/auth.ts`, find both places where the login response builds the user object (local login ~line 318 and demo login ~line 450). In both places:

```typescript
// Find (appears twice):
  user: {
    id: user.id,
    name: user.name,
    lang: user.lang,
    isPlatformOperator: user.isPlatformOperator,
  },

// Replace with (in both locations):
  user: {
    id: user.id,
    name: user.name,
    lang: user.lang,
    isPlatformOperator: user.isPlatformOperator,
    accessibilityPrefs: user.accessibilityPrefs ?? {},
  },
```

The `user` variable here comes from a DB query — since we added the column in Task 1, `user.accessibilityPrefs` will be available. The `?? {}` fallback handles rows that haven't been updated yet.

Also check if there are other login paths (SSO, switch-partner, enter-partner) that build user objects — add `accessibilityPrefs` to those as well.

- [ ] **Step 2: Commit**

```bash
git add server/routes/auth.ts
git commit -m "feat(auth): include accessibilityPrefs in login response"
```

---

### Task 10: Client — Hydrate Prefs on Login

**Files:**
- Modify: `client/src/store/slices/authSlice.ts`

- [ ] **Step 1: Hydrate a11y prefs in setUser**

In `client/src/store/slices/authSlice.ts`, modify the `setUser` action to hydrate accessibility prefs when a user logs in:

```typescript
// Find:
  setUser: (user) => {
    if (user) localStorage.setItem('user', JSON.stringify(user));
    else localStorage.removeItem('user');
    set({ user });
  },

// Replace with:
  setUser: (user) => {
    if (user) {
      localStorage.setItem('user', JSON.stringify(user));
      // Hydrate a11y prefs from server when user logs in
      if (user.accessibilityPrefs) {
        const store = useStore.getState();
        store.hydrateAccessibilityPrefs(user.accessibilityPrefs);
      }
    } else {
      localStorage.removeItem('user');
    }
    set({ user });
  },
```

This requires importing `useStore`. Since `authSlice` is a slice creator that gets composed into `useStore`, we need to import it carefully to avoid circular deps. Use a lazy import:

```typescript
// Add at the top of authSlice.ts (after existing imports):
import type { StoreState } from '../../types';

// Then in setUser, replace the direct useStore.getState() call with:
// Access the store via the set/get functions available to the slice
```

Actually, Zustand slice creators receive `(set, get)` as arguments. Use `get()` to access the full store:

```typescript
// The createAuthSlice function signature already has access to get:
export const createAuthSlice: StateCreator<StoreState, [], [], AuthSlice> = (set, get) => ({
```

So the hydration becomes:

```typescript
  setUser: (user) => {
    if (user) {
      localStorage.setItem('user', JSON.stringify(user));
      if (user.accessibilityPrefs) {
        get().hydrateAccessibilityPrefs(user.accessibilityPrefs);
      }
    } else {
      localStorage.removeItem('user');
    }
    set({ user });
  },
```

Verify the `createAuthSlice` function already receives `get` as the second parameter. If the signature is `(set)`, change it to `(set, get)`.

- [ ] **Step 2: Commit**

```bash
git add client/src/store/slices/authSlice.ts
git commit -m "feat(auth): hydrate a11y prefs from server on login"
```

---

### Task 11: Fire-and-Forget Server Sync on Toggle

**Files:**
- Modify: `client/src/store/slices/uiSlice.ts`

- [ ] **Step 1: Add tRPC fire-and-forget calls to toggles**

Import the tRPC client at the top of `uiSlice.ts`:

```typescript
// Add after existing imports:
import { trpc } from '../../utils/trpc';
```

Then update each toggle to fire the mutation after state change. Wrap in try/catch to ensure toggle works even if the server call fails.

For `toggleDyslexicMode`:

```typescript
  toggleDyslexicMode: () =>
    set((state) => {
      const next = !state.dyslexicMode;
      localStorage.setItem('dyslexicMode', String(next));
      if (next) document.documentElement.classList.add('dyslexic-mode');
      else document.documentElement.classList.remove('dyslexic-mode');
      trpc.user.updateAccessibilityPrefs.mutate({ dyslexicMode: next }).catch(() => {});
      return { dyslexicMode: next };
    }),
```

For `toggleBionicReading`:

```typescript
  toggleBionicReading: () =>
    set((state) => {
      const next = !state.bionicReading;
      localStorage.setItem('bionicReading', String(next));
      trpc.user.updateAccessibilityPrefs.mutate({ bionicReading: next }).catch(() => {});
      return { bionicReading: next };
    }),
```

For `toggleMonochromeMode` (already implemented, add server sync):

```typescript
  toggleMonochromeMode: () =>
    set((state) => {
      const next = !state.monochromeMode;
      localStorage.setItem('monochromeMode', String(next));
      if (next) document.documentElement.classList.add('monochrome-mode');
      else document.documentElement.classList.remove('monochrome-mode');
      trpc.user.updateAccessibilityPrefs.mutate({ monochromeMode: next }).catch(() => {});
      return { monochromeMode: next };
    }),
```

For `toggleFocusMode`:

```typescript
  toggleFocusMode: () =>
    set((state) => {
      const next = !state.focusMode;
      localStorage.setItem('focusMode', String(next));
      trpc.user.updateAccessibilityPrefs.mutate({ focusMode: next }).catch(() => {});
      return { focusMode: next };
    }),
```

- [ ] **Step 2: Verify tRPC client import path**

Check that `client/src/utils/trpc.ts` exports a vanilla client (not just React hooks). The fire-and-forget pattern uses `trpc.user.updateAccessibilityPrefs.mutate()` which requires the vanilla tRPC client. If only React Query hooks are exported, create a vanilla client or use the existing one.

- [ ] **Step 3: Commit**

```bash
git add client/src/store/slices/uiSlice.ts
git commit -m "feat(store): add fire-and-forget server sync for a11y toggles"
```

---

### Task 12: Unit Tests — AccessibilityMenu

**Files:**
- Create: `client/src/components/__tests__/AccessibilityMenu.test.tsx`

- [ ] **Step 1: Write tests**

Create `client/src/components/__tests__/AccessibilityMenu.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AccessibilityMenu from '../AccessibilityMenu';

// Mock the store
const mockStore = {
  dyslexicMode: false,
  bionicReading: false,
  monochromeMode: false,
  focusMode: false,
  toggleDyslexicMode: vi.fn(),
  toggleBionicReading: vi.fn(),
  toggleMonochromeMode: vi.fn(),
  toggleFocusMode: vi.fn(),
};

vi.mock('../../store/useStore', () => ({
  default: () => mockStore,
}));

describe('AccessibilityMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStore.dyslexicMode = false;
    mockStore.bionicReading = false;
    mockStore.monochromeMode = false;
    mockStore.focusMode = false;
  });

  it('renders trigger button', () => {
    render(<AccessibilityMenu />);
    expect(screen.getByTitle('Accessibility Options')).toBeInTheDocument();
  });

  it('opens popover on click', () => {
    render(<AccessibilityMenu />);
    fireEvent.click(screen.getByTitle('Accessibility Options'));
    expect(screen.getByText('Accessibility')).toBeInTheDocument();
    expect(screen.getByText('Dyslexic Font')).toBeInTheDocument();
    expect(screen.getByText('Bionic Reading')).toBeInTheDocument();
    expect(screen.getByText('Monochrome')).toBeInTheDocument();
    expect(screen.getByText('Focus Mode')).toBeInTheDocument();
  });

  it('closes popover on second click', () => {
    render(<AccessibilityMenu />);
    const trigger = screen.getByTitle('Accessibility Options');
    fireEvent.click(trigger);
    expect(screen.getByText('Accessibility')).toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.queryByText('Accessibility')).not.toBeInTheDocument();
  });

  it('calls toggleDyslexicMode when Dyslexic Font switch is clicked', () => {
    render(<AccessibilityMenu />);
    fireEvent.click(screen.getByTitle('Accessibility Options'));
    const switches = screen.getAllByRole('switch');
    fireEvent.click(switches[0]); // Dyslexic Font is first
    expect(mockStore.toggleDyslexicMode).toHaveBeenCalledOnce();
  });

  it('calls toggleBionicReading when Bionic Reading switch is clicked', () => {
    render(<AccessibilityMenu />);
    fireEvent.click(screen.getByTitle('Accessibility Options'));
    const switches = screen.getAllByRole('switch');
    fireEvent.click(switches[1]); // Bionic Reading is second
    expect(mockStore.toggleBionicReading).toHaveBeenCalledOnce();
  });

  it('calls toggleFocusMode when Focus Mode switch is clicked', () => {
    render(<AccessibilityMenu />);
    fireEvent.click(screen.getByTitle('Accessibility Options'));
    const switches = screen.getAllByRole('switch');
    fireEvent.click(switches[3]); // Focus Mode is fourth
    expect(mockStore.toggleFocusMode).toHaveBeenCalledOnce();
  });

  it('shows accent border when any feature is active', () => {
    mockStore.dyslexicMode = true;
    render(<AccessibilityMenu />);
    const trigger = screen.getByTitle('Accessibility Options');
    expect(trigger.className).toContain('border-[var(--color-accent-blue)]');
  });

  it('shows default border when no features are active', () => {
    render(<AccessibilityMenu />);
    const trigger = screen.getByTitle('Accessibility Options');
    expect(trigger.className).toContain('border-[var(--color-border)]');
  });
});
```

- [ ] **Step 2: Run tests**

```bash
docker compose exec client npm test -- --run AccessibilityMenu
```

Expected: All 8 tests pass.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/__tests__/AccessibilityMenu.test.tsx
git commit -m "test: add unit tests for AccessibilityMenu component"
```

---

### Task 13: Visual Verification & Integration Test

- [ ] **Step 1: Start the app and verify**

```bash
docker compose up
```

Open the app in browser. Verify each feature:

1. **AccessibilityMenu popover** — Click the accessibility icon in NavToolbar. Panel opens with 4 toggles. Click outside to dismiss.
2. **Dyslexic Font** — Toggle on. Message text and content should switch from Inter to Lexend. JetBrains Mono labels/buttons should NOT change. Toggle off — reverts.
3. **Bionic Reading** — Toggle on. Chat messages should show bold word beginnings. Go to Admin → Knowledge Base → expand an article preview — body should show bionic text. Same for Admin → Canned Responses → expand a response.
4. **Focus Mode** — Toggle on in SupportView. QueueSidebar, CustomerInfoPanel, and AiCopilotSidebar should hide. Chat area expands to full width. Toggle off — sidebars return.
5. **Monochrome** — Toggle on. Full grayscale filter applies.
6. **Combined modes** — Enable dyslexic + bionic together. Lexend font with bold fixation points.
7. **Persistence** — Enable dyslexic + bionic, reload page. Both should be restored from localStorage. Log out, log in — both should be restored from server.
8. **Active indicator** — Enable any toggle. The trigger button border turns accent-blue.

- [ ] **Step 2: Check dark mode compatibility**

Toggle dark mode with each a11y feature enabled. Verify tokens resolve correctly — Lexend should still apply, bionic bold should be visible against dark backgrounds.

- [ ] **Step 3: Commit any fixes from verification**

```bash
git add -A
git commit -m "fix: address visual issues found during a11y verification"
```
