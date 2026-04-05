# Queue Sidebar Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the SupportView queue sidebar for better scanability — agent badges, smart timestamps, unread counts, 2-tab layout, collapsible team footer.

**Architecture:** Extract the monolithic `QueueSidebar.tsx` (430 lines) into focused sub-components: `AgentBadges`, `QueueTicketRow`, `ArchiveTicketRow`, `SidebarFooter`. Extend the `getTicketTime` utility for smart relative timestamps. Remove `SavedViewPicker` integration.

**Tech Stack:** React 19, TypeScript, Tailwind CSS 4, Zustand 5, Vitest, @testing-library/react

**Spec:** `docs/superpowers/specs/2026-04-05-queue-sidebar-redesign-design.md`

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `client/src/components/support/AgentBadges.tsx` | Overlapping monogram badges with hover tooltips |
| Create | `client/src/components/support/QueueTicketRow.tsx` | Single ticket row for the queue tab |
| Create | `client/src/components/support/ArchiveTicketRow.tsx` | Single ticket row for the archive tab |
| Create | `client/src/components/support/SidebarFooter.tsx` | Footer with collapsed badges + expandable team panel |
| Create | `client/src/components/support/__tests__/AgentBadges.test.tsx` | Tests for AgentBadges |
| Create | `client/src/components/support/__tests__/QueueTicketRow.test.tsx` | Tests for QueueTicketRow |
| Create | `client/src/components/support/__tests__/SidebarFooter.test.tsx` | Tests for SidebarFooter |
| Create | `client/src/utils/__tests__/dateUtils.test.ts` | Tests for smart timestamp formatting |
| Modify | `client/src/utils/dateUtils.ts` | Add `getSmartTimestamp` function |
| Modify | `client/src/components/support/QueueSidebar.tsx` | Remove old rendering, wire new sub-components, remove SavedViewPicker |

---

### Task 1: Smart Timestamp Utility

**Files:**
- Create: `client/src/utils/__tests__/dateUtils.test.ts`
- Modify: `client/src/utils/dateUtils.ts`

- [ ] **Step 1: Write the failing tests**

Create `client/src/utils/__tests__/dateUtils.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest';
import { getSmartTimestamp } from '../dateUtils';

describe('getSmartTimestamp', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns time only for today', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-05T14:30:00Z'));
    expect(getSmartTimestamp('2026-04-05T09:15:00Z')).toBe('09:15');
    vi.useRealTimers();
  });

  it('returns "Yest HH:mm" for yesterday', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-05T14:30:00Z'));
    expect(getSmartTimestamp('2026-04-04T16:45:00Z')).toBe('Yest 16:45');
    vi.useRealTimers();
  });

  it('returns "Day HH:mm" for 2-6 days ago', () => {
    vi.useFakeTimers();
    // April 5 is a Sunday, April 2 is a Thursday
    vi.setSystemTime(new Date('2026-04-05T14:30:00Z'));
    expect(getSmartTimestamp('2026-04-02T10:00:00Z')).toBe('Thu 10:00');
    vi.useRealTimers();
  });

  it('returns "DD MMM" for older dates', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-05T14:30:00Z'));
    expect(getSmartTimestamp('2026-03-15T08:00:00Z')).toBe('15 Mar');
    vi.useRealTimers();
  });

  it('returns dash for undefined input', () => {
    expect(getSmartTimestamp(undefined)).toBe('—');
  });

  it('returns dash for invalid date', () => {
    expect(getSmartTimestamp('not-a-date')).toBe('—');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec client npx vitest run src/utils/__tests__/dateUtils.test.ts`
Expected: FAIL — `getSmartTimestamp` is not exported from `dateUtils`.

- [ ] **Step 3: Implement `getSmartTimestamp`**

Add to the bottom of `client/src/utils/dateUtils.ts`:

```typescript
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Smart relative timestamp for sidebar ticket rows.
 * - Today: "15:05"
 * - Yesterday: "Yest 14:30"
 * - 2-6 days ago: "Mon 15:05"
 * - Older: "08 Mar"
 */
export const getSmartTimestamp = (iso: string | undefined): string => {
  const d = safeDate(iso);
  if (!d) return '—';

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dateDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.floor((today.getTime() - dateDay.getTime()) / (1000 * 60 * 60 * 24));

  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  if (diffDays === 0) return time;
  if (diffDays === 1) return `Yest ${time}`;
  if (diffDays >= 2 && diffDays <= 6) return `${DAY_NAMES[d.getDay()]} ${time}`;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `docker compose exec client npx vitest run src/utils/__tests__/dateUtils.test.ts`
Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/utils/dateUtils.ts client/src/utils/__tests__/dateUtils.test.ts
git commit -m "feat: add getSmartTimestamp utility for sidebar ticket rows"
```

---

### Task 2: AgentBadges Component

**Files:**
- Create: `client/src/components/support/__tests__/AgentBadges.test.tsx`
- Create: `client/src/components/support/AgentBadges.tsx`

- [ ] **Step 1: Write the failing tests**

Create `client/src/components/support/__tests__/AgentBadges.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AgentBadges from '../AgentBadges';
import type { Participant } from '../../../types';

const participants: Participant[] = [
  { id: 'user-1', name: 'Alice Reeves', role: 'support' },
  { id: 'user-2', name: 'Bob Chen', role: 'support' },
  { id: 'user-3', name: 'Charlie Davis', role: 'agent' },
];

describe('AgentBadges', () => {
  it('renders monograms for support-like participants only', () => {
    render(<AgentBadges participants={participants} currentUserId="user-99" />);
    expect(screen.getByText('AR')).toBeInTheDocument();
    expect(screen.getByText('BC')).toBeInTheDocument();
    // agent role should be excluded
    expect(screen.queryByText('CD')).not.toBeInTheDocument();
  });

  it('renders current user badge with "You" tooltip', () => {
    render(<AgentBadges participants={participants} currentUserId="user-1" />);
    const badge = screen.getByText('AR');
    // Current user badge should have the self styling data attribute
    expect(badge.closest('[data-self]')).toBeInTheDocument();
  });

  it('current user appears first', () => {
    render(<AgentBadges participants={participants} currentUserId="user-2" />);
    const badges = screen.getAllByRole('img', { hidden: true });
    // First badge should be BC (current user)
    expect(badges[0]).toHaveAttribute('aria-label', 'You');
  });

  it('renders nothing when no support participants', () => {
    const agentOnly: Participant[] = [
      { id: 'user-3', name: 'Charlie Davis', role: 'agent' },
    ];
    const { container } = render(<AgentBadges participants={agentOnly} currentUserId="user-99" />);
    expect(container.firstChild).toBeNull();
  });

  it('shows overflow count when maxVisible exceeded', () => {
    const many: Participant[] = [
      { id: 'u1', name: 'Alice A', role: 'support' },
      { id: 'u2', name: 'Bob B', role: 'support' },
      { id: 'u3', name: 'Charlie C', role: 'support' },
      { id: 'u4', name: 'Diana D', role: 'support' },
      { id: 'u5', name: 'Eve E', role: 'support' },
      { id: 'u6', name: 'Frank F', role: 'admin' },
    ];
    render(<AgentBadges participants={many} currentUserId="u99" maxVisible={4} />);
    expect(screen.getByText('+2')).toBeInTheDocument();
  });

  it('shows tooltip text on hover', () => {
    render(<AgentBadges participants={participants} currentUserId="user-99" />);
    const badge = screen.getByText('AR');
    expect(badge.closest('[data-tooltip]')?.getAttribute('data-tooltip')).toBe('Alice Reeves');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec client npx vitest run src/components/support/__tests__/AgentBadges.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement AgentBadges**

Create `client/src/components/support/AgentBadges.tsx`:

```tsx
import type { Participant } from '../../types';

interface AgentBadgesProps {
  participants: Participant[];
  currentUserId: string;
  maxVisible?: number;
}

/** Returns true for roles that represent support staff. */
function isSupportRole(role?: string): boolean {
  return role === 'support' || role === 'admin' || role === 'platform_operator';
}

/** Extract up to 2 initials from a name. */
function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

/**
 * Overlapping monogram badges showing which support agents have joined a ticket.
 * - Current user: blue background, "You" tooltip
 * - Others: elevated background, full name tooltip
 * - Overflow: "+N" badge with remaining names on hover
 */
export default function AgentBadges({ participants, currentUserId, maxVisible = 4 }: AgentBadgesProps) {
  const supportAgents = participants.filter((p) => isSupportRole(p.role));
  if (supportAgents.length === 0) return null;

  // Current user first, then alphabetical
  const sorted = [...supportAgents].sort((a, b) => {
    if (a.id === currentUserId) return -1;
    if (b.id === currentUserId) return 1;
    return a.name.localeCompare(b.name);
  });

  const visible = sorted.slice(0, maxVisible);
  const overflow = sorted.slice(maxVisible);

  return (
    <div className="flex items-center">
      {visible.map((agent) => {
        const isSelf = agent.id === currentUserId;
        const tooltip = isSelf ? 'You' : agent.name;
        return (
          <div
            key={agent.id}
            data-self={isSelf || undefined}
            data-tooltip={tooltip}
            role="img"
            aria-label={tooltip}
            className={`w-5 h-5 rounded-full flex items-center justify-center font-mono text-[7px] font-bold shrink-0 -ml-1.5 first:ml-0 border-[1.5px] border-[var(--color-bg-surface)] relative group cursor-default ${
              isSelf
                ? 'bg-[var(--color-accent-blue)] text-white'
                : 'bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)]'
            }`}
          >
            <span>{getInitials(agent.name)}</span>
            <span className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 bg-[var(--color-bg-base)] border border-[var(--color-border-heavy)] px-2 py-1 font-mono text-[9px] font-medium text-[var(--color-text-primary)] whitespace-nowrap z-10">
              {tooltip}
            </span>
          </div>
        );
      })}
      {overflow.length > 0 && (
        <div
          data-tooltip={overflow.map((a) => a.name).join(', ')}
          className="w-5 h-5 rounded-full flex items-center justify-center font-mono text-[7px] font-bold shrink-0 -ml-1.5 bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)] border-[1.5px] border-[var(--color-bg-surface)] relative group cursor-default"
        >
          <span>+{overflow.length}</span>
          <span className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 bg-[var(--color-bg-base)] border border-[var(--color-border-heavy)] px-2 py-1 font-mono text-[9px] font-medium text-[var(--color-text-primary)] whitespace-nowrap z-10">
            {overflow.map((a) => a.name).join(', ')}
          </span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests and fix any assertion mismatches**

Run: `docker compose exec client npx vitest run src/components/support/__tests__/AgentBadges.test.tsx`
Expected: All 6 tests PASS. If role filtering assertions fail, check the `isSupportRole` logic against actual participant data. Adjust test or implementation if the `role` field values differ.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/support/AgentBadges.tsx client/src/components/support/__tests__/AgentBadges.test.tsx
git commit -m "feat: add AgentBadges component with overlapping monograms and tooltips"
```

---

### Task 3: QueueTicketRow Component

**Files:**
- Create: `client/src/components/support/__tests__/QueueTicketRow.test.tsx`
- Create: `client/src/components/support/QueueTicketRow.tsx`

- [ ] **Step 1: Write the failing tests**

Create `client/src/components/support/__tests__/QueueTicketRow.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QueueTicketRow from '../QueueTicketRow';
import type { Ticket } from '../../../types';

// Mock i18n
vi.mock('../../../i18n', () => ({
  useT: () => (key: string) => key,
}));

const baseTicket: Ticket = {
  id: 'ticket-1',
  dept: 'BIL',
  agentId: 'agent-1',
  agentName: 'Kelvin Ferry-Okuneva',
  agentLang: 'en',
  status: 'open',
  createdAt: '2026-04-05T09:15:00Z',
  participants: [
    { id: 'support-1', name: 'Alice Reeves', role: 'support' },
  ],
  labels: [],
};

describe('QueueTicketRow', () => {
  it('renders agent name in normal case', () => {
    render(
      <QueueTicketRow
        ticket={baseTicket}
        isActive={false}
        unreadCount={0}
        currentUserId="support-1"
        onClick={() => {}}
      />
    );
    expect(screen.getByText('Kelvin Ferry-Okuneva')).toBeInTheDocument();
  });

  it('renders department badge', () => {
    render(
      <QueueTicketRow
        ticket={baseTicket}
        isActive={false}
        unreadCount={0}
        currentUserId="support-1"
        onClick={() => {}}
      />
    );
    expect(screen.getByText('BIL')).toBeInTheDocument();
  });

  it('renders status dot with open class', () => {
    const { container } = render(
      <QueueTicketRow
        ticket={baseTicket}
        isActive={false}
        unreadCount={0}
        currentUserId="support-1"
        onClick={() => {}}
      />
    );
    const dot = container.querySelector('[data-status-dot]');
    expect(dot?.className).toContain('bg-[var(--color-accent-green)]');
  });

  it('renders pending status dot', () => {
    const pendingTicket = { ...baseTicket, status: 'pending' as const };
    const { container } = render(
      <QueueTicketRow
        ticket={pendingTicket}
        isActive={false}
        unreadCount={0}
        currentUserId="support-1"
        onClick={() => {}}
      />
    );
    const dot = container.querySelector('[data-status-dot]');
    expect(dot?.className).toContain('bg-[var(--color-accent-purple)]');
  });

  it('shows unread count badge when unreadCount > 0', () => {
    render(
      <QueueTicketRow
        ticket={baseTicket}
        isActive={false}
        unreadCount={3}
        currentUserId="support-1"
        onClick={() => {}}
      />
    );
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('does not show unread badge when unreadCount is 0', () => {
    render(
      <QueueTicketRow
        ticket={baseTicket}
        isActive={false}
        unreadCount={0}
        currentUserId="support-1"
        onClick={() => {}}
      />
    );
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('applies active styling when isActive', () => {
    const { container } = render(
      <QueueTicketRow
        ticket={baseTicket}
        isActive={true}
        unreadCount={0}
        currentUserId="support-1"
        onClick={() => {}}
      />
    );
    expect(container.firstChild?.className).toContain('border-l-[var(--color-accent-blue)]');
  });

  it('applies unread tint when unreadCount > 0', () => {
    const { container } = render(
      <QueueTicketRow
        ticket={baseTicket}
        isActive={false}
        unreadCount={2}
        currentUserId="support-1"
        onClick={() => {}}
      />
    );
    expect(container.firstChild?.className).toContain('bg-[rgba(59,130,246,0.04)]');
  });

  it('calls onClick when clicked', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <QueueTicketRow
        ticket={baseTicket}
        isActive={false}
        unreadCount={0}
        currentUserId="support-1"
        onClick={onClick}
      />
    );
    await user.click(screen.getByText('Kelvin Ferry-Okuneva'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('shows disabled state when disabled', () => {
    const { container } = render(
      <QueueTicketRow
        ticket={baseTicket}
        isActive={false}
        unreadCount={0}
        currentUserId="support-1"
        onClick={() => {}}
        disabled={true}
      />
    );
    expect(container.firstChild?.className).toContain('opacity-40');
  });

  it('renders agent badges for support participants', () => {
    render(
      <QueueTicketRow
        ticket={baseTicket}
        isActive={false}
        unreadCount={0}
        currentUserId="support-1"
        onClick={() => {}}
      />
    );
    expect(screen.getByText('AR')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec client npx vitest run src/components/support/__tests__/QueueTicketRow.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement QueueTicketRow**

Create `client/src/components/support/QueueTicketRow.tsx`:

```tsx
import type { Ticket } from '../../types';
import { getSmartTimestamp } from '../../utils/dateUtils';
import AgentBadges from './AgentBadges';
import SentimentDot from '../SentimentDot';
import SlaIndicator from '../SlaIndicator';

interface QueueTicketRowProps {
  ticket: Ticket;
  isActive: boolean;
  unreadCount: number;
  currentUserId: string;
  sentimentScore?: number | null;
  onClick: () => void;
  disabled?: boolean;
}

const STATUS_DOT_COLORS: Record<string, string> = {
  open: 'bg-[var(--color-accent-green)]',
  pending: 'bg-[var(--color-accent-purple)]',
};

export default function QueueTicketRow({
  ticket,
  isActive,
  unreadCount,
  currentUserId,
  sentimentScore,
  onClick,
  disabled = false,
}: QueueTicketRowProps) {
  const isUnread = unreadCount > 0;

  const rowClasses = [
    'px-3 py-2.5 border-b border-[var(--color-border)] cursor-pointer',
    'hover:bg-[var(--color-bg-elevated)]',
    isActive && 'border-l-[3px] border-l-[var(--color-accent-blue)] bg-[rgba(59,130,246,0.06)]',
    !isActive && isUnread && 'bg-[rgba(59,130,246,0.04)]',
    isActive && isUnread && 'bg-[rgba(59,130,246,0.08)]',
    disabled && 'opacity-40 cursor-not-allowed',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <li
      className={rowClasses}
      onClick={disabled ? undefined : onClick}
    >
      {/* Row 1: dept + status + name + time */}
      <div className="flex items-center gap-1.5 mb-1">
        <span className="font-mono text-[7px] font-bold uppercase tracking-[0.5px] px-[5px] py-px border border-[var(--color-accent-blue)] text-[var(--color-accent-blue)] shrink-0">
          {ticket.dept}
        </span>
        <span
          data-status-dot
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT_COLORS[ticket.status] || 'bg-[var(--color-text-muted)]'}`}
        />
        <span className="text-[13px] font-semibold text-[var(--color-text-primary)] truncate flex-1 min-w-0">
          {ticket.agentName}
        </span>
        <span className="font-mono text-[9px] text-[var(--color-text-muted)] shrink-0 ml-auto">
          {getSmartTimestamp(ticket.createdAt)}
        </span>
      </div>

      {/* Row 2: agent badges + sentiment + SLA + unread count */}
      <div className="flex items-center gap-1.5">
        <AgentBadges
          participants={ticket.participants}
          currentUserId={currentUserId}
        />
        {sentimentScore != null && (
          <SentimentDot score={sentimentScore} compact />
        )}
        {ticket.slaResponseDueAt && !ticket.supportJoinedAt && (
          <SlaIndicator dueAt={ticket.slaResponseDueAt} breached={ticket.slaBreached} compact />
        )}
        {isUnread && (
          <span className="font-mono text-[8px] font-bold bg-[var(--color-accent-blue)] text-white min-w-[16px] h-4 flex items-center justify-center px-1 shrink-0 ml-auto">
            {unreadCount}
          </span>
        )}
      </div>
    </li>
  );
}
```

- [ ] **Step 4: Run tests and fix any assertion mismatches**

Run: `docker compose exec client npx vitest run src/components/support/__tests__/QueueTicketRow.test.tsx`
Expected: All 11 tests PASS. Adjust class name assertions if the exact string matching is too brittle — use `toContain` for partial matches.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/support/QueueTicketRow.tsx client/src/components/support/__tests__/QueueTicketRow.test.tsx
git commit -m "feat: add QueueTicketRow component with status dots, agent badges, unread count"
```

---

### Task 4: ArchiveTicketRow Component

**Files:**
- Create: `client/src/components/support/ArchiveTicketRow.tsx`

This is a thin variant of QueueTicketRow — no unread count, "Closed" badge instead of status dot, dimmed styling.

- [ ] **Step 1: Implement ArchiveTicketRow**

Create `client/src/components/support/ArchiveTicketRow.tsx`:

```tsx
import type { Ticket } from '../../types';
import { getSmartTimestamp } from '../../utils/dateUtils';
import AgentBadges from './AgentBadges';

interface ArchiveTicketRowProps {
  ticket: Ticket;
  isActive: boolean;
  currentUserId: string;
  onClick: () => void;
}

export default function ArchiveTicketRow({
  ticket,
  isActive,
  currentUserId,
  onClick,
}: ArchiveTicketRowProps) {
  const rowClasses = [
    'px-3 py-2.5 border-b border-[var(--color-border)] cursor-pointer opacity-70 hover:opacity-100',
    'hover:bg-[var(--color-bg-elevated)]',
    isActive && 'border-l-[3px] border-l-[var(--color-accent-blue)] opacity-100',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <li className={rowClasses} onClick={onClick}>
      {/* Row 1: dept + closed badge + name + time */}
      <div className="flex items-center gap-1.5 mb-1">
        <span className="font-mono text-[7px] font-bold uppercase tracking-[0.5px] px-[5px] py-px border border-[var(--color-accent-blue)] text-[var(--color-accent-blue)] shrink-0">
          {ticket.dept}
        </span>
        <span className="font-mono text-[7px] font-bold uppercase tracking-[0.5px] px-[5px] py-px border border-[var(--color-text-faint)] text-[var(--color-text-muted)] shrink-0">
          Closed
        </span>
        <span className="text-[13px] font-semibold text-[var(--color-text-primary)] truncate flex-1 min-w-0">
          {ticket.agentName}
        </span>
        <span className="font-mono text-[9px] text-[var(--color-text-muted)] shrink-0 ml-auto">
          {getSmartTimestamp(ticket.closedAt || ticket.createdAt)}
        </span>
      </div>

      {/* Row 2: agent badges */}
      <div className="flex items-center gap-1.5">
        <AgentBadges
          participants={ticket.participants || []}
          currentUserId={currentUserId}
        />
      </div>
    </li>
  );
}
```

- [ ] **Step 2: Verify the component compiles**

Run: `docker compose exec client npx tsc --noEmit`
Expected: No type errors related to `ArchiveTicketRow`.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/support/ArchiveTicketRow.tsx
git commit -m "feat: add ArchiveTicketRow component with Closed badge and dimmed styling"
```

---

### Task 5: SidebarFooter Component

**Files:**
- Create: `client/src/components/support/__tests__/SidebarFooter.test.tsx`
- Create: `client/src/components/support/SidebarFooter.tsx`

- [ ] **Step 1: Write the failing tests**

Create `client/src/components/support/__tests__/SidebarFooter.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SidebarFooter from '../SidebarFooter';
import type { OnlineSupport } from '../../../types';

vi.mock('../../../i18n', () => ({
  useT: () => (key: string) => key,
}));

const agents: OnlineSupport[] = [
  { userId: 'u1', name: 'Alice Reeves', status: 'online' },
  { userId: 'u2', name: 'Bob Chen', status: 'online' },
  { userId: 'u3', name: 'Charlie Davis', status: 'away' },
  { userId: 'u4', name: 'Diana Evans', status: 'online' },
];

describe('SidebarFooter', () => {
  it('shows queue count on queue tab', () => {
    render(
      <SidebarFooter
        sidebarTab="queue"
        queueCount={9}
        onlineSupportUsers={agents}
      />
    );
    expect(screen.getByText(/9/)).toBeInTheDocument();
    expect(screen.getByText(/in_queue/i)).toBeInTheDocument();
  });

  it('shows archive count on archive tab', () => {
    render(
      <SidebarFooter
        sidebarTab="archive"
        queueCount={7}
        onlineSupportUsers={agents}
      />
    );
    expect(screen.getByText(/7/)).toBeInTheDocument();
  });

  it('shows capacity count', () => {
    render(
      <SidebarFooter
        sidebarTab="queue"
        queueCount={5}
        onlineSupportUsers={agents}
      />
    );
    // 3 online out of 4 total
    expect(screen.getByText('3 / 4')).toBeInTheDocument();
  });

  it('shows agent badges (max 4 visible)', () => {
    render(
      <SidebarFooter
        sidebarTab="queue"
        queueCount={5}
        onlineSupportUsers={agents}
      />
    );
    expect(screen.getByText('AR')).toBeInTheDocument();
    expect(screen.getByText('BC')).toBeInTheDocument();
  });

  it('shows +N overflow when more than 4 agents', () => {
    const many: OnlineSupport[] = [
      ...agents,
      { userId: 'u5', name: 'Eve Franklin', status: 'online' },
      { userId: 'u6', name: 'Frank Garcia', status: 'away' },
    ];
    render(
      <SidebarFooter
        sidebarTab="queue"
        queueCount={5}
        onlineSupportUsers={many}
      />
    );
    expect(screen.getByText('+2')).toBeInTheDocument();
  });

  it('expands team panel on click', async () => {
    const user = userEvent.setup();
    render(
      <SidebarFooter
        sidebarTab="queue"
        queueCount={5}
        onlineSupportUsers={agents}
      />
    );
    // Initially the full team list is hidden
    expect(screen.queryByText('online_team')).not.toBeInTheDocument();
    // Click footer to expand
    await user.click(screen.getByRole('button', { name: /toggle_team_panel/i }));
    expect(screen.getByText('online_team')).toBeInTheDocument();
    // All agent names visible in expanded panel
    expect(screen.getByText('Alice Reeves')).toBeInTheDocument();
    expect(screen.getByText('Charlie Davis')).toBeInTheDocument();
  });

  it('collapses team panel on second click', async () => {
    const user = userEvent.setup();
    render(
      <SidebarFooter
        sidebarTab="queue"
        queueCount={5}
        onlineSupportUsers={agents}
      />
    );
    const toggle = screen.getByRole('button', { name: /toggle_team_panel/i });
    await user.click(toggle);
    expect(screen.getByText('online_team')).toBeInTheDocument();
    await user.click(toggle);
    expect(screen.queryByText('online_team')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec client npx vitest run src/components/support/__tests__/SidebarFooter.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement SidebarFooter**

Create `client/src/components/support/SidebarFooter.tsx`:

```tsx
import { useState } from 'react';
import { useT } from '../../i18n';
import { getStatusColors, getStatusI18nKey } from '../../utils/statusColors';
import type { OnlineSupport } from '../../types';

interface SidebarFooterProps {
  sidebarTab: 'queue' | 'archive';
  queueCount: number;
  onlineSupportUsers: OnlineSupport[];
}

const MAX_FOOTER_BADGES = 4;

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export default function SidebarFooter({ sidebarTab, queueCount, onlineSupportUsers }: SidebarFooterProps) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);

  const availableCount = onlineSupportUsers.filter((u) => u.status === 'online').length;
  const totalOnline = onlineSupportUsers.length;
  const visible = onlineSupportUsers.slice(0, MAX_FOOTER_BADGES);
  const overflow = onlineSupportUsers.slice(MAX_FOOTER_BADGES);

  return (
    <div className="border-t border-[var(--color-border)]">
      {/* Expanded team panel */}
      {expanded && onlineSupportUsers.length > 0 && (
        <div className="border-b border-[var(--color-border)] px-3 py-3">
          <div className="text-[9px] font-mono font-bold uppercase tracking-widest text-[var(--color-text-muted)] mb-2">
            {t('online_team')}
          </div>
          <div className="flex flex-col gap-1.5">
            {onlineSupportUsers.map((agent) => {
              const colors = getStatusColors(agent.status);
              return (
                <div key={agent.userId} className="flex items-center gap-2 px-1 py-0.5">
                  <div className="w-6 h-6 rounded-full bg-[var(--color-bg-elevated)] flex items-center justify-center text-[9px] font-bold text-[var(--color-text-primary)] shrink-0">
                    {getInitials(agent.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-semibold text-[var(--color-text-primary)] truncate">{agent.name}</div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={`w-2 h-2 rounded-full ${colors.dot}`} />
                    <span className={`text-[9px] font-bold uppercase ${colors.text}`}>
                      {t(getStatusI18nKey(agent.status))}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Collapsed footer bar */}
      <button
        onClick={() => setExpanded((v) => !v)}
        aria-label={t('toggle_team_panel') || 'Toggle team panel'}
        className="w-full px-4 py-2 flex items-center justify-between hover:bg-[var(--color-bg-elevated)]"
      >
        <span className="font-mono text-[9px] font-medium uppercase tracking-[1px] text-[var(--color-text-muted)]">
          {queueCount} {sidebarTab === 'queue' ? t('in_queue') || 'in queue' : t('archived') || 'archived'}
        </span>

        <div className="flex items-center gap-2">
          {/* Agent badges */}
          {totalOnline > 0 && (
            <div className="flex items-center">
              {visible.map((agent) => (
                <div
                  key={agent.userId}
                  className="w-5 h-5 rounded-full bg-[var(--color-bg-elevated)] border-[1.5px] border-[var(--color-bg-surface)] flex items-center justify-center font-mono text-[7px] font-bold text-[var(--color-text-secondary)] shrink-0 -ml-1.5 first:ml-0"
                  title={agent.name}
                >
                  {getInitials(agent.name)}
                </div>
              ))}
              {overflow.length > 0 && (
                <div
                  className="w-5 h-5 rounded-full bg-[var(--color-bg-elevated)] border-[1.5px] border-[var(--color-bg-surface)] flex items-center justify-center font-mono text-[7px] font-bold text-[var(--color-text-muted)] shrink-0 -ml-1.5"
                  title={overflow.map((a) => a.name).join(', ')}
                >
                  +{overflow.length}
                </div>
              )}
            </div>
          )}

          {/* Capacity */}
          <div className="flex items-center gap-1">
            <span className="w-[5px] h-[5px] rounded-full bg-[var(--color-accent-green)]" />
            <span className="font-mono text-[9px] font-bold text-[var(--color-accent-green)]">
              {availableCount} / {totalOnline}
            </span>
          </div>
        </div>
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

Run: `docker compose exec client npx vitest run src/components/support/__tests__/SidebarFooter.test.tsx`
Expected: All 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/support/SidebarFooter.tsx client/src/components/support/__tests__/SidebarFooter.test.tsx
git commit -m "feat: add SidebarFooter with collapsible team panel and agent badges"
```

---

### Task 6: Rewire QueueSidebar

This is the integration task. Replace the old rendering in `QueueSidebar.tsx` with the new sub-components.

**Files:**
- Modify: `client/src/components/support/QueueSidebar.tsx`

- [ ] **Step 1: Read the current QueueSidebar file**

Read `client/src/components/support/QueueSidebar.tsx` fully before editing. You need the complete file in context for the Edit tool.

- [ ] **Step 2: Remove SavedViewPicker import and usage**

Remove these from `QueueSidebar.tsx`:
- The `import SavedViewPicker, { ViewFilters } from './SavedViewPicker';` line
- The `const { data: savedViews } = trpc.savedView.list.useQuery();` line
- The `function applyView(filters: ViewFilters)` function and the `useEffect` that reads `savedViews` for default view
- The `<SavedViewPicker ... />` JSX in the header

- [ ] **Step 3: Add new imports**

Replace the removed import with:

```typescript
import QueueTicketRow from './QueueTicketRow';
import ArchiveTicketRow from './ArchiveTicketRow';
import SidebarFooter from './SidebarFooter';
```

Remove these imports that are now handled by sub-components:
- `import SlaIndicator from '../SlaIndicator';`
- `import SentimentDot from '../SentimentDot';`
- `import { getStatusColors, getStatusI18nKey } from '../../utils/statusColors';`

Keep: `import { getTicketTime } from '../../utils/dateUtils';` (still used by search results).

- [ ] **Step 4: Remove the 'search' tab from sidebarTab state**

Change the `sidebarTab` state type from `'queue' | 'archive' | 'search'` to `'queue' | 'archive'`:

```typescript
const [sidebarTab, setSidebarTab] = useState<'queue' | 'archive'>('queue');
```

- [ ] **Step 5: Move search into Archive tab**

Move the search input to render inside the archive tab section (after department chips, before ticket list), only when `sidebarTab === 'archive'`. Update the search query's `enabled` condition accordingly:

```typescript
const searchResults = trpc.message.search.useQuery(
  { query: searchQuery, dept: filterDept === 'all' ? undefined : filterDept },
  { enabled: sidebarTab === 'archive' && searchQuery.length >= 2 }
);
```

- [ ] **Step 6: Replace tab row — 2 tabs instead of 3**

Replace the 3-tab `(['queue', 'archive', 'search'] as const).map(...)` with just 2 tabs:

```tsx
<div className="flex gap-1 mb-2">
  {(['queue', 'archive'] as const).map((tab) => (
    <button
      key={tab}
      onClick={() => setSidebarTab(tab)}
      className={`flex-1 text-[9px] font-bold uppercase py-1 border ${
        sidebarTab === tab
          ? 'bg-[var(--color-text-primary)] text-[var(--color-bg-base)] border-[var(--color-border)]'
          : 'border-[var(--color-border)] opacity-50'
      }`}
    >
      {t(tab)}
    </button>
  ))}
</div>
```

- [ ] **Step 7: Add search input inside archive section**

After the department chips, before the ticket list `<div>`, add the search input conditionally:

```tsx
{sidebarTab === 'archive' && (
  <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--color-border)]">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth="2">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
    <input
      type="text"
      aria-label="Search tickets"
      data-queue-search
      value={searchQuery}
      onChange={(e) => setSearchQuery(e.target.value)}
      placeholder={t('search_messages') || 'Search messages...'}
      className="flex-1 bg-[var(--color-bg-base)] border border-[var(--color-border)] px-2.5 py-1.5 font-mono text-[10px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)] placeholder:uppercase placeholder:text-[9px]"
    />
  </div>
)}
```

- [ ] **Step 8: Replace queue ticket list items with QueueTicketRow**

**Note:** The search results rendering (the `sidebarTab === 'search'` conditional) should be changed to render inside the archive tab when `searchQuery.length >= 2 && searchResults.data?.length`. The existing custom `<li>` rendering for search results stays as-is since search results have a different data shape (`messageId`, `text`, `senderName`) than tickets. Just move the conditional from `sidebarTab === 'search'` to `sidebarTab === 'archive' && searchQuery.length >= 2`.

Replace the existing `queueFiltered.map((ticket) => { ... })` block with:

```tsx
queueFiltered.map((ticket) => {
  const isOpen = supportOpenTickets.includes(ticket.id);
  // unreadTickets may store a number or boolean — normalize to number
  const unreadCount = Number(unreadTickets[ticket.id]) || 0;

  return (
    <QueueTicketRow
      key={ticket.id}
      ticket={ticket}
      isActive={activeTab === ticket.id}
      unreadCount={unreadCount}
      currentUserId={user?.id || ''}
      sentimentScore={sentimentMap?.[ticket.id]}
      onClick={() => (!atMaxChats || isOpen ? onSelectTicket(ticket) : undefined)}
      disabled={atMaxChats && !isOpen}
    />
  );
})
```

This requires `user` to be available. Add it to the component: get `user` from the store.

```typescript
const user = useStore((s) => s.user);
```

- [ ] **Step 9: Replace archive ticket list items with ArchiveTicketRow**

Replace the existing `archivedTickets.map((ticket) => { ... })` block with:

```tsx
archivedTickets.map((ticket) => (
  <ArchiveTicketRow
    key={ticket.id}
    ticket={ticket}
    isActive={previewTicketId === ticket.id}
    currentUserId={user?.id || ''}
    onClick={() => onPreviewArchived(ticket)}
  />
))
```

- [ ] **Step 10: Replace footer and team panel with SidebarFooter**

Remove the old footer `<div>` and the entire `{/* Online team status */}` section. Replace with:

```tsx
<SidebarFooter
  sidebarTab={sidebarTab}
  queueCount={sidebarTab === 'queue' ? queueFiltered.length : archivedTickets.length}
  onlineSupportUsers={onlineSupportUsers}
/>
```

- [ ] **Step 11: Remove the old header bookmark icon area**

In the header, remove the `<SavedViewPicker>` from the header row. The header row becomes just the title:

```tsx
<div className="header-row">
  <h2 className="mono-label">
    {sidebarTab === 'queue' ? t('queue') : t('archive')}
  </h2>
</div>
```

- [ ] **Step 12: Remove unused variables**

After removing the team panel, these are no longer needed in QueueSidebar:
- `availableCount` and `totalOnline` calculations
- `onlineSupportUsers` import from store (it's now used in SidebarFooter via props, but the store access stays in QueueSidebar since it passes it as a prop)

Actually, keep `onlineSupportUsers` — it's passed to `SidebarFooter` as a prop. Remove `availableCount` and `totalOnline` since the footer calculates those internally.

- [ ] **Step 13: Typecheck the full client**

Run: `docker compose exec client npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 14: Commit**

```bash
git add client/src/components/support/QueueSidebar.tsx
git commit -m "refactor: rewire QueueSidebar with new sub-components, 2-tab layout, remove SavedViewPicker"
```

---

### Task 7: Verify & Smoke Test

- [ ] **Step 1: Run all client tests**

Run: `docker compose exec client npm test`
Expected: All existing tests still pass. New tests pass.

- [ ] **Step 2: Run typecheck on both client and server**

Run: `docker compose exec client npx tsc --noEmit && docker compose exec server npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Visual smoke test**

1. Open the app in a browser
2. Log in as a support agent
3. Verify the queue sidebar:
   - 2 tabs: Queue and Archive (no Search tab)
   - No bookmark icon
   - Ticket rows show: dept badge, status dot, normal-case name, smart timestamp
   - Agent monogram badges appear for tickets with support participants
   - Your own badge is blue, others are gray
   - Hover over badges shows tooltip with full name
   - Unread tickets have blue tint background and count badge
   - Active ticket has blue left border
4. Switch to Archive tab:
   - Search input appears below department chips
   - Archived tickets show "Closed" badge
   - Rows are slightly dimmed
5. Footer:
   - Shows queue count + agent badges + capacity
   - Click footer to expand team panel
   - Click again to collapse
6. Test with multiple agents joined on a ticket — verify overlapping badges

- [ ] **Step 4: Final commit**

```bash
git commit --allow-empty -m "chore: queue sidebar redesign complete — verified"
```

---

## Summary

| Task | Component | Estimate |
|------|-----------|----------|
| 1 | `getSmartTimestamp` utility | 5 min |
| 2 | `AgentBadges` component | 10 min |
| 3 | `QueueTicketRow` component | 10 min |
| 4 | `ArchiveTicketRow` component | 5 min |
| 5 | `SidebarFooter` component | 10 min |
| 6 | Rewire `QueueSidebar` | 15 min |
| 7 | Verify & smoke test | 10 min |
| **Total** | | **~65 min** |
