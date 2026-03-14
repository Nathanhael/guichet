# Implementation Plan — tRPC Migration (Phase 1) [COMPLETED]

This plan outlines the first phase of migrating the Murmur application from raw REST/fetch to end-to-end typesafe tRPC. We will focus on the infrastructure and the "Labels" and "Canned Responses" modules.

## Objective
*   Eliminate manual type syncing between frontend and backend.
*   Implement robust caching and loading states using **React Query**.
*   Standardize database access using **Drizzle ORM** within tRPC procedures.

## Proposed Changes

### 1. Backend Infrastructure
*   **Install Dependencies**: `docker compose exec server npm install @trpc/server zod`.
*   **tRPC Context**: Create `server/trpc/context.ts` to handle authentication (extracting user from JWT).
*   **tRPC Base**: Create `server/trpc/trpc.ts` to define the base tRPC instance and protected procedures (middleware).
*   **Root Router**: Create `server/trpc/router.ts` to aggregate all sub-routers.
*   **Express Adapter**: Update `server/app.ts` to mount the tRPC router at `/api/trpc`.

### 2. Frontend Infrastructure
*   **Install Dependencies**: `docker compose exec client npm install @trpc/client @trpc/react-query @tanstack/react-query zod`.
*   **tRPC Client**: Create `client/src/utils/trpc.ts` to initialize the tRPC hooks.
*   **Provider Setup**: Update `client/src/main.tsx` to wrap the application in `QueryClientProvider` and `trpc.Provider`.

### 3. Module Migration: Labels
*   **tRPC Router**: Create `server/trpc/routers/label.ts`.
    *   `list`: (Public) Returns all labels using Drizzle.
    *   `create`: (Admin) Validates input with Zod, inserts via Drizzle, emits Socket.io event.
    *   `delete`: (Admin) Deletes label and ticket associations via Drizzle, emits Socket.io event.
*   **Frontend Refactor**: Update `client/src/components/admin/AdminLabels.tsx`.
    *   Replace `useState`/`useEffect`/`fetch` with `trpc.label.list.useQuery`.
    *   Replace `fetch` POST/DELETE with `trpc.label.create.useMutation` and `trpc.label.delete.useMutation`.

### 4. Module Migration: Canned Responses
*   **tRPC Router**: Create `server/trpc/routers/cannedResponse.ts`.
    *   `list`: (Authenticated) Returns all responses using Drizzle.
    *   `create`: (Admin) Validates and inserts via Drizzle.
    *   `delete`: (Admin) Deletes via Drizzle.
*   **Frontend Refactor**: Update `client/src/components/CannedResponsePicker.tsx` and related admin components to use tRPC hooks.

## Verification & Testing
*   **Compile-time Check**: Verify that changing a backend type (e.g., label color) immediately flags errors in the frontend components.
*   **Functional Check**:
    *   Log in as Admin and create/delete labels.
    *   Verify real-time updates (Socket.io) still trigger correctly when a label is added/removed.
    *   Test Canned Response picker in the chat window.
*   **Network Check**: Verify that requests are going to `/api/trpc/...` instead of `/api/labels`.

## Rollback Strategy
*   Keep existing Express routes (`/api/labels`, `/api/canned_responses`) active during the migration phase to avoid breaking other parts of the system.
*   Once all components are migrated, delete the legacy routes.
