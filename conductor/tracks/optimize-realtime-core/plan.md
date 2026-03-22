# Implementation Plan: Real-Time Core Optimization & Resilience

This plan outlines the refactoring of Tessera's real-time core to eliminate performance bottlenecks (Redis `KEYS` anti-pattern), enhance infrastructure resilience, and tune the Socket.io heartbeat for high-accuracy presence.

## 1. Objective
- Eliminate the blocking Redis `KEYS` command in the presence service.
- Improve system resilience to Redis connection failures.
- Enhance the accuracy of "Online/Offline" status indicators.
- Optimize database interaction for high-frequency socket events.

## 2. Key Files & Context
- `server/services/presence.ts`: Core presence logic using Redis hashes and the problematic `KEYS` command.
- `server/utils/redis.ts`: Redis client initialization and connection management.
- `server/app.ts`: Socket.io server configuration (CORS, heartbeat, etc.).
- `server/socket/handlers.ts`: Socket event entry points and database orchestration.

## 3. Implementation Steps

### Phase 1: Infrastructure Resilience (Redis & Socket.io)
1. **Redis Reconnection Logic**:
   - Update `server/utils/redis.ts` to include a `reconnectStrategy` in `createClient`.
   - Implement exponential backoff with a cap (e.g., max 3000ms) to ensure the server gracefully recovers from Redis restarts.
2. **Socket.io Heartbeat Tuning**:
   - Update `server/app.ts` to set `pingTimeout: 5000` and `pingInterval: 10000`.
   - This reduces the time to detect a disconnect from ~45s to ~15s.

### Phase 2: Presence Service Refactor (Performance)
1. **Redis Set-Based Tracking**:
   - Refactor `server/services/presence.ts` to use Redis Sets for tracking user IDs per partner: `partner:presence:{partnerId}`.
   - Update `identifyUser`:
     - Scope the user hash key to include partner ID: `presence:{partnerId}:{userId}`.
     - Add the `userId` to the Redis Set `partner:presence:{partnerId}` using `SADD`.
   - Update `decrementUserCount`:
     - When a user's connection count reaches 0, remove the `userId` from the partner Set using `SREM`.
   - Update `broadcastOnlineSupport` and `getOnlineUsersForPartner`:
     - Use `SMEMBERS partner:presence:{partnerId}` to retrieve only the relevant user IDs.
     - Use Redis Pipelining to fetch all relevant user hashes in a single batch.
     - Replace `KEYS presence:*` with the Set retrieval, eliminating the $O(N)$ blocking scan.
2. **Stale Set Cleanup**:
   - Individual hash keys already have a 24h TTL, but Redis Sets don't expire per-member. If the server crashes, orphaned members remain in the Set.
   - Add a periodic cleanup job (e.g., every 15 minutes) that iterates each `partner:presence:{partnerId}` Set, checks whether the corresponding `presence:{partnerId}:{userId}` hash still exists, and removes stale members via `SREM`.
   - Alternatively, set a TTL on the `partner:presence:{partnerId}` Set itself and refresh it on each `SADD`.
3. **Fix Existing Multi-Partner Presence Bug**:
   - The current key format `presence:{userId}` means a user logged into two different partners simultaneously has their first partner's data overwritten by the second. The new `presence:{partnerId}:{userId}` format resolves this — call it out as a bug fix, not just a performance improvement.
4. **Fix `any` Types**:
   - Replace `any[]` in `broadcastOnlineSupport` with the `OnlineUser` interface (or a narrower type).
   - Replace `any` types on Redis clients in `server/utils/redis.ts` with proper `RedisClientType` from the `redis` package.
5. **Update `setUserStatus`**:
   - Add `partnerId` parameter to `setUserStatus` so it uses the new scoped key `presence:{partnerId}:{userId}` instead of `presence:{userId}`.
   - Update `decrementUserCount` to also accept `partnerId` (needed for the new key format and for `SREM` from the partner Set).

### Phase 3: Socket Handler Alignment & Cleanup
1. **Update `disconnect` handler**:
   - Pass `socket.data.partnerId` to `decrementUserCount` so it can locate the correct scoped presence key and remove the user from the partner Set.
2. **Update `status:set` handler**:
   - Pass `socket.data.partnerId` to `setUserStatus` to match the new key format.
3. **Narrow `message:send` ticket query**:
   - Replace `SELECT * FROM tickets WHERE id = $1` (fetches all columns) with `SELECT status, partner_id FROM tickets WHERE id = $1` — only the two fields actually used.
   - Remove the `as any` cast and add a proper typed interface.
4. **Fix `any` types throughout handlers**:
   - `activeTickets` (line ~163) — replace `any[]` with `{ id: string }[]`.
   - Messages query in `support:join` (line ~252) — replace `as unknown as any[]` with proper `MessageRow[]` type.
   - Ticket query in `message:send` (line ~307) — replace `as any` with a typed interface.
5. **Fix fragile JSONB participant matching**:
   - `socket:identify` (line ~167) uses `LIKE '%userId%'` to match participants in a JSONB column. Replace with proper JSONB operator (`participants::jsonb @> ...` or a JSONB array contains check) to avoid false matches on partial UUIDs.

## 4. Verification & Testing
- **Presence Test**: Verify that opening/closing multiple tabs for the same user correctly updates the "Online" count and status.
- **Cross-Partner Test**: Verify that a user active in two different partners (different tabs/workspaces) has independent presence tracking.
- **Resilience Test**: Briefly restart the Redis container and verify that the Node.js server reconnects and presence tracking resumes.
- **Performance Verification**: (Optional) Use `redis-cli --monitor` to ensure `KEYS` is no longer being called during presence updates.
