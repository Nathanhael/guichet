# Implementation Plan — tRPC Migration (Phase 3)

This plan outlines the third phase of migrating the M&P Support application to tRPC, focusing on **Insights & Engagement** (Stats and Feedback).

## Objective
*   Migrate complex dashboard statistics and AI summaries to typesafe tRPC procedures.
*   Centralize user feedback and expert ratings into the tRPC system.
*   Ensure full type safety for performance metrics and reporting.

## Proposed Changes

### 1. Backend: Stats Router
*   **Router**: `server/trpc/routers/stats.ts`
*   **Procedures**:
    *   `getGlobalStats`: Migration of the main `/api/stats` logic. 
        *   Inputs: `dateFrom`, `dateTo`, `dept`, `excludeWeekends`.
        *   Logic: Aggregates `daily_stats` (historical) and live `tickets`/`ratings`.
    *   `getLLMSummary`: Fetches automated AI summaries for specific periods.
        *   Inputs: `periodType`, `periodValue`.

### 2. Backend: Feedback & Ratings Routers
*   **Feedback Router**: `server/trpc/routers/feedback.ts`
    *   `list`: (Admin) Returns all feedback entries.
    *   `create`: (Protected) Allows any user to submit feedback.
    *   `markTreated`: (Admin) Updates the "treated" status of feedback.
*   **Rating Router**: `server/trpc/routers/rating.ts`
    *   `list`: (Admin/Expert) Returns all ticket ratings for analysis.

### 3. Frontend Refactor
*   **Admin Dashboard**:
    *   `AdminStats.tsx`: Replace `fetch('/api/stats')` with `trpc.stats.getGlobalStats.useQuery`.
    *   `LLMSummary.tsx`: Replace `fetch('/api/stats/summary')` with `trpc.stats.getLLMSummary.useQuery`.
*   **Feedback & Ratings**:
    *   `AdminFeedback.tsx`: Refactor to use `trpc.feedback.list`, `trpc.rating.list`, and `trpc.feedback.markTreated`.
    *   `FeedbackModal.tsx`: Refactor to use `trpc.feedback.create.useMutation`.

### 4. Final Cleanup
*   Remove `server/routes/stats.ts`.
*   Remove `server/routes/feedback.ts`.
*   Update `server/app.ts` to remove legacy ratings and stats middleware.

## Verification & Testing
*   **Dashboard Accuracy**: Compare metrics between legacy and tRPC versions to ensure aggregation logic is identical.
*   **Admin Security**: Verify that `getGlobalStats` and `feedback.list` are strictly blocked for non-admin users.
*   **AI Functionality**: Verify Topic Summaries and Staffing Demand reports still generate correctly via the LLM pipeline.
