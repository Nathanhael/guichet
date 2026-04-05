# Unified Right Sidebar — Design Spec

**Date:** 2026-04-05
**Scope:** Merge `CustomerInfoPanel` + `AiCopilotSidebar` into a single lean, collapsible sidebar in SupportView.

## Problem

The SupportView right side has two separate panels (`CustomerInfoPanel` at 272px + `AiCopilotSidebar` at ~280px) that duplicate information already visible in the ChatWindow header (agent name, status, department, labels, references) and contain disabled features (KB search, sentiment, quick tips). This wastes horizontal space and adds visual noise.

## Solution

Merge both panels into a single `TicketSidebar` component. Keep only actionable, non-duplicated content. Collapsed by default.

## Content (Expanded State)

### Section 1: PAST TICKETS

- Fetches agent's past tickets via `trpc.ticket.list` (excluding current ticket)
- Each row displays: department badge, status text, date
- Shows "No history" placeholder when empty
- Max 5 visible, no scroll needed for typical use

### Section 2: AI SUMMARY

- On-demand summary via `trpc.ai.summarizeChat` mutation
- Refresh button (circular arrow icon) to regenerate
- Shows "No summary yet" italic placeholder when empty
- **Conditionally rendered**: entire section hidden when partner AI is disabled (`aiConfig.enabled !== true`)

### Removed Content (with rationale)

| Removed | Reason |
|---------|--------|
| Agent avatar, name, online status | Visible in ChatWindow header |
| Department badge + ticket status | Visible in ChatWindow header |
| References (Order ID, External ID) | Visible in ChatWindow header |
| Labels | Visible in ChatWindow header |
| KB Search | Feature-gated (`knowledgeBase` in `DISABLED_FEATURES`) |
| Quick Tips | Static filler content, no value |
| Sentiment indicator | Feature disabled per partner AI config |

## Collapsed State (Default)

- **Width:** ~40px icon rail
- **Content:** `‹` chevron button + clock icon (representing past tickets/history)
- **Interaction:** Click anywhere on rail to expand
- **Styling:** `bg-[var(--color-bg-surface)]`, left border `1px border-[var(--color-border)]`

## Expanded State

- **Width:** 280px
- **Header:** `›` chevron button to collapse
- **Sections:** Stacked vertically with brutalist section headers (JetBrains Mono, uppercase, 10px, tracking-widest)
- **Scrollable:** `overflow-y-auto` on the content area below header

## State Persistence

- Collapsed/expanded boolean stored in Zustand UI slice (`rightSidebarExpanded`, default `false`)
- Persists across ticket tab switches within the same session

## Component Architecture

### New

- `client/src/components/support/TicketSidebar.tsx` — unified sidebar component

### Modified

- `client/src/views/SupportView.tsx` — replace `CustomerInfoPanel` + `AiCopilotSidebar` imports with single `TicketSidebar`
- `client/src/store/slices/uiSlice.ts` — add `rightSidebarExpanded` state + `toggleRightSidebar` action

### Deleted

- `client/src/components/support/CustomerInfoPanel.tsx` — absorbed into TicketSidebar
- `client/src/components/support/AiCopilotSidebar.tsx` — absorbed into TicketSidebar

## Styling Rules (Brutalist)

- CSS custom property tokens only (no inline colors)
- No border-radius, no shadows, no gradients
- Section headers: JetBrains Mono, uppercase, `text-[10px] tracking-widest`
- 1px borders via `var(--color-border)`
- No decorative animations; functional transitions only (≤150ms)

## Props

```typescript
interface TicketSidebarProps {
  ticket: Ticket;
}
```

## Out of Scope

- KB search (feature-gated)
- Sentiment indicator (disabled)
- Agent notes / scratchpad (future feature)
- Conversation timeline (future feature)
