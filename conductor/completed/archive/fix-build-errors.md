# Plan: Fix Docker Build and Application Bugs

## Objective
Fix server-side database query errors and client-side compilation errors to ensure a successful Docker build and a stable application.

## Key Files & Context
- `server/services/gdpr.ts`: PostgreSQL type mismatch in purge logic.
- `client/src/components/MessageBubble.tsx`: Unmatched `div` tag instead of `motion.div`.
- `client/src/components/admin/AdminFeedback.tsx`: Redundant `users` state redeclaration.
- `client/src/views/ExpertView.tsx`: Redeclared `previewMessages` and unmatched `aside` tag.

## Implementation Steps

### 1. Fix Server-Side Database Query
- In `server/services/gdpr.ts`, cast `daily_stats.date` to `text` in the `SELECT` query's `NOT IN` clause to match the `created_at::date::text` type.

### 2. Fix Client-Side Compilation Errors
- **MessageBubble.tsx**: Replace the closing `</div>` at line 251 with `</motion.div>`.
- **AdminFeedback.tsx**: Remove the `useState` for `users` and its corresponding `User[]` type, as it's already handled by tRPC's `usersData`.
- **ExpertView.tsx**: 
    - Remove the `useState` for `previewMessages`.
    - Rename `previewMessagesData` to `previewMessages` in the `trpc.message.list.useQuery` call.
    - Change the closing `</aside>` at line 775 to `</motion.aside>`.
    - Remove the extra closing brace `}` at the very end of the file.

### 3. Verify and Build
- Restart the Docker containers: `docker compose restart`.
- Check logs for any remaining errors: `docker compose logs -f server` and `docker compose logs -f client`.

## Verification & Testing
- **Server**: Ensure `GDPR purge complete` appears in logs without database errors.
- **Client**: Ensure Vite successfully compiles and the Expert View/Admin Feedback pages load without errors.
