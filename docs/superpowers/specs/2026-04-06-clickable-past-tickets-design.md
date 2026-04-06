# Clickable Past Tickets — Design Spec

**Date:** 2026-04-06
**Scope:** Make past ticket rows in TicketSidebar clickable, opening a read-only message preview in the chat area.

## Problem

Past ticket rows in the TicketSidebar are display-only. Agents can see that a customer has prior history but cannot view the actual conversation without searching for it manually.

## Solution

Reuse the existing `TicketPreview` component with a new `readOnly` prop. When `true`, the action footer (Join/Close buttons) is hidden and the header badge shows "HISTORY" instead of "PREVIEW". No new components needed.

## User Flow

1. Agent clicks a past ticket row in TicketSidebar
2. TicketSidebar calls `onPreviewTicket(ticket)` callback
3. SupportView sets `previewTicket` state (same state used for queue previews)
4. Chat area renders `<TicketPreview ticket={...} readOnly onClose={...} />`
5. Messages load via `trpc.message.list`, rendered read-only with `MessageBubble`
6. Agent clicks "×" → returns to their active chat tab

## Changes

### 1. `client/src/components/TicketPreview.tsx`

- Add optional `readOnly?: boolean` prop to `TicketPreviewProps`
- When `readOnly` is true:
  - Hide the footer containing Join and Close Ticket buttons
  - Change the header badge from `preview_mode` to "HISTORY"
- `onJoin` becomes optional (not needed in read-only mode)

### 2. `client/src/components/support/TicketSidebar.tsx`

- Add `onPreviewTicket?: (ticket: Ticket) => void` prop to `TicketSidebarProps`
- Make past ticket rows clickable:
  - Add `cursor-pointer` class
  - Add hover state: `hover:bg-[var(--color-bg-elevated)]`
  - On click: call `onPreviewTicket(ticket)`

### 3. `client/src/views/SupportView.tsx`

- Pass `onPreviewTicket={setPreviewTicket}` prop to `<TicketSidebar>`
- In the TicketPreview render condition, pass `readOnly` when the preview ticket is not in the current open tickets list AND is closed/resolved:
  - `readOnly={previewTicket.status === 'closed' || previewTicket.status === 'resolved'}`
- Make `onJoin` a no-op for read-only previews

## Styling

- Past ticket rows: add `cursor-pointer hover:bg-[var(--color-bg-elevated)]` transition
- No other visual changes needed — TicketPreview already follows brutalist design tokens

## Out of Scope

- Navigating to past tickets as full chat tabs
- Modal/dialog overlay approach
- Message editing or any mutation in read-only mode
