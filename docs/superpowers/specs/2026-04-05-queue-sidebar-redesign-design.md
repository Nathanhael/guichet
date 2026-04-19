# Queue Sidebar Redesign — Design Spec

**Date:** 2026-04-05
**Component:** `client/src/components/support/QueueSidebar.tsx`
**Scope:** Ticket row layout, tab structure, footer, team panel

## Summary

Redesign the SupportView queue sidebar to improve scanability, show who's working on each ticket, simplify the tab structure, and surface team presence in the footer.

## Decisions

### 1. Tab Structure: 2 Tabs (was 3)

- **Queue** — live open/pending tickets (unchanged behavior)
- **Archive** — closed/resolved tickets with a **search input built in**
- The standalone "Search" tab is removed. Search only exists inside Archive.

### 2. Ticket Row Layout (Queue Tab)

Each ticket row has two lines:

**Row 1 (top):** `[DEPT badge] [status dot] Agent Name .............. timestamp`
- Department badge: monospace 7px, blue border, uppercase (unchanged styling)
- Status dot: 6px circle — green for `open`, purple for `pending`
- Agent name: Inter 13px semibold, **normal case** (not uppercase). Truncates with ellipsis.
- Timestamp: monospace 9px, muted color, right-aligned
  - Smart relative format:
    - Today → `15:05`
    - Yesterday → `Yest 14:30`
    - This week → `Mon 15:05`
    - Older → `08 Mar`

**Row 2 (bottom):** `[agent badges] .............. [unread count]`
- Agent monogram badges: 20px circles, overlapping with -6px margin
  - Current user ("You"): blue background (`accent-blue`), white text
  - Other agents: `bg-elevated` background, `text-secondary` text
  - Hover shows tooltip with full name (positioned above badge)
  - Order: current user first, then others alphabetically
  - Only show badges for agents who have **joined** the ticket (from `ticket.participants` where role is support-like)
- Unread count: monospace 8px bold, blue background pill, right-aligned. Only visible when unread > 0.
- If no agents joined and no unread: row 2 still renders (for consistent spacing) but is empty.

**Row states:**
- **Active** (selected tab): 3px blue left border + subtle blue background tint (`rgba(59,130,246,0.06)`)
- **Unread**: subtle blue background tint (`rgba(59,130,246,0.04)`)
- **Active + Unread**: combined tint (`rgba(59,130,246,0.08)`)
- **Hover**: `bg-elevated`
- **At max chats + not joined**: `opacity-40`, `cursor-not-allowed`

### 3. Ticket Row Layout (Archive Tab)

Same 2-row layout as queue, with differences:
- Status dot replaced by a single **"Closed" status badge**: monospace 7px uppercase text, muted color, faint border. Both `closed` and `resolved` statuses render the same badge — the `resolved` status is defined in the DB enum but never produced by any user flow, so the UI treats them identically.
- Entire row at `opacity: 0.7`, full opacity on hover
- Agent badges still shown (who worked on the ticket)
- No unread count (irrelevant for archive)

### 4. Archive Search

- Search input rendered below department chips, only when Archive tab is active
- Input field: `bg-base`, border, monospace placeholder "SEARCH MESSAGES..."
- Search icon (14px magnifying glass) left of input
- Uses existing `trpc.message.search` query (enabled when query length >= 2)
- Results render using the same ticket row component

### 5. Footer

**Default (collapsed) state:**
`[queue count] .............. [agent badges] [+N] [capacity]`

- Left: queue/archive count — monospace 9px, muted, uppercase (e.g., "9 IN QUEUE" or "7 ARCHIVED")
- Right: team presence badges
  - Show first 4 online agent monogram badges (20px, overlapping)
  - If more than 4 online: show `+N` overflow count after the 4th badge
  - Hover on `+N` shows full list of remaining names
  - Green dot indicator + capacity count (e.g., "3 / 4")
- Entire footer row is clickable — toggles team panel open/closed

**Expanded state (team panel):**
- Opens above the footer row (pushes ticket list up)
- Shows existing team panel content: each agent with monogram avatar, name, status dot, status label
- "ONLINE TEAM" header with monospace label
- Capacity summary at bottom of panel
- Panel has top border
- Clicking footer row again collapses it

### 6. Removed Elements

- **"JOINED" badge** — replaced by agent monogram badges (blue = you)
- **Standalone Search tab** — merged into Archive
- **Unread dot** — replaced by unread count badge
- **Uppercase agent names** — now normal-case Inter
- **Team panel always visible** — now collapsible via footer
- **SavedViewPicker** — the bookmark icon and saved views dropdown are removed. With only 2 tabs and a few department chips, one-click filtering is fast enough. The `SavedViewPicker` component, `trpc.savedView.*` queries in the sidebar, and the default view auto-apply logic are all removed from `QueueSidebar.tsx`. The `SavedViewPicker.tsx` component file and `savedView` tRPC router remain in the codebase (they may be used elsewhere or re-purposed later) but are no longer imported or rendered in the sidebar.

### 7. No Changes

- Department filter chips (same layout, same behavior)
- SLA indicator on ticket rows (still shown when applicable)
- Max chats banner
- Sidebar width (320px) and collapse behavior
- Load more button in archive

## Data Requirements

**Agent badges need participant data per ticket.** The `ticket.participants` field (JSONB) already contains participant info with id, name, and role. Filter for support-like roles to show agent badges.

**Current user identification.** Compare participant IDs against `user.id` from the store to render the blue "self" badge.

**Smart timestamps.** Extend or adapt the existing `getTicketTime` utility in `utils/dateUtils.ts` to return the smart relative format:
- Today: time only (`HH:mm`)
- Yesterday: `Yest HH:mm`
- This week (2-6 days ago): `Mon HH:mm` (abbreviated day)
- Older: `DD MMM` (current format)

**Team presence for footer badges.** Already available via `onlineSupportUsers` from the store.

## Component Structure

The `QueueSidebar.tsx` file is currently 430 lines. The redesign touches most of it but doesn't add significant new complexity — it replaces elements more than adding them.

Suggested extraction to keep things focused:
- **`QueueTicketRow.tsx`** — new component for the ticket row (queue variant). Receives ticket, isActive, isUnread, currentUserId. ~60 lines.
- **`ArchiveTicketRow.tsx`** — archive variant of the row. Similar props minus unread. ~50 lines.
- **`SidebarFooter.tsx`** — footer with collapsed/expanded team panel. Receives queueCount, onlineSupportUsers, sidebarTab. ~80 lines.
- **`AgentBadges.tsx`** — shared component for rendering overlapping monogram badges with tooltips. Used in ticket rows and footer. ~40 lines.
- **`QueueSidebar.tsx`** — orchestrator, reduced to ~200 lines (filtering logic, tab state, layout shell).

## Mockups

Reference mockups at:
- `docs/superpowers/mockups/queue-sidebar-mockup.html` — v1 with message preview (rejected)
- `docs/superpowers/mockups/queue-sidebar-mockup-v2.html` — v2 final direction (approved)

## Brutalist Design Compliance

- All colors via CSS custom property tokens (no inline hex)
- No border-radius except avatar circles (`rounded-full`)
- No gradients, no shadows
- JetBrains Mono for UI chrome (badges, timestamps, dept labels, footer counts)
- Inter for content (agent names)
- No decorative animation. Hover state changes are instant.
- Tooltip appears instantly on hover (no delay, no fade)
