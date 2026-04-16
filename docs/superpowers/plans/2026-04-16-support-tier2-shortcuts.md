# SupportView Tier-2 Shortcuts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Layer 8 new SupportView shortcuts on top of the Tier-1 set: `Ctrl+1..9` (tab jump), `Ctrl+F` (message search), `Ctrl+L` + `Alt+L` (label picker), `Ctrl+J` + `Alt+J` (canned responses), `Ctrl+Shift+A` (toggle AI copilot), `Ctrl+.` (open status picker).

**Architecture:** Extend `useKeyboardShortcuts` with 6 new callbacks. SupportView dispatches either (a) direct Zustand actions or (b) `window` CustomEvents consumed by the components that own the picker state (`ChatHeader` for labels, `ComposeArea` for canned, `ChatWindow` for search, `StatusPicker` for status). Event names: `support:open-label-picker`, `support:open-canned-picker`, `support:open-search`, `support:open-status-picker`. This avoids prop-drilling and matches the `support:open-palette` pattern shipped in Tier-1.

**Tech Stack:** React 19, Vitest + jsdom, Playwright.

**Browser/AZERTY safety notes:**
- `Ctrl+1..9` — steals browser "switch to tab N". Accepted pattern (Slack, Discord). Disabled when palette open.
- `Ctrl+F` — steals browser Find. Accepted pattern (Gmail, GitHub).
- `Ctrl+L` — steals URL-bar focus. Dual-bound with `Alt+L` as muscle-memory fallback.
- `Ctrl+J` — steals Downloads. Dual-bound with `Alt+J`.
- `Ctrl+Shift+A` — free on all major browsers.
- `Ctrl+.` — Outlook convention, no browser conflict.
- All letter bindings use `e.key.toLowerCase()` to stay AZERTY-safe.
- `Ctrl+1..9`: use `e.key >= '1' && e.key <= '9'` (digit keys are layout-stable).

---

## Task 1: Extend `useKeyboardShortcuts` with Tier-2 bindings

**Files:**
- Modify: `client/src/hooks/useKeyboardShortcuts.ts`
- Test: `client/src/hooks/__tests__/useKeyboardShortcuts.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `client/src/hooks/__tests__/useKeyboardShortcuts.test.ts`. Also update the shared `handlers` object at the top of the `describe` block to include all 6 new `vi.fn()` entries so existing tests keep compiling.

Update the shared handlers:

```typescript
  const handlers = {
    onOpenPalette: vi.fn(),
    onFocusMessage: vi.fn(),
    onNextTab: vi.fn(),
    onPrevTab: vi.fn(),
    onToggleSidebar: vi.fn(),
    onCloseTicket: vi.fn(),
    onTransferTicket: vi.fn(),
    onCloseTab: vi.fn(),
    onToggleWhisper: vi.fn(),
    onExitFocus: vi.fn(),
    onJumpToTab: vi.fn(),
    onOpenSearch: vi.fn(),
    onOpenLabelPicker: vi.fn(),
    onOpenCannedPicker: vi.fn(),
    onToggleAiCopilot: vi.fn(),
    onOpenStatusPicker: vi.fn(),
  };
```

Append new tests:

```typescript
  it('Ctrl+1 fires onJumpToTab with 1', () => {
    renderHook(() => useKeyboardShortcuts({ enabled: true, ...handlers }));
    fire('1', { ctrlKey: true });
    expect(handlers.onJumpToTab).toHaveBeenCalledWith(1);
  });

  it('Ctrl+9 fires onJumpToTab with 9', () => {
    renderHook(() => useKeyboardShortcuts({ enabled: true, ...handlers }));
    fire('9', { ctrlKey: true });
    expect(handlers.onJumpToTab).toHaveBeenCalledWith(9);
  });

  it('Ctrl+0 does NOT fire onJumpToTab', () => {
    renderHook(() => useKeyboardShortcuts({ enabled: true, ...handlers }));
    fire('0', { ctrlKey: true });
    expect(handlers.onJumpToTab).not.toHaveBeenCalled();
  });

  it('Ctrl+F fires onOpenSearch', () => {
    renderHook(() => useKeyboardShortcuts({ enabled: true, ...handlers }));
    fire('f', { ctrlKey: true });
    expect(handlers.onOpenSearch).toHaveBeenCalledOnce();
  });

  it('Ctrl+L fires onOpenLabelPicker', () => {
    renderHook(() => useKeyboardShortcuts({ enabled: true, ...handlers }));
    fire('l', { ctrlKey: true });
    expect(handlers.onOpenLabelPicker).toHaveBeenCalledOnce();
  });

  it('Alt+L also fires onOpenLabelPicker (AZERTY/Chrome-safe fallback)', () => {
    renderHook(() => useKeyboardShortcuts({ enabled: true, ...handlers }));
    fire('l', { altKey: true });
    expect(handlers.onOpenLabelPicker).toHaveBeenCalledOnce();
  });

  it('Ctrl+J fires onOpenCannedPicker', () => {
    renderHook(() => useKeyboardShortcuts({ enabled: true, ...handlers }));
    fire('j', { ctrlKey: true });
    expect(handlers.onOpenCannedPicker).toHaveBeenCalledOnce();
  });

  it('Alt+J also fires onOpenCannedPicker', () => {
    renderHook(() => useKeyboardShortcuts({ enabled: true, ...handlers }));
    fire('j', { altKey: true });
    expect(handlers.onOpenCannedPicker).toHaveBeenCalledOnce();
  });

  it('Ctrl+Shift+A fires onToggleAiCopilot', () => {
    renderHook(() => useKeyboardShortcuts({ enabled: true, ...handlers }));
    fire('a', { ctrlKey: true, shiftKey: true });
    expect(handlers.onToggleAiCopilot).toHaveBeenCalledOnce();
  });

  it('Ctrl+A without Shift does NOT fire onToggleAiCopilot (preserve select-all)', () => {
    renderHook(() => useKeyboardShortcuts({ enabled: true, ...handlers }));
    fire('a', { ctrlKey: true });
    expect(handlers.onToggleAiCopilot).not.toHaveBeenCalled();
  });

  it('Ctrl+. fires onOpenStatusPicker', () => {
    renderHook(() => useKeyboardShortcuts({ enabled: true, ...handlers }));
    fire('.', { ctrlKey: true });
    expect(handlers.onOpenStatusPicker).toHaveBeenCalledOnce();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
docker compose run --rm -T client npm test -- useKeyboardShortcuts --run
```

Expected: FAIL — 6 new handler fields not in `UseKeyboardShortcutsOptions` type.

- [ ] **Step 3: Extend the hook with the new options and bindings**

Replace `client/src/hooks/useKeyboardShortcuts.ts` with:

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
  onJumpToTab: (n: number) => void;
  onOpenSearch: () => void;
  onOpenLabelPicker: () => void;
  onOpenCannedPicker: () => void;
  onToggleAiCopilot: () => void;
  onOpenStatusPicker: () => void;
}

/**
 * Global keyboard shortcut listener for SupportView.
 *
 * Tier-1 (AZERTY-safe):
 *  - Ctrl+K         → open command palette
 *  - ?              → open command palette (help)
 *  - Ctrl+ArrowDown → next chat tab
 *  - Ctrl+ArrowUp   → previous chat tab
 *  - Ctrl+B         → toggle queue sidebar
 *  - Ctrl+Enter     → close current ticket
 *  - Alt+T          → transfer ticket
 *  - Alt+W          → close chat tab
 *  - Ctrl+/         → toggle whisper
 *  - Esc            → exit focus mode
 *  - bare /         → focus message textarea
 *
 * Tier-2:
 *  - Ctrl+1..9      → jump to chat tab N (steals browser tab switch)
 *  - Ctrl+F         → open message search (steals browser Find)
 *  - Ctrl+L / Alt+L → open label picker
 *  - Ctrl+J / Alt+J → open canned response picker
 *  - Ctrl+Shift+A   → toggle AI copilot sidebar
 *  - Ctrl+.         → open status picker
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
    onJumpToTab,
    onOpenSearch,
    onOpenLabelPicker,
    onOpenCannedPicker,
    onToggleAiCopilot,
    onOpenStatusPicker,
  } = options;

  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(e: KeyboardEvent) {
      const ctrl = e.ctrlKey || e.metaKey;
      const alt = e.altKey;
      const shift = e.shiftKey;

      // Ctrl+K — open command palette
      if (ctrl && !shift && e.key === 'k') {
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

      // Ctrl+Shift+A — toggle AI copilot (checked before plain Ctrl+letter)
      if (ctrl && shift && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        onToggleAiCopilot();
        return;
      }

      // Ctrl+Enter — close ticket
      if (ctrl && e.key === 'Enter') {
        e.preventDefault();
        onCloseTicket();
        return;
      }

      // Ctrl+1..9 — jump to tab N
      if (ctrl && !alt && !shift && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        onJumpToTab(Number(e.key));
        return;
      }

      // Ctrl+F — open message search
      if (ctrl && !shift && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        onOpenSearch();
        return;
      }

      // Ctrl+L or Alt+L — open label picker
      if ((ctrl || alt) && !(ctrl && alt) && !shift && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        onOpenLabelPicker();
        return;
      }

      // Ctrl+J or Alt+J — open canned response picker
      if ((ctrl || alt) && !(ctrl && alt) && !shift && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        onOpenCannedPicker();
        return;
      }

      // Ctrl+. — open status picker
      if (ctrl && !shift && e.key === '.') {
        e.preventDefault();
        onOpenStatusPicker();
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

      // Esc — exit focus mode
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

      // Bare / — focus message input
      if (e.key === '/' && !ctrl && !alt && !shift) {
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
    onJumpToTab,
    onOpenSearch,
    onOpenLabelPicker,
    onOpenCannedPicker,
    onToggleAiCopilot,
    onOpenStatusPicker,
  ]);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
docker compose run --rm -T client npm test -- useKeyboardShortcuts --run
```

Expected: all tests PASS (27 total — 18 prior + 9 new assertions across the 11 new `it` blocks listed above; some of the new cases contain only one assertion each).

- [ ] **Step 5: Commit**

```bash
git add client/src/hooks/useKeyboardShortcuts.ts client/src/hooks/__tests__/useKeyboardShortcuts.test.ts
git commit -m "feat(support): add Tier-2 keyboard shortcut bindings to useKeyboardShortcuts"
```

---

## Task 2: Make `ChatHeader` listen for `support:open-label-picker`

**Files:**
- Modify: `client/src/components/chat/ChatHeader.tsx`

- [ ] **Step 1: Add a window-event listener that opens the label picker**

In `ChatHeader.tsx`, locate the existing `useState<boolean>(false)` for `showLabelPicker` (around line 70) and add an effect right after the existing `useEffect` block that handles outside-click dismissal (around line 96).

Add:

```tsx
  // Global shortcut: Ctrl+L / Alt+L dispatches this event on SupportView.
  useEffect(() => {
    function open() {
      setShowLabelPicker(true);
    }
    window.addEventListener('support:open-label-picker', open);
    return () => window.removeEventListener('support:open-label-picker', open);
  }, []);
```

Make sure `useEffect` is already imported at the top of the file. If not, add it to the React import.

- [ ] **Step 2: Verify no regressions**

```bash
docker compose run --rm -T client npm test -- --run
```

Expected: all existing tests still pass.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/chat/ChatHeader.tsx
git commit -m "feat(chat): ChatHeader opens label picker on support:open-label-picker event"
```

---

## Task 3: Make `ComposeArea` listen for `support:open-canned-picker`

**Files:**
- Modify: `client/src/components/chat/ComposeArea.tsx`

- [ ] **Step 1: Add a window-event listener**

In `ComposeArea.tsx`, locate the existing `useState` for `showCannedPicker` (around line 80). Add an effect near the other effects that toggle this state (around line 167):

```tsx
  // Global shortcut: Ctrl+J / Alt+J dispatches this event on SupportView.
  useEffect(() => {
    function open() {
      setShowCannedPicker(true);
    }
    window.addEventListener('support:open-canned-picker', open);
    return () => window.removeEventListener('support:open-canned-picker', open);
  }, []);
```

Ensure `useEffect` is imported at the top of the file.

- [ ] **Step 2: Run the client test suite**

```bash
docker compose run --rm -T client npm test -- --run
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/chat/ComposeArea.tsx
git commit -m "feat(chat): ComposeArea opens canned picker on support:open-canned-picker event"
```

---

## Task 4: Make `ChatWindow` listen for `support:open-search`

**Files:**
- Modify: `client/src/components/ChatWindow.tsx`

- [ ] **Step 1: Add a window-event listener**

In `ChatWindow.tsx`, near the existing `searchOpen` state declaration (around line 46), add:

```tsx
  // Global shortcut: Ctrl+F dispatches this event on SupportView.
  useEffect(() => {
    function open() {
      setSearchOpen(true);
    }
    window.addEventListener('support:open-search', open);
    return () => window.removeEventListener('support:open-search', open);
  }, []);
```

`useEffect` is already imported in ChatWindow.tsx (see line 1). No import change needed.

- [ ] **Step 2: Run the client test suite**

```bash
docker compose run --rm -T client npm test -- --run
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/ChatWindow.tsx
git commit -m "feat(chat): ChatWindow opens message search on support:open-search event"
```

---

## Task 5: Make `StatusPicker` listen for `support:open-status-picker`

**Files:**
- Modify: `client/src/components/StatusPicker.tsx`

- [ ] **Step 1: Add a window-event listener**

In `StatusPicker.tsx`, near the existing `useState<boolean>` for `open` (around line 25), add an effect:

```tsx
  useEffect(() => {
    function openPicker() {
      setOpen(true);
    }
    window.addEventListener('support:open-status-picker', openPicker);
    return () => window.removeEventListener('support:open-status-picker', openPicker);
  }, []);
```

If `useEffect` isn't imported at the top of `StatusPicker.tsx`, add it to the React import.

- [ ] **Step 2: Run the client test suite**

```bash
docker compose run --rm -T client npm test -- --run
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/StatusPicker.tsx
git commit -m "feat(support): StatusPicker opens on support:open-status-picker event"
```

---

## Task 6: Wire SupportView callbacks + palette commands + hints

**Files:**
- Modify: `client/src/views/SupportView.tsx`

- [ ] **Step 1: Add a `jumpToTab` helper and 9 palette commands**

Just below the existing `navigateTab` declaration (around line 265), add:

```typescript
const jumpToTab = useCallback((n: number) => {
  const idx = n - 1;
  if (idx < 0 || idx >= openTabTickets.length) return;
  setActiveTab(openTabTickets[idx].id);
}, [openTabTickets]);
```

- [ ] **Step 2: Add new palette commands with shortcut hints**

Inside the `commands` `useMemo` array, add these entries after the existing navigation group (immediately below `search-tickets`):

```typescript
{ id: 'jump-to-tab-1', labelKey: 'cmd_jump_to_tab_1', groupKey: 'cmd_group_navigation', shortcutHint: 'Ctrl+1', execute: () => jumpToTab(1), enabled: openTabTickets.length >= 1, keywords: ['tab', '1'] },
{ id: 'jump-to-tab-2', labelKey: 'cmd_jump_to_tab_2', groupKey: 'cmd_group_navigation', shortcutHint: 'Ctrl+2', execute: () => jumpToTab(2), enabled: openTabTickets.length >= 2, keywords: ['tab', '2'] },
{ id: 'jump-to-tab-3', labelKey: 'cmd_jump_to_tab_3', groupKey: 'cmd_group_navigation', shortcutHint: 'Ctrl+3', execute: () => jumpToTab(3), enabled: openTabTickets.length >= 3, keywords: ['tab', '3'] },
{ id: 'search-messages', labelKey: 'cmd_search_messages', groupKey: 'cmd_group_navigation', shortcutHint: 'Ctrl+F', execute: () => window.dispatchEvent(new CustomEvent('support:open-search')), enabled: !!activeTab, keywords: ['find', 'search', 'messages'] },
```

Add in the `cmd_group_actions` block (near the existing `close-ticket` entry):

```typescript
{ id: 'open-label-picker', labelKey: 'cmd_open_label_picker', groupKey: 'cmd_group_actions', shortcutHint: 'Ctrl+L', execute: () => window.dispatchEvent(new CustomEvent('support:open-label-picker')), enabled: !!activeTab, keywords: ['label', 'tag'] },
{ id: 'open-canned', labelKey: 'cmd_open_canned', groupKey: 'cmd_group_actions', shortcutHint: 'Ctrl+J', execute: () => window.dispatchEvent(new CustomEvent('support:open-canned-picker')), enabled: !!activeTab, keywords: ['canned', 'snippet', 'template'] },
```

Replace the existing `toggle-sidebar-right` entry with:

```typescript
{ id: 'toggle-sidebar-right', labelKey: 'cmd_toggle_sidebar_right', groupKey: 'cmd_group_view', shortcutHint: 'Ctrl+Shift+A', execute: () => useStore.getState().toggleRightSidebar(), keywords: ['sidebar', 'context', 'panel', 'copilot', 'info', 'ai'] },
```

Add in the `cmd_group_status` block:

```typescript
{ id: 'open-status-picker', labelKey: 'cmd_open_status_picker', groupKey: 'cmd_group_status', shortcutHint: 'Ctrl+.', execute: () => window.dispatchEvent(new CustomEvent('support:open-status-picker')), keywords: ['status', 'online', 'away'] },
```

Also update the deps array of the `commands` `useMemo` to include `jumpToTab`:

```typescript
], [activeTab, openTabTickets, navigateTab, jumpToTab]);
```

- [ ] **Step 3: Extend the `useKeyboardShortcuts` call with the new callbacks**

Replace the existing `useKeyboardShortcuts({...})` invocation with:

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
  onJumpToTab: (n: number) => jumpToTab(n),
  onOpenSearch: () => {
    if (activeTab) window.dispatchEvent(new CustomEvent('support:open-search'));
  },
  onOpenLabelPicker: () => {
    if (activeTab) window.dispatchEvent(new CustomEvent('support:open-label-picker'));
  },
  onOpenCannedPicker: () => {
    if (activeTab) window.dispatchEvent(new CustomEvent('support:open-canned-picker'));
  },
  onToggleAiCopilot: () => {
    useStore.getState().toggleRightSidebar();
  },
  onOpenStatusPicker: () => {
    window.dispatchEvent(new CustomEvent('support:open-status-picker'));
  },
});
```

- [ ] **Step 4: Add i18n strings**

In `client/src/locales/en.ts`, near the other `cmd_*` entries, add:

```typescript
cmd_jump_to_tab_1: 'Jump to tab 1',
cmd_jump_to_tab_2: 'Jump to tab 2',
cmd_jump_to_tab_3: 'Jump to tab 3',
cmd_search_messages: 'Search messages in ticket',
cmd_open_label_picker: 'Open label picker',
cmd_open_canned: 'Open canned responses',
cmd_open_status_picker: 'Open status picker',
```

In `client/src/locales/nl.ts` and `client/src/locales/fr.ts`, add the same keys — use English as placeholder values if you don't have localized copy yet. Keep the keys present in every locale to prevent missing-translation warnings.

- [ ] **Step 5: Run the full client test suite**

```bash
docker compose run --rm -T client npm test -- --run
```

Expected: all tests still pass (no new test files added in this task — coverage comes from Task 1 and Task 7).

- [ ] **Step 6: Commit**

```bash
git add client/src/views/SupportView.tsx client/src/locales/en.ts client/src/locales/nl.ts client/src/locales/fr.ts
git commit -m "feat(support): wire Tier-2 keyboard shortcuts and palette commands"
```

---

## Task 7: E2E spec — Tier-2 shortcuts

**Files:**
- Modify: `testing/e2e/support-shortcuts.spec.ts`

- [ ] **Step 1: Append three new test cases**

At the end of the existing `test.describe('SupportView keyboard shortcuts', ...)` block in `testing/e2e/support-shortcuts.spec.ts`, add:

```typescript
test('Ctrl+F opens the message search bar when a ticket is active', async ({ page }) => {
  await loginAsDemo(page, 'support_lucas');
  const opened = await openFirstTicket(page);
  test.skip(!opened, 'No tickets in queue');

  await page.keyboard.press('Control+F');
  await expect(page.getByPlaceholder(/search/i)).toBeVisible();
});

test('Ctrl+Shift+A toggles the AI copilot sidebar', async ({ page }) => {
  await loginAsDemo(page, 'support_lucas');
  const opened = await openFirstTicket(page);
  test.skip(!opened, 'No tickets in queue');

  // First press opens (or toggles to the opposite of the default state)
  await page.keyboard.press('Control+Shift+A');
  // AiCopilotSidebar renders a nav/aside with a known header label; use a permissive matcher
  await expect(page.locator('aside, [role="complementary"]').filter({ hasText: /copilot|ai/i })).toBeVisible();
});

test('palette shows Tier-2 shortcut hints', async ({ page }) => {
  await loginAsDemo(page, 'support_lucas');
  await page.keyboard.press('Control+K');
  const palette = page.getByRole('dialog', { name: /command palette/i });
  await expect(palette).toBeVisible();

  await expect(palette.getByText('Ctrl+1', { exact: false })).toBeVisible();
  await expect(palette.getByText('Ctrl+F', { exact: false })).toBeVisible();
  await expect(palette.getByText('Ctrl+L', { exact: false })).toBeVisible();
  await expect(palette.getByText('Ctrl+J', { exact: false })).toBeVisible();
  await expect(palette.getByText('Ctrl+Shift+A', { exact: false })).toBeVisible();
  await expect(palette.getByText('Ctrl+.', { exact: false })).toBeVisible();
});
```

- [ ] **Step 2: Run local CI**

```bash
powershell -File scripts/ci.ps1
```

Expected: all steps PASS.

- [ ] **Step 3: Commit**

```bash
git add testing/e2e/support-shortcuts.spec.ts
git commit -m "test(e2e): verify Tier-2 shortcuts and palette hint visibility"
```

---

## Task 8: CHANGELOG update

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Append under the existing `[Unreleased]` → `Added` section**

Find the existing `[Unreleased]` block in `CHANGELOG.md`. It already has an `### Added` block from Tier-1. Append under it (or create a new line if the format prefers):

```markdown
- **SupportView Tier-2 keyboard shortcuts** — `Ctrl+1..9` (jump to chat tab N), `Ctrl+F` (message search), `Ctrl+L` / `Alt+L` (label picker), `Ctrl+J` / `Alt+J` (canned responses), `Ctrl+Shift+A` (toggle AI copilot sidebar), `Ctrl+.` (open status picker). Cross-component openings use `window` CustomEvents (`support:open-label-picker`, `support:open-canned-picker`, `support:open-search`, `support:open-status-picker`) to avoid prop-drilling.
```

Under `### Tests`, append:

```markdown
- 11 new Vitest cases cover the Tier-2 key bindings (digit bounds, dual-modifier bindings, no-Shift guards).
- 3 new Playwright cases in `testing/e2e/support-shortcuts.spec.ts` verify Ctrl+F surfaces the search bar, Ctrl+Shift+A toggles the AI copilot, and the palette hint column shows every Tier-2 binding.
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): note SupportView Tier-2 shortcut additions"
```

---

## Self-review

**Spec coverage:**
- Ctrl+1..9 ✅ Task 1 (tests) + Task 6 (jumpToTab helper, palette commands 1–3)
- Ctrl+F ✅ Task 1 + Task 4 (ChatWindow listener) + Task 6 (event dispatch + palette hint)
- Ctrl+L + Alt+L ✅ Task 1 (dual-binding test) + Task 2 (ChatHeader listener) + Task 6
- Ctrl+J + Alt+J ✅ Task 1 + Task 3 (ComposeArea listener) + Task 6
- Ctrl+Shift+A ✅ Task 1 + Task 6 (direct Zustand call)
- Ctrl+. ✅ Task 1 + Task 5 (StatusPicker listener) + Task 6
- E2E ✅ Task 7
- CHANGELOG ✅ Task 8

**Placeholder scan:** No TBDs. Every step has runnable code or exact commands.

**Type consistency:** All new hook options (`onJumpToTab`, `onOpenSearch`, `onOpenLabelPicker`, `onOpenCannedPicker`, `onToggleAiCopilot`, `onOpenStatusPicker`) identical across hook signature, tests, and SupportView wiring. Event names (`support:open-label-picker`, `support:open-canned-picker`, `support:open-search`, `support:open-status-picker`) identical across producers (Task 6) and consumers (Tasks 2–5).

**Browser safety:** `Ctrl+1..9`, `Ctrl+F`, `Ctrl+L`, `Ctrl+J` deliberately steal browser defaults — user scope approved this. Alt-variants give AZERTY-users and browser-purists a fallback. `Ctrl+Shift+A` and `Ctrl+.` are conflict-free.

**Anti-goals:**
- No new cheat-sheet modal — palette hints remain the single source of truth.
- No new ref methods on `ChatWindowHandle`; we went with window events to keep the handle minimal and let each owning component expose exactly one side-effect.
