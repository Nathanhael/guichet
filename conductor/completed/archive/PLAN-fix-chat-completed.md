# Fix Broken Agent-Support Chat

## Status: Completed

All issues outlined in the original plan have been addressed and resolved. The Playwright tests attempting to fix UI elements were reverted as requested, leaving just the core application fixes intact.

## Summary of Fixes

### 1. Database Schema
- **Issue**: `messages` table lacked `sender_role` and `sender_lang`.
- **Fix**: Added `senderRole` and `senderLang` columns to `server/db/schema.ts` and successfully generated and pushed the Drizzle migration (`0003_milky_meteorite.sql`).

### 2. Message Mapping Utility
- **Issue**: Inconsistent data structures between raw SQL queries and Drizzle, leading to frontend crashes or missing text.
- **Fix**: Created `server/utils/messageMapper.ts` that safely normalizes snake_case to camelCase and correctly constructs the `Message` object. This correctly maps `translated_text` -> `text`/`processedText` while preserving `originalText`.

### 3. Socket Handlers Refactor (`server/socket/handlers.ts`)
- **Fix (`ticket:history`)**: Updated history fetch to use `mapMessageRow` so historical messages load correctly.
- **Fix (`message:send`)**: Ensured `sender_role` and `sender_lang` are saved to the database. Made the emitted `message:new` payload perfectly match the client `Message` interface to prevent empty bubbles.
- **Fix (`ticket:new`)**: Forced the very first message sent during ticket creation to pass through the AI translation pipeline (`processMessage`) instead of skipping translation, ensuring consistent text behavior.
- **Added Events**: Hooked up missing Socket.IO handlers for:
  - `typing:start` and `typing:stop`
  - `message:delivered` and `message:read`

### 4. tRPC Router (`server/trpc/routers/message.ts`)
- **Fix**: Updated the `message.list` endpoint to also parse its row results through `mapMessageRow` to ensure frontend compatibility.

### 5. Frontend Optimistic Deduplication (`client/src/store/slices/messageSlice.ts`)
- **Issue**: React's strict mode and optimistic UI updates caused double messages because the client matched on `message.text` while the server returned `translated_text`.
- **Fix**: Updated `addMessage` in the Zustand store to strictly deduplicate based on `m.originalText === message.originalText`.

### 6. Frontend UI State Resets (`client/src/views/AgentView.tsx`)
- **Issue**: The form was being cleared immediately when the user hit submit, regardless of whether the socket request actually succeeded or was blocked by business hours.
- **Fix**: Moved `setLoading(false)` and text clearing into a `useEffect` that listens for the `ticket:created:self` or `error` / `hours:closed` callbacks.

### 7. Memory Leak Prevention (`client/src/hooks/useSocket.ts`)
- **Fix**: Added missing teardown instructions `s.off()` for `support:left`, `message:status`, and `queue:position` to prevent React strict mode re-renders from attaching duplicate listeners.

### 8. Backend Test Hotfixes
- **Fix (`gdpr.ts`)**: Added an `Array.isArray()` defensive check around `datesToAggregate` to prevent `.map` TypeErrors during Vitest runs where Drizzle mocked data wasn't an array.
- **Fix (`businessHours.ts`)**: Changed a rogue `expert_id` reference to `support_id` to fix SQL column crash during active ticket queue broadcast.
- **Fix (`app.ts`)**: Updated the `/config` endpoint to correctly fall back to `config.BUSINESS_HOURS_START` when a partner has `null` values, instead of returning literal `null` and failing tests.

### Verification
All 83 backend Vitest tests pass cleanly. `npm test` works properly inside the container.
