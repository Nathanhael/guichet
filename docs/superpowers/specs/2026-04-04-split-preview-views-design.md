# Split View & Preview Pane — Design Spec

## Overview

Add two new layout modes to SupportView: Split View (2-4 chats side-by-side) and Preview Pane (triage tickets without joining). Combined with existing Normal and Focus modes, agents get 4 layout options via a dropdown in NavToolbar.

## View Modes

| Mode | Layout | Queue Sidebar | Right Panel |
|---|---|---|---|
| **Normal** (default) | Queue + single chat + right panel | Visible | Visible |
| **Split** | Auto-arranged chats (2-4) | Auto-hidden (overlay toggle) | Hidden |
| **Preview** | Queue + preview card | Visible | Replaced by preview |
| **Focus** (existing) | Single chat only | Hidden | Hidden |

## Split View

### Auto Layout by Chat Count

- **2 chats** → equal 50/50 columns
- **3 chats** → primary chat (50%) + 2 secondary chats (25% each). Clicking a secondary swaps it to primary.
- **4 chats** → 2x2 grid. Clicking a chat gives it an active highlight border for typing.

### Split View Behavior

- Activates when `viewMode === 'split'` AND 2+ tabs are open.
- Falls back to Normal if only 1 tab open.
- Each chat panel has a compact header (agent name, dept badge) — no full header with labels/refs/SLA.
- Message input is active on all panels simultaneously.
- Queue sidebar auto-hides. Small hamburger button at left edge opens sidebar as overlay (absolute positioned, doesn't push chats).

## Preview Pane

### Summary Card Content

- Ticket metadata: department badge, agent name, labels, SLA indicator, created date
- Last 3 messages (read-only, not the full history)
- "Join" button to open the ticket as a full chat tab

### Preview Pane Behavior

- Activates when `viewMode === 'preview'`.
- Queue sidebar stays visible (primary navigation in this mode).
- Clicking a ticket in queue shows the preview card in the main area (no tab opened, no socket join).
- Joining switches to Normal mode automatically and opens the chat tab.

## View Mode Dropdown

- Icon button in NavToolbar replacing the current Focus toggle.
- Dropdown shows 4 options with simple layout icons (Unicode/CSS, no SVGs).
- Current mode highlighted.
- State stored in Zustand UI slice as `viewMode: 'normal' | 'split' | 'preview' | 'focus'`.

## Components

### New Components

| Component | File | Purpose |
|---|---|---|
| `ViewModeDropdown` | `components/support/ViewModeDropdown.tsx` | Dropdown in NavToolbar with 4 mode options |
| `SplitChatLayout` | `components/support/SplitChatLayout.tsx` | Container arranging 2-4 ChatWindows by count (equal/primary/grid) |
| `TicketPreviewCard` | `components/support/TicketPreviewCard.tsx` | Read-only summary card with metadata + last 3 messages + Join button |

### Modified Components

| Component | Changes |
|---|---|
| `SupportView.tsx` | Read `viewMode` from store, render appropriate layout |
| `NavToolbar.tsx` | Replace Focus toggle with `ViewModeDropdown` |
| `ChatWindow.tsx` | Add `compact` prop for split mode (smaller header, hide right panels) |
| `QueueSidebar.tsx` | Support overlay mode for split view (absolute positioned) |
| `store/slices/uiSlice.ts` | Add `viewMode` state + `setViewMode` action |

### No Backend Changes

Preview uses existing `trpc.message.list` for last 3 messages. Ticket data already available in store. No new endpoints needed.

## Edge Cases

- **Viewport < 768px in split mode** — falls back to Normal. Brief toast: "Split view requires a wider screen."
- **Tabs drop to 1 in split mode** — auto-switch to Normal.
- **Join from preview** — switches to Normal mode, opens chat tab.
- **0 tabs in split** — shows "Ready to support" empty state.
- **Focus from dropdown** — works exactly as before. Selecting another mode exits focus.
- **Browser resize** — split layout is CSS flex/grid based, responsive. 2x2 grid collapses to stacked columns below breakpoint.

## Styling

- Brutalist design tokens: no border-radius (except avatars), no shadows, no gradients.
- Split chat borders: `border-border-heavy` between panels.
- Active chat indicator: left border `accent-blue` (3px in primary/grid layouts).
- Compact chat header: `font-mono text-[9px]` for dept badge, `text-[11px]` for agent name.
- Preview card: `bg-bg-surface border border-border`, metadata in `font-mono text-[9px] uppercase`.
- Dropdown: `bg-bg-surface border-2 border-border-heavy`, same pattern as StatusPicker/Transfer menu.
