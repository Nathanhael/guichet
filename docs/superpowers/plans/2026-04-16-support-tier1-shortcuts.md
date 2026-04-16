# SupportView Tier-1 Shortcuts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 6 high-traffic keyboard shortcuts to SupportView and make the `Ctrl+K` nav badge clickable, wiring each through the existing `useKeyboardShortcuts` hook and palette command registry.

**Architecture:** Extend `useKeyboardShortcuts` with 5 new callback props (close ticket, transfer, close tab, toggle whisper, exit focus, open palette via `?`) plus `Esc` handling. SupportView passes callbacks that route through the existing `ChatWindowHandle` ref and Zustand store. Existing palette commands (`close-ticket`, `transfer-ticket`, `close-tab`, `toggle-whisper`, `toggle-focus`) gain `shortcutHint` strings so the palette doubles as a cheat sheet. `Ctrl+K` badge in `SupportNav` becomes a button that triggers the palette via a `window` custom event (`support:open-palette`) to avoid prop-drilling.

**Tech Stack:** React 19 hooks, Vitest + jsdom, TypeScript strict.

**Browser/AZERTY safety notes:**
- `Ctrl+Enter` — safe, no browser conflict.
- `Alt+T` for transfer (avoid `Ctrl+T` = Chrome new tab).
- `Alt+W` for close tab (avoid `Ctrl+W` = Chrome close browser tab). `preventDefault` on keydown stops Alt-menu activation on Windows.
- `Ctrl+/` for whisper — `e.key === '/'` returns `/` regardless of keyboard layout.
- `Esc` — only exits focus mode when palette/modals not handling it. Existing palette already handles its own Esc.
- `?` — `e.key === '?'` returns `?` on both QWERTY (Shift+/) and AZERTY (Shift+,).

---

## Task 1: Extend `useKeyboardShortcuts` options + add `Ctrl+Enter` (close ticket)

**Files:**
- Modify: `client/src/hooks/useKeyboardShortcuts.ts`
- Test: `client/src/hooks/__tests__/useKeyboardShortcuts.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `client/src/hooks/__tests__/useKeyboardShortcuts.test.ts`:

```typescript
it('calls onCloseTicket when Ctrl+Enter is pressed', () => {
  const onCloseTicket = vi.fn();
  renderHook(() =>
    useKeyboardShortcuts({
      enabled: true,
      onOpenPalette: vi.fn(),
      onFocusMessage: vi.fn(),
      onNextTab: vi.fn(),
      onPrevTab: vi.fn(),
      onToggleSidebar: vi.fn(),
      onCloseTicket,
      onTransferTicket: vi.fn(),
      onCloseTab: vi.fn(),
      onToggleWhisper: vi.fn(),
      onExitFocus: vi.fn(),
    })
  );

  const event = new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true });
  window.dispatchEvent(event);

  expect(onCloseTicket).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
docker compose exec client npm test -- useKeyboardShortcuts
```

Expected: FAIL — `onCloseTicket` missing from options type.

- [ ] **Step 3: Extend hook options and implement `Ctrl+Enter` handler**

Replace the entire `useKeyboardShortcuts.ts` file with:

```typescript
import { useEffect } from 'react';

interface UseKeyboardShortcutsOptions {
  /** Set false to disable all listeners (e.g. when palette is open) */
  enabled: boolean;
  onOpenPalette: () => void;
  onFocusMessage: () => void;
  onNextTab: () => void;
  onPrevTab: () => void;
  onToggleSidebar: () => void;
  onCloseTicket: () => void;
  onTransferTicket: () => void;
  onCloseTab: () => void;
  onToggleWhisper: () => void;
  onExitFocus: () => void;
}

/**
 * Global keyboard shortcut listener for SupportView.
 *
 * Direct shortcuts (AZERTY-safe):
 *  - Ctrl+K         → open command palette
 *  - ?              → open command palette (help)
 *  - Ctrl+ArrowDown → next chat tab
 *  - Ctrl+ArrowUp   → previous chat tab
 *  - Ctrl+B         → toggle queue sidebar
 *  - Ctrl+Enter     → close current ticket
 *  - Alt+T          → transfer ticket (avoids browser Ctrl+T)
 *  - Alt+W          → close chat tab (avoids browser Ctrl+W)
 *  - Ctrl+/         → toggle whisper mode
 *  - Esc            → exit focus mode (when nothing else consumes it)
 *  - bare /         → focus message textarea (only when NOT inside an input)
 */
export function useKeyboardShortcuts(options: UseKeyboardShortcutsOptions): void {
  const {
    enabled,
    onOpenPalette,
    onFocusMessage,
    onNextTab,
    onPrevTab,
    onToggleSidebar,
    onCloseTicket,
    onTransferTicket,
    onCloseTab,
    onToggleWhisper,
    onExitFocus,
  } = options;

  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(e: KeyboardEvent) {
      const ctrl = e.ctrlKey || e.metaKey;
      const alt = e.altKey;

      // Ctrl+K — open command palette
      if (ctrl && e.key === 'k') {
        e.preventDefault();
        onOpenPalette();
        return;
      }

      // ? — open command palette (help)
      if (e.key === '?' && !ctrl && !alt) {
        const tag = (e.target as HTMLElement)?.tagName;
        const editable = (e.target as HTMLElement)?.isContentEditable;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || editable) return;
        e.preventDefault();
        onOpenPalette();
        return;
      }

      // Ctrl+Enter — close current ticket
      if (ctrl && e.key === 'Enter') {
        e.preventDefault();
        onCloseTicket();
        return;
      }

      // Alt+T — transfer ticket
      if (alt && !ctrl && e.key.toLowerCase() === 't') {
        e.preventDefault();
        onTransferTicket();
        return;
      }

      // Alt+W — close chat tab
      if (alt && !ctrl && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        onCloseTab();
        return;
      }

      // Ctrl+/ — toggle whisper
      if (ctrl && e.key === '/') {
        e.preventDefault();
        onToggleWhisper();
        return;
      }

      // Esc — exit focus mode (palette/modals stop propagation before this fires)
      if (e.key === 'Escape' && !ctrl && !alt) {
        onExitFocus();
        return;
      }

      // Ctrl+ArrowDown — next tab
      if (ctrl && e.key === 'ArrowDown') {
        e.preventDefault();
        onNextTab();
        return;
      }

      // Ctrl+ArrowUp — previous tab
      if (ctrl && e.key === 'ArrowUp') {
        e.preventDefault();
        onPrevTab();
        return;
      }

      // Ctrl+B — toggle queue sidebar
      if (ctrl && e.key === 'b') {
        e.preventDefault();
        onToggleSidebar();
        return;
      }

      // Bare / — focus message input (only when not inside an input/textarea)
      if (e.key === '/' && !ctrl && !e.altKey && !e.shiftKey) {
        const tag = (e.target as HTMLElement)?.tagName;
        const editable = (e.target as HTMLElement)?.isContentEditable;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || editable) return;
        e.preventDefault();
        onFocusMessage();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    enabled,
    onOpenPalette,
    onFocusMessage,
    onNextTab,
    onPrevTab,
    onToggleSidebar,
    onCloseTicket,
    onTransferTicket,
    onCloseTab,
    onToggleWhisper,
    onExitFocus,
  ]);
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
docker compose exec client npm test -- useKeyboardShortcuts
```

Expected: PASS for the new Ctrl+Enter test. Existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add client/src/hooks/useKeyboardShortcuts.ts client/src/hooks/__tests__/useKeyboardShortcuts.test.ts
git commit -m "feat(support): extend useKeyboardShortcuts with Ctrl+Enter close-ticket binding"
```

---

## Task 2: Test & verify `Alt+T` (transfer) + `Alt+W` (close tab)

**Files:**
- Test: `client/src/hooks/__tests__/useKeyboardShortcuts.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to the test file:

```typescript
it('calls onTransferTicket when Alt+T is pressed', () => {
  const onTransferTicket = vi.fn();
  renderHook(() =>
    useKeyboardShortcuts({
      enabled: true,
      onOpenPalette: vi.fn(),
      onFocusMessage: vi.fn(),
      onNextTab: vi.fn(),
      onPrevTab: vi.fn(),
      onToggleSidebar: vi.fn(),
      onCloseTicket: vi.fn(),
      onTransferTicket,
      onCloseTab: vi.fn(),
      onToggleWhisper: vi.fn(),
      onExitFocus: vi.fn(),
    })
  );

  window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', altKey: true }));
  expect(onTransferTicket).toHaveBeenCalledTimes(1);
});

it('calls onCloseTab when Alt+W is pressed', () => {
  const onCloseTab = vi.fn();
  renderHook(() =>
    useKeyboardShortcuts({
      enabled: true,
      onOpenPalette: vi.fn(),
      onFocusMessage: vi.fn(),
      onNextTab: vi.fn(),
      onPrevTab: vi.fn(),
      onToggleSidebar: vi.fn(),
      onCloseTicket: vi.fn(),
      onTransferTicket: vi.fn(),
      onCloseTab,
      onToggleWhisper: vi.fn(),
      onExitFocus: vi.fn(),
    })
  );

  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', altKey: true }));
  expect(onCloseTab).toHaveBeenCalledTimes(1);
});

it('does NOT trigger Alt+T when Ctrl+Alt+T is pressed (avoid collision)', () => {
  const onTransferTicket = vi.fn();
  renderHook(() =>
    useKeyboardShortcuts({
      enabled: true,
      onOpenPalette: vi.fn(),
      onFocusMessage: vi.fn(),
      onNextTab: vi.fn(),
      onPrevTab: vi.fn(),
      onToggleSidebar: vi.fn(),
      onCloseTicket: vi.fn(),
      onTransferTicket,
      onCloseTab: vi.fn(),
      onToggleWhisper: vi.fn(),
      onExitFocus: vi.fn(),
    })
  );

  window.dispatchEvent(
    new KeyboardEvent('keydown', { key: 't', altKey: true, ctrlKey: true })
  );
  expect(onTransferTicket).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
docker compose exec client npm test -- useKeyboardShortcuts
```

Expected: All three new tests PASS (hook already implements these in Task 1).

- [ ] **Step 3: Commit**

```bash
git add client/src/hooks/__tests__/useKeyboardShortcuts.test.ts
git commit -m "test(support): cover Alt+T transfer and Alt+W close-tab shortcuts"
```

---

## Task 3: Test `Ctrl+/` (whisper), `Esc` (exit focus), `?` (palette)

**Files:**
- Test: `client/src/hooks/__tests__/useKeyboardShortcuts.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to the test file:

```typescript
it('calls onToggleWhisper when Ctrl+/ is pressed', () => {
  const onToggleWhisper = vi.fn();
  renderHook(() =>
    useKeyboardShortcuts({
      enabled: true,
      onOpenPalette: vi.fn(),
      onFocusMessage: vi.fn(),
      onNextTab: vi.fn(),
      onPrevTab: vi.fn(),
      onToggleSidebar: vi.fn(),
      onCloseTicket: vi.fn(),
      onTransferTicket: vi.fn(),
      onCloseTab: vi.fn(),
      onToggleWhisper,
      onExitFocus: vi.fn(),
    })
  );

  window.dispatchEvent(new KeyboardEvent('keydown', { key: '/', ctrlKey: true }));
  expect(onToggleWhisper).toHaveBeenCalledTimes(1);
});

it('calls onExitFocus when Escape is pressed', () => {
  const onExitFocus = vi.fn();
  renderHook(() =>
    useKeyboardShortcuts({
      enabled: true,
      onOpenPalette: vi.fn(),
      onFocusMessage: vi.fn(),
      onNextTab: vi.fn(),
      onPrevTab: vi.fn(),
      onToggleSidebar: vi.fn(),
      onCloseTicket: vi.fn(),
      onTransferTicket: vi.fn(),
      onCloseTab: vi.fn(),
      onToggleWhisper: vi.fn(),
      onExitFocus,
    })
  );

  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  expect(onExitFocus).toHaveBeenCalledTimes(1);
});

it('calls onOpenPalette when ? is pressed outside an input', () => {
  const onOpenPalette = vi.fn();
  renderHook(() =>
    useKeyboardShortcuts({
      enabled: true,
      onOpenPalette,
      onFocusMessage: vi.fn(),
      onNextTab: vi.fn(),
      onPrevTab: vi.fn(),
      onToggleSidebar: vi.fn(),
      onCloseTicket: vi.fn(),
      onTransferTicket: vi.fn(),
      onCloseTab: vi.fn(),
      onToggleWhisper: vi.fn(),
      onExitFocus: vi.fn(),
    })
  );

  const event = new KeyboardEvent('keydown', { key: '?' });
  Object.defineProperty(event, 'target', { value: document.body });
  window.dispatchEvent(event);
  expect(onOpenPalette).toHaveBeenCalledTimes(1);
});

it('does NOT open palette when ? is pressed inside a textarea', () => {
  const onOpenPalette = vi.fn();
  renderHook(() =>
    useKeyboardShortcuts({
      enabled: true,
      onOpenPalette,
      onFocusMessage: vi.fn(),
      onNextTab: vi.fn(),
      onPrevTab: vi.fn(),
      onToggleSidebar: vi.fn(),
      onCloseTicket: vi.fn(),
      onTransferTicket: vi.fn(),
      onCloseTab: vi.fn(),
      onToggleWhisper: vi.fn(),
      onExitFocus: vi.fn(),
    })
  );

  const textarea = document.createElement('textarea');
  document.body.appendChild(textarea);
  const event = new KeyboardEvent('keydown', { key: '?' });
  Object.defineProperty(event, 'target', { value: textarea });
  window.dispatchEvent(event);
  expect(onOpenPalette).not.toHaveBeenCalled();
  textarea.remove();
});
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
docker compose exec client npm test -- useKeyboardShortcuts
```

Expected: All four tests PASS.

- [ ] **Step 3: Commit**

```bash
git add client/src/hooks/__tests__/useKeyboardShortcuts.test.ts
git commit -m "test(support): cover Ctrl+/ whisper, Esc exit-focus, and ? palette shortcuts"
```

---

## Task 4: Wire SupportView callbacks + shortcut hints on existing commands

**Files:**
- Modify: `client/src/views/SupportView.tsx`

- [ ] **Step 1: Add shortcut hints to existing palette commands**

In `client/src/views/SupportView.tsx` (the `commands` array around line 272), update the command entries so each one carries a `shortcutHint` that matches the hook. The array already has `next-tab`, `prev-tab`, `toggle-sidebar` with hints. Add hints to the remaining matching entries:

```typescript
{ id: 'toggle-whisper', labelKey: 'cmd_toggle_whisper', groupKey: 'cmd_group_actions', shortcutHint: 'Ctrl+/', execute: () => chatWindowRef.current?.toggleWhisper(), enabled: !!activeTab, keywords: ['whisper', 'internal', 'private'] },
{ id: 'transfer-ticket', labelKey: 'cmd_transfer_ticket', groupKey: 'cmd_group_actions', shortcutHint: 'Alt+T', execute: () => chatWindowRef.current?.openTransferMenu(), enabled: !!activeTab, keywords: ['transfer', 'hand off', 'department'] },
{ id: 'close-tab', labelKey: 'cmd_close_tab', groupKey: 'cmd_group_actions', shortcutHint: 'Alt+W', execute: () => { if (activeTab) closeTab(activeTab); }, enabled: !!activeTab, keywords: ['close', 'tab'] },
{ id: 'close-ticket', labelKey: 'cmd_close_ticket', groupKey: 'cmd_group_actions', shortcutHint: 'Ctrl+Enter', execute: () => chatWindowRef.current?.triggerCloseTicket(), enabled: !!activeTab, keywords: ['resolve', 'close', 'end'] },
{ id: 'toggle-focus', labelKey: 'cmd_toggle_focus', groupKey: 'cmd_group_view', shortcutHint: 'Esc', execute: () => { const s = useStore.getState(); s.setViewMode(s.viewMode === 'focus' ? 'normal' : 'focus'); }, keywords: ['focus', 'distraction'] },
```

- [ ] **Step 2: Wire the hook call with new callbacks**

Find the existing `useKeyboardShortcuts({ ... })` invocation in SupportView and extend it:

```typescript
useKeyboardShortcuts({
  enabled: !paletteOpen,
  onOpenPalette: () => setPaletteOpen(true),
  onFocusMessage: () => chatWindowRef.current?.focusTextarea(),
  onNextTab: () => navigateTab(1),
  onPrevTab: () => navigateTab(-1),
  onToggleSidebar: toggleSidebar,
  onCloseTicket: () => {
    if (activeTab) chatWindowRef.current?.triggerCloseTicket();
  },
  onTransferTicket: () => {
    if (activeTab) chatWindowRef.current?.openTransferMenu();
  },
  onCloseTab: () => {
    if (activeTab) closeTab(activeTab);
  },
  onToggleWhisper: () => {
    if (activeTab) chatWindowRef.current?.toggleWhisper();
  },
  onExitFocus: () => {
    const s = useStore.getState();
    if (s.viewMode === 'focus') s.setViewMode('normal');
  },
});
```

(Leave `enabled: !paletteOpen` as it was; only add the new callbacks.)

- [ ] **Step 3: Run typecheck + tests to verify**

```bash
powershell -File scripts/ci.ps1 -Skip e2e
```

Expected: typecheck clean, all vitest suites green.

- [ ] **Step 4: Commit**

```bash
git add client/src/views/SupportView.tsx
git commit -m "feat(support): wire Tier-1 keyboard shortcuts through ChatWindowHandle"
```

---

## Task 5: Make the `Ctrl+K` nav badge clickable via a window event

**Files:**
- Modify: `client/src/components/support/SupportNav.tsx`
- Modify: `client/src/views/SupportView.tsx`
- Test: `client/src/components/support/__tests__/SupportNav.test.tsx` (create if absent)

- [ ] **Step 1: Write the failing test**

Create or extend `client/src/components/support/__tests__/SupportNav.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SupportNav from '../SupportNav';

describe('SupportNav — Ctrl+K badge', () => {
  it('dispatches the support:open-palette window event when clicked', async () => {
    const handler = vi.fn();
    window.addEventListener('support:open-palette', handler);
    render(<SupportNav />);

    await userEvent.click(screen.getByRole('button', { name: /command palette/i }));

    expect(handler).toHaveBeenCalledTimes(1);
    window.removeEventListener('support:open-palette', handler);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
docker compose exec client npm test -- SupportNav
```

Expected: FAIL — badge is currently a `<kbd>`, not a button.

- [ ] **Step 3: Convert `<kbd>` to a button that dispatches the event**

In `client/src/components/support/SupportNav.tsx` replace the existing `<kbd>` with:

```tsx
{!focusMode && (
  <button
    type="button"
    onClick={() => window.dispatchEvent(new CustomEvent('support:open-palette'))}
    className="text-[9px] font-mono px-1.5 py-0.5 border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-text-muted)] select-none cursor-pointer bg-transparent"
    title={t('cmd_palette_title') || 'Command Palette'}
    aria-label={t('cmd_palette_title') || 'Command Palette'}
  >
    Ctrl+K
  </button>
)}
```

- [ ] **Step 4: Add the window listener in SupportView**

In `client/src/views/SupportView.tsx`, add a `useEffect` near the existing palette state:

```typescript
useEffect(() => {
  function openPalette() {
    setPaletteOpen(true);
  }
  window.addEventListener('support:open-palette', openPalette);
  return () => window.removeEventListener('support:open-palette', openPalette);
}, []);
```

- [ ] **Step 5: Run tests + typecheck**

```bash
powershell -File scripts/ci.ps1 -Skip e2e
```

Expected: typecheck clean, SupportNav test PASS, all other suites green.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/support/SupportNav.tsx client/src/views/SupportView.tsx client/src/components/support/__tests__/SupportNav.test.tsx
git commit -m "feat(support): make Ctrl+K nav badge clickable to open command palette"
```

---

## Task 6: E2E spec — palette shortcut hints visible + Ctrl+Enter closes ticket

**Files:**
- Create: `testing/e2e/support-shortcuts.spec.ts`

- [ ] **Step 1: Write the failing E2E spec**

Create `testing/e2e/support-shortcuts.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';
import { loginAsSupport, openFirstTicket } from './helpers';

test.describe('SupportView keyboard shortcuts', () => {
  test('Ctrl+K opens the palette and shortcut hints are visible', async ({ page }) => {
    await loginAsSupport(page);

    await page.keyboard.press('Control+K');
    await expect(page.getByRole('dialog', { name: /command palette/i })).toBeVisible();

    // Hint column should display the new bindings
    await expect(page.getByText('Ctrl+Enter')).toBeVisible();
    await expect(page.getByText('Alt+T')).toBeVisible();
    await expect(page.getByText('Alt+W')).toBeVisible();
    await expect(page.getByText('Ctrl+/')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: /command palette/i })).toBeHidden();
  });

  test('Ctrl+Enter triggers close-ticket confirmation when a ticket is open', async ({ page }) => {
    await loginAsSupport(page);
    await openFirstTicket(page);

    await page.keyboard.press('Control+Enter');

    // triggerCloseTicket opens the confirm modal, not an immediate close.
    await expect(page.getByRole('dialog', { name: /close ticket/i })).toBeVisible();
  });
});
```

- [ ] **Step 2: Run the E2E spec to verify it passes**

```bash
powershell -File scripts/ci.ps1
```

Expected: all CI steps PASS including the new E2E spec.

- [ ] **Step 3: Commit**

```bash
git add testing/e2e/support-shortcuts.spec.ts
git commit -m "test(e2e): verify Tier-1 shortcuts and palette hint visibility"
```

---

## Task 7: Update the CHANGELOG

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add an entry under an `Unreleased` heading (create the heading if missing)**

```markdown
## [Unreleased]

### Added
- SupportView Tier-1 keyboard shortcuts: `Ctrl+Enter` (close ticket), `Alt+T` (transfer),
  `Alt+W` (close tab), `Ctrl+/` (toggle whisper), `Esc` (exit focus mode), `?` (open palette).
- `Ctrl+K` nav badge in SupportView is now a button; clicking it opens the command palette.
- Palette command hints column now shows bindings for whisper, transfer, close-tab,
  close-ticket, and focus-mode toggles.
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): note SupportView Tier-1 shortcut additions"
```

---

## Self-review

**Spec coverage:** Tier-1 (Ctrl+Enter, Alt+T, Alt+W, Esc, Ctrl+/) + `?` palette shortcut + clickable badge — all covered by Tasks 1–6.

**Placeholder scan:** No TBDs. Every step has runnable code or commands.

**Type consistency:** Callback names (`onCloseTicket`, `onTransferTicket`, `onCloseTab`, `onToggleWhisper`, `onExitFocus`, `onOpenPalette`) identical across hook signature, tests, and SupportView wiring.

**Browser safety:** `Alt+T` and `Alt+W` chosen over `Ctrl+T` / `Ctrl+W` to avoid browser conflicts. `Esc` only fires when palette is closed (palette owns its own Escape handler).

**Anti-goal:** No dedicated cheat-sheet modal — palette's `shortcutHint` column is the single source of truth.
