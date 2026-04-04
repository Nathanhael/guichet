# Split View & Preview Pane — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Split View (2-4 chats side-by-side with auto layout) and Preview Pane (triage tickets without joining) to SupportView, with a unified view mode dropdown replacing the Focus toggle.

**Architecture:** A `viewMode` state in uiSlice drives layout switching. SupportView reads `viewMode` and renders either single chat (normal/focus), `SplitChatLayout` (split), or `TicketPreviewCard` (preview). A `ViewModeDropdown` in NavToolbar replaces the Focus toggle. No backend changes needed.

**Tech Stack:** React 19, Zustand 5, Tailwind CSS 4, tRPC 11

**Spec:** `docs/superpowers/specs/2026-04-04-split-preview-views-design.md`

---

### Task 1: Add i18n keys for view modes

**Files:**
- Modify: `client/src/locales/en.ts`
- Modify: `client/src/locales/fr.ts`
- Modify: `client/src/locales/nl.ts`

- [ ] **Step 1: Add keys to en.ts**

Add after the `my_stats` key:

```typescript
    view_normal: 'Normal',
    view_split: 'Split View',
    view_preview: 'Preview',
    view_focus: 'Focus',
    view_mode: 'View Mode',
    join_ticket: 'Join',
    preview_ticket: 'Preview',
    split_min_tabs: 'Split view requires 2+ open chats',
    split_min_width: 'Split view requires a wider screen',
```

- [ ] **Step 2: Add keys to fr.ts**

```typescript
    view_normal: 'Normal',
    view_split: 'Vue partagée',
    view_preview: 'Aperçu',
    view_focus: 'Focus',
    view_mode: 'Mode d\'affichage',
    join_ticket: 'Rejoindre',
    preview_ticket: 'Aperçu',
    split_min_tabs: 'La vue partagée nécessite 2+ chats ouverts',
    split_min_width: 'La vue partagée nécessite un écran plus large',
```

- [ ] **Step 3: Add keys to nl.ts**

```typescript
    view_normal: 'Normaal',
    view_split: 'Gesplitste weergave',
    view_preview: 'Voorbeeld',
    view_focus: 'Focus',
    view_mode: 'Weergavemodus',
    join_ticket: 'Deelnemen',
    preview_ticket: 'Voorbeeld',
    split_min_tabs: 'Gesplitste weergave vereist 2+ open chats',
    split_min_width: 'Gesplitste weergave vereist een breder scherm',
```

- [ ] **Step 4: Commit**

```bash
git add client/src/locales/en.ts client/src/locales/fr.ts client/src/locales/nl.ts
git commit -m "feat(i18n): add translation keys for split view and preview pane

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Add viewMode to Zustand UI slice

**Files:**
- Modify: `client/src/store/slices/uiSlice.ts`

- [ ] **Step 1: Add viewMode type and state**

At the top of the file, add the type:

```typescript
export type ViewMode = 'normal' | 'split' | 'preview' | 'focus';
```

Add to the slice state interface (find the existing state properties like `focusMode`, `dyslexicMode`, etc.):

```typescript
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
```

Add to the initial state:

```typescript
  viewMode: (localStorage.getItem('viewMode') as ViewMode) || 'normal',
```

- [ ] **Step 2: Add setViewMode action**

Add the action (follow the pattern of `toggleFocusMode`):

```typescript
  setViewMode: (mode) => {
    localStorage.setItem('viewMode', mode);
    // Sync focusMode for backward compatibility
    const isFocus = mode === 'focus';
    localStorage.setItem('focusMode', String(isFocus));
    set({ viewMode: mode, focusMode: isFocus });
  },
```

- [ ] **Step 3: Update toggleFocusMode to use viewMode**

Find the existing `toggleFocusMode` action. Update it to also set `viewMode`:

```typescript
  toggleFocusMode: () =>
    set((state) => {
      const newFocus = !state.focusMode;
      localStorage.setItem('focusMode', String(newFocus));
      localStorage.setItem('viewMode', newFocus ? 'focus' : 'normal');
      return { focusMode: newFocus, viewMode: newFocus ? 'focus' : 'normal' };
    }),
```

- [ ] **Step 4: Commit**

```bash
git add client/src/store/slices/uiSlice.ts
git commit -m "feat(store): add viewMode state to UI slice

Supports normal/split/preview/focus modes with localStorage persistence.
Syncs with existing focusMode for backward compatibility.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Create ViewModeDropdown component

**Files:**
- Create: `client/src/components/support/ViewModeDropdown.tsx`

- [ ] **Step 1: Create the component**

Create `client/src/components/support/ViewModeDropdown.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { useT } from '../../i18n';
import useStore from '../../store/useStore';
import type { ViewMode } from '../../store/slices/uiSlice';

const VIEW_MODES: { key: ViewMode; label: string; icon: string }[] = [
  { key: 'normal', label: 'view_normal', icon: '▣' },
  { key: 'split', label: 'view_split', icon: '▥' },
  { key: 'preview', label: 'view_preview', icon: '▤' },
  { key: 'focus', label: 'view_focus', icon: '□' },
];

export default function ViewModeDropdown() {
  const viewMode = useStore((s) => s.viewMode);
  const setViewMode = useStore((s) => s.setViewMode);
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onOutsideClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onOutsideClick);
    return () => document.removeEventListener('mousedown', onOutsideClick);
  }, []);

  const current = VIEW_MODES.find((m) => m.key === viewMode) || VIEW_MODES[0];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={t('view_mode') || 'View Mode'}
        aria-expanded={open}
        title={t('view_mode') || 'View Mode'}
        className="flex items-center gap-1.5 bg-bg-surface border border-border px-2 py-1.5 hover:bg-bg-elevated text-text-primary"
      >
        <span className="text-sm leading-none">{current.icon}</span>
        <span className="text-[9px] font-mono font-bold uppercase tracking-wide hidden sm:inline">
          {t(current.label)}
        </span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-44 bg-bg-surface border-2 border-border-heavy z-50">
          {VIEW_MODES.map((mode) => (
            <button
              key={mode.key}
              onClick={() => {
                setViewMode(mode.key);
                setOpen(false);
              }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-[10px] font-bold uppercase ${
                mode.key === viewMode
                  ? 'bg-accent-blue text-white'
                  : 'text-text-primary hover:bg-bg-elevated'
              }`}
            >
              <span className="text-sm leading-none w-4 text-center">{mode.icon}</span>
              {t(mode.label)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/support/ViewModeDropdown.tsx
git commit -m "feat(client): create ViewModeDropdown component

Dropdown with 4 layout modes (normal/split/preview/focus).
Uses Unicode icons, follows StatusPicker dropdown pattern.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Replace Focus toggle with ViewModeDropdown in NavToolbar

**Files:**
- Modify: `client/src/components/NavToolbar.tsx`

- [ ] **Step 1: Read NavToolbar.tsx and find the AccessibilityMenu section**

The Focus toggle currently lives inside `AccessibilityMenu` which is rendered by `NavToolbar`. Find where `AccessibilityMenu` is imported and rendered. Also check if Focus has its own standalone toggle in NavToolbar.

- [ ] **Step 2: Add ViewModeDropdown import**

Add at the top:

```typescript
import ViewModeDropdown from './support/ViewModeDropdown';
```

- [ ] **Step 3: Render ViewModeDropdown in the toolbar**

Find where the toolbar items are rendered. Add `<ViewModeDropdown />` before or after `<AccessibilityMenu />`. The exact placement depends on the existing layout — read the file to find the right spot.

Keep the Focus toggle in AccessibilityMenu as-is (it still works via `toggleFocusMode` which now syncs with `viewMode`). The `ViewModeDropdown` provides a quicker way to switch modes.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/NavToolbar.tsx
git commit -m "feat(client): add ViewModeDropdown to NavToolbar

Provides quick access to layout modes alongside existing
accessibility menu. Focus toggle in AccessibilityMenu still works.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Create SplitChatLayout component

**Files:**
- Create: `client/src/components/support/SplitChatLayout.tsx`

- [ ] **Step 1: Create the component**

Create `client/src/components/support/SplitChatLayout.tsx`:

```tsx
import { Ticket } from '../../types';
import ChatWindow from '../ChatWindow';

interface SplitChatLayoutProps {
  tabs: Ticket[];
  activeTab: string | null;
  onSelectTab: (ticketId: string) => void;
  onCloseTab: (ticketId: string) => void;
}

/**
 * Arranges 2-4 ChatWindows based on count:
 * - 2 chats: equal 50/50 columns
 * - 3 chats: primary (50%) + 2 secondary (25% each)
 * - 4 chats: 2x2 grid
 */
export default function SplitChatLayout({ tabs, activeTab, onSelectTab, onCloseTab }: SplitChatLayoutProps) {
  if (tabs.length === 0) return null;

  // 2x2 grid for 4 chats
  if (tabs.length === 4) {
    return (
      <div className="grid grid-cols-2 grid-rows-2 flex-1 overflow-hidden">
        {tabs.map((ticket) => (
          <div
            key={ticket.id}
            onClick={() => onSelectTab(ticket.id)}
            className={`border border-border overflow-hidden flex flex-col ${
              ticket.id === activeTab ? 'border-l-[3px] border-l-accent-blue' : ''
            }`}
          >
            <ChatWindow ticket={ticket} compact onClose={() => onCloseTab(ticket.id)} />
          </div>
        ))}
      </div>
    );
  }

  // 3 chats: primary (50%) + 2 secondary (25% each)
  if (tabs.length === 3) {
    const primaryId = activeTab && tabs.find((t) => t.id === activeTab) ? activeTab : tabs[0].id;
    const primary = tabs.find((t) => t.id === primaryId)!;
    const secondaries = tabs.filter((t) => t.id !== primaryId);

    return (
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-[2] border-r border-border-heavy overflow-hidden flex flex-col border-l-[3px] border-l-accent-blue">
          <ChatWindow ticket={primary} compact onClose={() => onCloseTab(primary.id)} />
        </div>
        <div className="flex-[1] flex flex-col overflow-hidden">
          {secondaries.map((ticket, i) => (
            <div
              key={ticket.id}
              onClick={() => onSelectTab(ticket.id)}
              className={`flex-1 overflow-hidden flex flex-col cursor-pointer hover:bg-bg-elevated ${
                i < secondaries.length - 1 ? 'border-b border-border-heavy' : ''
              }`}
            >
              <ChatWindow ticket={ticket} compact onClose={() => onCloseTab(ticket.id)} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // 2 chats: equal 50/50
  return (
    <div className="flex flex-1 overflow-hidden">
      {tabs.map((ticket, i) => (
        <div
          key={ticket.id}
          onClick={() => onSelectTab(ticket.id)}
          className={`flex-1 overflow-hidden flex flex-col ${
            i < tabs.length - 1 ? 'border-r border-border-heavy' : ''
          } ${ticket.id === activeTab ? 'border-l-[3px] border-l-accent-blue' : ''}`}
        >
          <ChatWindow ticket={ticket} compact onClose={() => onCloseTab(ticket.id)} />
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/support/SplitChatLayout.tsx
git commit -m "feat(client): create SplitChatLayout component

Auto-arranges 2-4 ChatWindows: 2=equal columns, 3=primary+secondary,
4=2x2 grid. Click secondary to swap primary. Active border indicator.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Add `compact` prop to ChatWindow

**Files:**
- Modify: `client/src/components/ChatWindow.tsx`

- [ ] **Step 1: Add `compact` to props**

Find the component's props (either inline destructuring or an interface). Add `compact?: boolean`.

The component currently destructures props like: `{ ticket, onClose, onFocus, focused }`. Add `compact`:

```typescript
{ ticket, onClose, onFocus, focused, compact }
```

- [ ] **Step 2: Apply compact styling**

`compact` should behave like a lighter version of `focusMode` for the header. Find where `focusMode` conditionals affect the header (around lines 500-600).

Where you see `focusMode ? 'py-2' : 'py-4'`, add compact:

```typescript
(focusMode || compact) ? 'py-2' : 'py-4'
```

Apply the same pattern to hide metadata in compact mode:
- Department badge: show
- References: hide when compact
- Language flag: hide when compact
- Labels: hide when compact
- SLA indicator: hide when compact
- Action buttons: keep visible but use compact padding

Search for each `!focusMode &&` or `focusMode ?` conditional in the header section and add `&& !compact` or `|| compact` as appropriate. The goal: compact mode shows agent name + dept badge + action buttons, hides refs/labels/SLA/language.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/ChatWindow.tsx
git commit -m "feat(client): add compact prop to ChatWindow

Compact mode shows minimal header (name + dept + actions) for
split view. Hides refs, labels, SLA, language flag.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Create TicketPreviewCard component

**Files:**
- Create: `client/src/components/support/TicketPreviewCard.tsx`

- [ ] **Step 1: Create the component**

Create `client/src/components/support/TicketPreviewCard.tsx`:

```tsx
import { useT } from '../../i18n';
import { Ticket } from '../../types';
import { trpc } from '../../utils/trpc';
import { getTicketTime } from '../../utils/dateUtils';
import SlaIndicator from '../SlaIndicator';

interface TicketPreviewCardProps {
  ticket: Ticket;
  onJoin: (ticket: Ticket) => void;
}

export default function TicketPreviewCard({ ticket, onJoin }: TicketPreviewCardProps) {
  const t = useT();

  // Fetch last 3 messages for preview
  const { data: messagesData } = trpc.message.list.useQuery(
    { ticketId: ticket.id, limit: 3 },
    { enabled: !!ticket.id },
  );
  const messages = (messagesData as { messages?: Array<{ id: string; senderName: string; text: string; createdAt: string; system?: boolean }> })?.messages || [];

  return (
    <div className="flex-1 flex items-start justify-center p-6 overflow-y-auto">
      <div className="w-full max-w-2xl border border-border bg-bg-surface">
        {/* Header */}
        <div className="px-5 py-4 border-b border-border">
          <div className="flex items-center gap-3 mb-2">
            <span className="font-mono text-[9px] font-bold uppercase tracking-wide border border-accent-blue text-accent-blue px-2 py-0.5">
              {ticket.dept}
            </span>
            <SlaIndicator ticket={ticket} />
          </div>
          <h3 className="text-sm font-bold text-text-primary">{ticket.agentName}</h3>
          <div className="flex items-center gap-3 mt-1 text-[9px] font-mono text-text-muted uppercase">
            <span>{ticket.status}</span>
            <span>{getTicketTime(ticket.createdAt)}</span>
          </div>
        </div>

        {/* Labels */}
        {ticket.labels && ticket.labels.length > 0 && (
          <div className="px-5 py-2 border-b border-border flex gap-1.5 flex-wrap">
            {ticket.labels.map((label) => (
              <span key={typeof label === 'string' ? label : label.id} className="text-[9px] font-mono font-bold uppercase bg-bg-elevated px-2 py-0.5 text-text-secondary">
                {typeof label === 'string' ? label : label.name}
              </span>
            ))}
          </div>
        )}

        {/* Last 3 messages */}
        <div className="px-5 py-4">
          <div className="text-[9px] font-mono font-bold uppercase tracking-widest text-text-muted mb-3">
            {t('recent_messages') || 'Recent Messages'}
          </div>
          {messages.length === 0 ? (
            <p className="text-text-muted text-xs">{t('no_data') || 'No messages'}</p>
          ) : (
            <div className="flex flex-col gap-3">
              {messages.map((msg) => (
                <div key={msg.id} className="border-l-2 border-border pl-3">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[10px] font-bold text-text-primary">{msg.senderName}</span>
                    <span className="text-[9px] font-mono text-text-muted">{getTicketTime(msg.createdAt)}</span>
                  </div>
                  <p className="text-[11px] text-text-secondary leading-relaxed">{msg.text}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Join button */}
        <div className="px-5 py-4 border-t border-border">
          <button
            onClick={() => onJoin(ticket)}
            className="w-full py-2.5 text-xs font-bold uppercase tracking-wide bg-accent-blue text-white hover:bg-accent-blue-light"
          >
            {t('join_ticket') || 'Join'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/support/TicketPreviewCard.tsx
git commit -m "feat(client): create TicketPreviewCard component

Read-only preview showing metadata, labels, last 3 messages,
and Join button. Used in Preview layout mode for triage.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Wire view modes into SupportView

**Files:**
- Modify: `client/src/views/SupportView.tsx`

This is the main integration task. SupportView needs to read `viewMode` and render the appropriate layout.

- [ ] **Step 1: Add imports**

Add at the top of SupportView.tsx:

```typescript
import SplitChatLayout from '../components/support/SplitChatLayout';
import TicketPreviewCard from '../components/support/TicketPreviewCard';
import type { ViewMode } from '../store/slices/uiSlice';
```

- [ ] **Step 2: Add viewMode from store**

Find where `focusMode` is extracted from the store (around line 31). Add `viewMode` and `setViewMode`:

```typescript
const viewMode = useStore((s) => s.viewMode);
const setViewMode = useStore((s) => s.setViewMode);
```

- [ ] **Step 3: Add preview ticket state**

Add state for the ticket being previewed (near other state declarations):

```typescript
const [previewTicket, setPreviewTicket] = useState<Ticket | null>(null);
```

- [ ] **Step 4: Add split view fallback logic**

Add an effect that falls back to normal mode when split view has < 2 tabs:

```typescript
useEffect(() => {
  if (viewMode === 'split' && openTabs.length < 2) {
    setViewMode('normal');
  }
}, [viewMode, openTabs.length, setViewMode]);
```

Find where `openTabs` (or the equivalent tab array) is defined — it may be called `tabs` or derived from `supportOpenTickets`.

- [ ] **Step 5: Add viewport width check for split view**

Add a width check (use `window.innerWidth`):

```typescript
useEffect(() => {
  if (viewMode === 'split' && window.innerWidth < 768) {
    setViewMode('normal');
    // Optionally show toast
  }
}, [viewMode, setViewMode]);
```

- [ ] **Step 6: Handle preview ticket selection**

When in preview mode, clicking a ticket in the queue should set `previewTicket` instead of opening a tab. Find the `onSelectTicket` callback passed to QueueSidebar. Add a wrapper:

```typescript
function handleSelectTicket(ticket: Ticket) {
  if (viewMode === 'preview') {
    setPreviewTicket(ticket);
  } else {
    onSelectTicket(ticket); // existing tab-open logic
  }
}
```

Pass `handleSelectTicket` to QueueSidebar instead of the original.

- [ ] **Step 7: Handle join from preview**

Add a handler for joining from the preview card:

```typescript
function handleJoinFromPreview(ticket: Ticket) {
  setPreviewTicket(null);
  setViewMode('normal');
  onSelectTicket(ticket); // opens as a tab
}
```

- [ ] **Step 8: Update the main layout JSX**

In the rendering section (around lines 178-220), update the main content area based on `viewMode`:

The sidebar visibility should consider viewMode:
```typescript
const sidebarVisible = viewMode !== 'focus' && viewMode !== 'split' && sidebarOpen;
const sidebarOverlay = viewMode === 'split'; // for hamburger overlay toggle
```

For the main content area, conditionally render based on viewMode:

```tsx
{/* Main content — varies by viewMode */}
{viewMode === 'split' && openTabs.length >= 2 ? (
  <SplitChatLayout
    tabs={openTabs.map(id => tickets.find(t => t.id === id)!).filter(Boolean)}
    activeTab={activeTab}
    onSelectTab={(id) => setActiveTab(id)}
    onCloseTab={(id) => closeTab(id)}
  />
) : viewMode === 'preview' ? (
  <>
    {previewTicket ? (
      <TicketPreviewCard ticket={previewTicket} onJoin={handleJoinFromPreview} />
    ) : (
      <div className="flex-1 flex items-center justify-center">
        <p className="mono-label opacity-20">{t('select_ticket_preview') || 'Select a ticket to preview'}</p>
      </div>
    )}
  </>
) : (
  /* existing normal/focus chat rendering */
)}
```

Adapt the variable names (`openTabs`, `activeTab`, `setActiveTab`, `closeTab`) to match what's actually used in SupportView. Read the file to find the exact names.

- [ ] **Step 9: Update sidebar for overlay mode in split view**

When `viewMode === 'split'`, the sidebar should be overlay-able. Add a hamburger button that appears when sidebar is hidden in split mode:

```tsx
{viewMode === 'split' && !sidebarOpen && (
  <button
    onClick={() => setSidebarOpen(true)}
    className="absolute left-0 top-1/2 -translate-y-1/2 z-30 bg-bg-surface border border-border px-1 py-3 hover:bg-bg-elevated"
    aria-label="Toggle sidebar"
  >
    <span className="text-text-muted text-xs">☰</span>
  </button>
)}
```

And when sidebar is open in split mode, render it as an overlay:

Pass a prop or className to QueueSidebar to position it absolutely in split mode.

- [ ] **Step 10: Commit**

```bash
git add client/src/views/SupportView.tsx
git commit -m "feat(client): wire view modes into SupportView layout

SupportView renders SplitChatLayout, TicketPreviewCard, or normal
chat based on viewMode. Split auto-hides sidebar with overlay toggle.
Preview mode shows read-only ticket card with join button.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Add i18n key for preview empty state

**Files:**
- Modify: `client/src/locales/en.ts`
- Modify: `client/src/locales/fr.ts`
- Modify: `client/src/locales/nl.ts`

- [ ] **Step 1: Add missing keys**

Add after the view mode keys:

en.ts:
```typescript
    select_ticket_preview: 'Select a ticket to preview',
    recent_messages: 'Recent Messages',
```

fr.ts:
```typescript
    select_ticket_preview: 'Sélectionnez un ticket pour l\'aperçu',
    recent_messages: 'Messages récents',
```

nl.ts:
```typescript
    select_ticket_preview: 'Selecteer een ticket voor voorbeeld',
    recent_messages: 'Recente berichten',
```

- [ ] **Step 2: Commit**

```bash
git add client/src/locales/en.ts client/src/locales/fr.ts client/src/locales/nl.ts
git commit -m "feat(i18n): add preview empty state and recent messages keys

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Type check and test

**Files:**
- No new files

- [ ] **Step 1: Run TypeScript type check on client**

```bash
docker compose exec client npx tsc --noEmit
```

Expected: no errors. If there are errors, fix them — likely type mismatches in SplitChatLayout props or ChatWindow compact prop.

- [ ] **Step 2: Run client tests**

```bash
docker compose exec client npm test
```

Expected: all existing tests pass. Fix any failures.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve type errors from split view and preview implementation

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Manual smoke test

- [ ] **Step 1: Test ViewModeDropdown**

1. Log in as support user
2. Find the view mode dropdown in the nav toolbar
3. Verify all 4 options are listed (Normal, Split, Preview, Focus)
4. Select each and verify the layout changes

- [ ] **Step 2: Test Split View**

1. Open 2 tickets from the queue
2. Select Split View from dropdown
3. Verify 2 equal columns showing both chats
4. Open a 3rd ticket — verify primary + secondary layout
5. Open a 4th — verify 2x2 grid
6. Close tabs down to 1 — verify auto-fallback to Normal

- [ ] **Step 3: Test Preview Pane**

1. Select Preview from dropdown
2. Click a ticket in the queue sidebar
3. Verify preview card shows: dept badge, agent name, status, labels, last 3 messages
4. Click "Join" button
5. Verify it switches to Normal mode with the ticket open as a tab

- [ ] **Step 4: Test Focus Mode**

1. Select Focus from dropdown
2. Verify it works exactly as before (single chat, no sidebars)
3. Select Normal to exit

- [ ] **Step 5: Test sidebar behavior in split view**

1. In Split View, verify sidebar is hidden
2. Find hamburger button at left edge
3. Click it — sidebar opens as overlay
4. Click outside — sidebar closes

- [ ] **Step 6: Final commit if fixes needed**

```bash
git add -A
git commit -m "fix: address smoke test findings for split view and preview

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```
