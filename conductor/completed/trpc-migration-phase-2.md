# Implementation Plan — tRPC Migration (Phase 2) [COMPLETED]

This plan outlines the second phase of migrating the M&P Support application to tRPC, focusing on the core **Tickets** and **Messages** modules.

## Objective
*   Achieve 100% type safety for the core chat data flow.
*   Implement complex search, filtering, and pagination using **Drizzle ORM**.
*   Leverage **React Query** for efficient caching of ticket lists and message histories.

## Proposed Changes

### 1. Module Migration: Tickets
*   **tRPC Router**: Create `server/trpc/routers/ticket.ts`.
    *   `list`: Advanced query using Drizzle.
        *   Filters: `agentId`, `status`, `dept`, `search` (CDBID/Dare/Name), `dateRange`.
        *   Features: Support for pagination (limit/offset) and count for the Archive.
        *   Join: Efficiently join with `ticket_labels` to return label IDs.
    *   `getById`: Returns a single ticket with full metadata.
*   **Frontend Refactor**:
    *   `AgentView.tsx`: Replace manual `fetch` with `trpc.ticket.list.useQuery({ agentId: user.id })`.
    *   `ExpertView.tsx`: Replace manual `fetch` with `trpc.ticket.list.useQuery({ status: 'open' })`.
    *   `AdminArchive.tsx`: Replace manual `fetch` with paginated `trpc.ticket.list.useQuery`.

### 2. Module Migration: Messages
*   **tRPC Router**: Create `server/trpc/routers/message.ts`.
    *   `list`: (Protected) Returns messages for a specific `ticketId`.
        *   Access Control: Use `roleProcedure` or manual checks to ensure agents can't see whispers.
        *   Drizzle: Replace raw SQL with typed selection.
*   **Frontend Refactor**:
    *   `ChatWindow.tsx`: Use `trpc.message.list.useQuery({ ticketId })` for initial history load.
    *   `ExpertView.tsx`: Refactor preview fetching to use tRPC.

### 3. Backend Services & Utilities
*   **Online Status**: Create `server/trpc/routers/presence.ts`.
    *   `getOnlineStatus`: Procedure to replace `/api/online/:userId`.
*   **Sync Logic**:
    *   Maintain Socket.io for *real-time* pushes (new messages).
    *   Use React Query's `onSuccess` or direct cache manipulation to sync Socket events with the tRPC cache where beneficial.

## Verification & Testing
*   **Search Accuracy**: Test the Archive search with various CDBID and Dare Ref combinations.
*   **Role Enforcement**: Verify that an Agent attempting to call `message.list` for a ticket they don't own (or seeing whispers) is blocked.
*   **Performance**: Verify that switching between active chat tabs is near-instant due to React Query caching.
*   **Regression**: Ensure Socket.io events (ticket creation, new messages) still correctly update the local Zustand store.

## Phased Approach
1.  Implement `ticket.list` and migrate `AgentView`.
2.  Implement `message.list` and migrate `ChatWindow`.
3.  Migrate `ExpertView` and `AdminArchive` (completing pagination).
4.  Remove legacy `tickets.ts` and `messages.ts` routes.
