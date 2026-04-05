# Unified Right Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge `CustomerInfoPanel` + `AiCopilotSidebar` into a single lean, collapsible `TicketSidebar` component that shows only past tickets and AI summary. Collapsed by default.

**Architecture:** Replace two separate sidebar components with one unified `TicketSidebar`. Add `rightSidebarExpanded` boolean to the Zustand UI slice (persisted in localStorage, default `false`). Update `SupportView` to render the single sidebar and remove the two separate toggle states.

**Tech Stack:** React 19, Zustand 5, tRPC, Lucide icons, Tailwind CSS 4, CSS custom properties (brutalist design tokens)

---

### Task 1: Add `rightSidebarExpanded` to Zustand UI Slice

**Files:**
- Modify: `client/src/store/slices/uiSlice.ts`
- Modify: `client/src/types/index.ts`

- [ ] **Step 1: Add the state and action to `UISlice` interface**

In `client/src/store/slices/uiSlice.ts`, add to the `UISlice` interface (after line 21, after `agentStatus`):

```typescript
  rightSidebarExpanded: boolean;
  toggleRightSidebar: () => void;
```

- [ ] **Step 2: Add the initial state and action to `createUISlice`**

In `client/src/store/slices/uiSlice.ts`, add to the `createUISlice` object (after `agentStatus: 'online',` on line 51):

```typescript
  rightSidebarExpanded: localStorage.getItem('rightSidebarExpanded') === 'true',

  toggleRightSidebar: () =>
    set((state) => {
      const next = !state.rightSidebarExpanded;
      localStorage.setItem('rightSidebarExpanded', String(next));
      return { rightSidebarExpanded: next };
    }),
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `docker compose exec client npx tsc --noEmit`
Expected: No errors (StoreState extends UISlice, so the new fields propagate automatically)

- [ ] **Step 4: Commit**

```bash
git add client/src/store/slices/uiSlice.ts
git commit -m "feat(store): add rightSidebarExpanded state to UI slice"
```

---

### Task 2: Create `TicketSidebar` Component

**Files:**
- Create: `client/src/components/support/TicketSidebar.tsx`

- [ ] **Step 1: Create the component file**

Create `client/src/components/support/TicketSidebar.tsx` with the following content:

```tsx
import { useEffect } from 'react';
import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';
import { Ticket } from '../../types';
import useStore from '../../store/useStore';
import {
  ChevronRight,
  ChevronLeft,
  Clock,
  RefreshCw,
  Brain,
} from 'lucide-react';

interface TicketSidebarProps {
  ticket: Ticket;
}

export default function TicketSidebar({ ticket }: TicketSidebarProps) {
  const t = useT();
  const rightSidebarExpanded = useStore((s) => s.rightSidebarExpanded);
  const toggleRightSidebar = useStore((s) => s.toggleRightSidebar);

  // ── Past Tickets ──
  const { data: pastTickets } = trpc.ticket.list.useQuery(
    { agentId: ticket.agentId, limit: 10 },
    { enabled: !!ticket.agentId }
  );

  type TicketListResult = { tickets: Ticket[]; nextCursor?: string | null };
  const pastList = Array.isArray(pastTickets)
    ? pastTickets.filter((tk) => tk.id !== ticket.id)
    : ((pastTickets as TicketListResult | undefined)?.tickets || []).filter((tk) => tk.id !== ticket.id);

  // ── AI Summary ──
  const aiConfigQuery = trpc.partner.getAiConfig.useQuery(undefined, { staleTime: 60000 });
  const aiConfig = aiConfigQuery.data;
  const summaryMutation = trpc.ai.summarizeChat.useMutation();

  // Auto-summarize when ticket changes (if enabled)
  useEffect(() => {
    if (aiConfig?.chatSummarization) {
      summaryMutation.mutate({ ticketId: ticket.id });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket.id, aiConfig?.chatSummarization]);

  // ── Collapsed State ──
  if (!rightSidebarExpanded) {
    return (
      <div className="w-10 border-l border-[var(--color-border)] flex flex-col items-center pt-3 bg-[var(--color-bg-surface)]">
        <button
          onClick={toggleRightSidebar}
          className="p-1.5 hover:bg-[var(--color-accent-blue)] hover:text-white"
          title={t('expand_sidebar') || 'Expand sidebar'}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <Clock className="h-4 w-4 opacity-40 mt-3" />
      </div>
    );
  }

  // ── Expanded State ──
  const aiEnabled = aiConfig?.chatSummarization === true;

  return (
    <aside className="w-72 border-l border-[var(--color-border)] flex flex-col overflow-hidden bg-[var(--color-bg-surface)]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--color-border)] bg-[var(--color-bg-base)]">
        <span className="mono-label">{t('ticket_context') || 'CONTEXT'}</span>
        <button
          onClick={toggleRightSidebar}
          className="p-1 hover:bg-[var(--color-accent-blue)] hover:text-white"
          title={t('collapse_sidebar') || 'Collapse'}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-4">
        {/* Past Tickets */}
        <section>
          <h3 className="mono-label opacity-40 mb-2">
            {t('past_tickets') || 'History'} ({pastList.length})
          </h3>
          {pastList.length === 0 ? (
            <p className="text-[12px] text-[var(--color-text-primary)] opacity-40 italic">
              {t('no_history') || 'First contact'}
            </p>
          ) : (
            <div className="space-y-2">
              {pastList.slice(0, 5).map((tk) => (
                <div key={tk.id} className="surface-card">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-mono text-[8px] border border-[var(--color-accent-blue)] text-[var(--color-accent-blue)] px-1.5 py-0.5 uppercase">
                      {tk.dept}
                    </span>
                    <span className="mono-label opacity-60 uppercase">{tk.status}</span>
                  </div>
                  <span className="mono-timestamp">
                    {new Date(tk.createdAt).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* AI Summary (only when AI chat summarization is enabled) */}
        {aiEnabled && (
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="mono-label opacity-40">{t('ai_summary') || 'SUMMARY'}</h3>
              <button
                onClick={() => summaryMutation.mutate({ ticketId: ticket.id, refresh: true })}
                disabled={summaryMutation.isPending}
                className="p-1 hover:bg-[var(--color-accent-blue)] hover:text-white"
                title={t('refresh_summary') || 'Refresh summary'}
              >
                <RefreshCw className={`h-3 w-3 ${summaryMutation.isPending ? 'animate-spin' : ''}`} />
              </button>
            </div>
            <div className="border border-[var(--color-border)] p-2.5">
              {summaryMutation.isPending ? (
                <div className="flex items-center gap-2 text-xs opacity-40">
                  <Brain className="h-3.5 w-3.5" />
                  <span className="mono-label">{t('ai_analyzing') || 'Analyzing...'}</span>
                </div>
              ) : summaryMutation.data?.summary ? (
                <p className="text-xs leading-relaxed opacity-80">{summaryMutation.data.summary}</p>
              ) : summaryMutation.error ? (
                <p className="text-xs opacity-40 italic">{t('ai_unavailable') || 'AI unavailable'}</p>
              ) : (
                <p className="text-xs opacity-40 italic">{t('ai_no_summary') || 'No summary yet'}</p>
              )}
            </div>
          </section>
        )}
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `docker compose exec client npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add client/src/components/support/TicketSidebar.tsx
git commit -m "feat(support): create unified TicketSidebar component"
```

---

### Task 3: Update SupportView to Use TicketSidebar

**Files:**
- Modify: `client/src/views/SupportView.tsx`

- [ ] **Step 1: Replace imports**

In `client/src/views/SupportView.tsx`, replace lines 15-16:

```typescript
import CustomerInfoPanel from '../components/support/CustomerInfoPanel';
import AiCopilotSidebar from '../components/support/AiCopilotSidebar';
```

with:

```typescript
import TicketSidebar from '../components/support/TicketSidebar';
```

- [ ] **Step 2: Remove the two separate toggle states**

In `client/src/views/SupportView.tsx`, remove lines 67-68:

```typescript
  const [showCustomerInfo, setShowCustomerInfo] = useState(true);
  const [showCopilot, setShowCopilot] = useState(true);
```

- [ ] **Step 3: Update command palette commands**

In `client/src/views/SupportView.tsx`, replace the two toggle commands (lines 209-210):

```typescript
    { id: 'toggle-copilot', labelKey: 'cmd_toggle_copilot', groupKey: 'cmd_group_view', execute: () => setShowCopilot((v) => !v), keywords: ['ai', 'copilot', 'assistant'] },
    { id: 'toggle-customer-info', labelKey: 'cmd_toggle_customer_info', groupKey: 'cmd_group_view', execute: () => setShowCustomerInfo((v) => !v), keywords: ['customer', 'info', 'panel', 'details'] },
```

with a single command:

```typescript
    { id: 'toggle-sidebar-right', labelKey: 'cmd_toggle_sidebar_right', groupKey: 'cmd_group_view', execute: () => useStore.getState().toggleRightSidebar(), keywords: ['sidebar', 'context', 'panel', 'copilot', 'info'] },
```

- [ ] **Step 4: Replace the two sidebar render blocks with one**

In `client/src/views/SupportView.tsx`, replace lines 303-313:

```tsx
            {/* Customer context panel (only in normal mode) */}
            {activeTab && !showPreview && !focusMode && viewMode === 'normal' && showCustomerInfo && (() => {
              const activeTicket = tickets.find((tk) => tk.id === activeTab);
              return activeTicket ? <CustomerInfoPanel ticket={activeTicket} /> : null;
            })()}

            {/* AI Copilot sidebar (only in normal mode) */}
            {activeTab && !showPreview && !focusMode && viewMode === 'normal' && showCopilot && (() => {
              const activeTicket = tickets.find((tk) => tk.id === activeTab);
              return activeTicket ? <AiCopilotSidebar ticket={activeTicket} /> : null;
            })()}
```

with:

```tsx
            {/* Ticket context sidebar (only in normal mode) */}
            {activeTab && !showPreview && !focusMode && viewMode === 'normal' && (() => {
              const activeTicket = tickets.find((tk) => tk.id === activeTab);
              return activeTicket ? <TicketSidebar ticket={activeTicket} /> : null;
            })()}
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `docker compose exec client npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add client/src/views/SupportView.tsx
git commit -m "feat(support): replace dual sidebars with unified TicketSidebar"
```

---

### Task 4: Delete Old Components

**Files:**
- Delete: `client/src/components/support/CustomerInfoPanel.tsx`
- Delete: `client/src/components/support/AiCopilotSidebar.tsx`

- [ ] **Step 1: Check for other imports of the old components**

Run: `docker compose exec client sh -c "grep -r 'CustomerInfoPanel\|AiCopilotSidebar' src/ --include='*.tsx' --include='*.ts' -l"`

Expected: No files listed (SupportView was the only consumer, updated in Task 3)

- [ ] **Step 2: Delete the old files**

```bash
git rm client/src/components/support/CustomerInfoPanel.tsx
git rm client/src/components/support/AiCopilotSidebar.tsx
```

- [ ] **Step 3: Verify TypeScript still compiles**

Run: `docker compose exec client npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Verify the app builds**

Run: `docker compose exec client npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor(support): remove obsolete CustomerInfoPanel and AiCopilotSidebar"
```

---

### Task 5: Manual Smoke Test

**Files:** None (verification only)

- [ ] **Step 1: Start the dev environment**

Run: `docker compose up`

- [ ] **Step 2: Verify collapsed state (default)**

1. Log in as a support user
2. Open a ticket
3. Confirm the right sidebar shows as a thin ~40px rail with a `‹` chevron and clock icon
4. Confirm the chat area takes up the remaining width

- [ ] **Step 3: Verify expanded state**

1. Click the chevron on the collapsed rail
2. Confirm the sidebar expands to show "CONTEXT" header with `›` collapse button
3. Confirm "PAST TICKETS" section shows with count and ticket cards (or "First contact" if none)
4. If AI is enabled for the partner: confirm "SUMMARY" section shows with refresh button
5. If AI is disabled: confirm no summary section appears

- [ ] **Step 4: Verify state persistence**

1. Expand the sidebar
2. Switch to a different ticket tab
3. Confirm the sidebar remains expanded
4. Refresh the page
5. Confirm the sidebar remembers its expanded/collapsed state

- [ ] **Step 5: Verify command palette**

1. Open command palette (Ctrl+K)
2. Search for "sidebar" or "context"
3. Confirm the toggle command appears and works

- [ ] **Step 6: Verify no regressions**

1. Confirm focus mode still hides the sidebar entirely
2. Confirm split view modes don't show the sidebar
3. Confirm ticket preview mode doesn't show the sidebar
