# Server Services & Socket Handlers Code Review

**Reviewer**: Claude Opus 4.6 (Senior Code Reviewer)
**Date**: 2026-03-28
**Scope**: Socket.io handlers, server services, AI pipeline, DB schema

---

## Positive Observations

- **Server-side identity enforcement** is consistently applied. `socket.data.userId` is used as source of truth for `ticket:new` (L344), `rating:submit` (L545), and `message:send` (L580+). The prior security audit findings about client `agentId` have been addressed.
- **Tenant isolation** is robust across socket events. Every mutation event verifies `ticket.partner_id === socket.data.partnerId`.
- **ticket:transfer** properly validates `targetSupportId` via a membership JOIN against `callerPartnerId` (L757), preventing cross-tenant transfers.
- **AI rate limiting** uses Lua scripts for atomic INCR+EXPIRE, eliminating the TTL race condition.
- **Webhook SSRF protection** includes DNS resolution and private IP range blocking (127.x, 10.x, 172.16-31.x, 192.168.x, 169.254.x, ::1).
- **GDPR purge** archives audit log and tickets before deletion, with hash chain integrity verification.
- **Archive hash chain** uses SHA-256 with monotonic sequence numbers for deterministic ordering.
- **All AI providers** use `AbortSignal.timeout()` for request timeouts — no unbounded HTTP calls.
- **Disconnect cleanup** properly clears typing indicators, viewer tracking, and presence counts.

---

## CRITICAL Issues

### 1. Whisper Messages Broadcast to All Room Members Including Agents

**File**: `server/socket/handlers.ts`, L610
**Code**:
```
io.to(`ticket:${ticketId}`).emit('message:new', { ...whisper: !!isWhisper... });
```

Whisper messages (internal staff notes) are emitted to the entire `ticket:${ticketId}` room, which includes the agent (end-user). The `whisper` flag is set on the payload for client-side filtering, but a malicious client or custom WebSocket client can read all messages in the room regardless of the flag.

**Impact**: Agents can see internal staff whisper messages by ignoring the client-side filter.

**Fix**: Use Socket.io room segmentation. Emit whispers only to sockets where `socket.data.role` is `support`, `admin`, or `platform_operator`. Example:
```typescript
if (isWhisper) {
  // Emit only to support/admin sockets in the room
  const sockets = await io.in(`ticket:${ticketId}`).fetchSockets();
  for (const s of sockets) {
    if (canUseSupportWorkflows(s.data.role, s.data.authedIsPlatformOperator)) {
      s.emit('message:new', messagePayload);
    }
  }
} else {
  io.to(`ticket:${ticketId}`).emit('message:new', messagePayload);
}
```

### 2. Content Moderation Guards NOT Invoked on `message:send`

**File**: `server/socket/handlers.ts`, L578-620
**Evidence**: Search for `runGuards` in the `message:send` handler returns **no results**. The `runGuards` function from `guards.ts` is imported but never called in the message send path.

**Impact**: All content moderation (profanity, threats, discrimination, injection, repetition, length limits) is completely bypassed for socket-sent messages. The guard pipeline exists but is dead code for the primary message flow.

**Fix**: Add guard invocation before message insertion:
```typescript
const guardResult = await runGuards(redisClient, text, senderId);
if (!guardResult.ok) {
  return socket.emit('message:blocked', { code: guardResult.code });
}
text = guardResult.text; // Use sanitized text (e.g., caps fix)
```

---

## IMPORTANT Issues

### 3. AI Prompt Injection via Partner-Customizable Templates

**File**: `server/services/ai/prompts.ts`
**Issue**: Partners can store custom prompt templates in `ai_prompt_templates`. These templates use `{{text}}` placeholders that get interpolated with user message content. While built-in templates wrap user content in `<user_content>` tags, there is no enforcement that partner-custom templates do the same. A malicious admin could create a template without content boundaries, or the user content itself within `<user_content>` tags could still attempt injection.

**Fix**: Validate that custom templates contain `<user_content>` wrapper tags around all user-supplied variable placeholders. Add server-side validation on template save.

### 4. Rate Limit Increment-Before-Check Pattern Allows One Extra Request

**File**: `server/services/ai/rateLimit.ts`
**Issue**: The rate limiter increments both `minuteKey` and `dayKey` atomically, then checks limits and decrements if over. However, between the minute check passing and the day check executing, the day counter is already incremented. If the day limit is hit, the minute counter was still incremented (not decremented). Over time, this causes minute counts to drift upward.

**Fix**: Use a single Lua script that checks both limits atomically before incrementing either:
```lua
local mCount = tonumber(redis.call('GET', KEYS[1]) or '0')
local dCount = tonumber(redis.call('GET', KEYS[2]) or '0')
if mCount >= ARGV[1] then return {0, 'minute'} end
if dCount >= ARGV[2] then return {0, 'day'} end
-- Both OK, increment both
redis.call('INCR', KEYS[1])
if mCount == 0 then redis.call('EXPIRE', KEYS[1], 60) end
redis.call('INCR', KEYS[2])
if dCount == 0 then redis.call('EXPIRE', KEYS[2], 86400) end
return {1, 'ok'}
```

### 5. Ticket Viewer Tracking is In-Memory Only (No Horizontal Scaling)

**File**: `server/socket/handlers.ts`, top-level `ticketViewers` Map
**Code comment**: `// NOTE: In-memory only -- collision detection works per-instance.`

In a multi-instance deployment behind a load balancer, each server instance maintains its own viewer map. Agents on instance A cannot see viewers on instance B. This silently degrades collision detection without errors.

**Fix**: Migrate to Redis hash (`HSET ticket:viewers:{ticketId} socketId userData`). The codebase already uses Redis for presence tracking, so the pattern exists.

### 6. Webhook SSRF: DNS Rebinding Not Prevented

**File**: `server/services/webhookDispatch.ts`
**Issue**: The SSRF check resolves DNS at validation time (`isPrivateOrReservedIP`), but the actual `fetch()` call resolves DNS again. An attacker could configure a webhook URL that resolves to a public IP during validation but rebinds to `169.254.169.254` (cloud metadata) at dispatch time.

**Fix**: Resolve DNS once and connect to the resolved IP directly, or use the Node.js `dns.lookup` hook in the fetch agent to block private IPs at connection time.

### 7. AI Provider Cache Key Does Not Include API Key Hash

**File**: `server/services/ai/factory.ts`
**Issue**: The `cacheKey` function builds the key from `provider`, `baseUrl`, and `model`, but the `hashKey` function for API keys is only used when building the full cache key for per-partner configs. If a partner changes their API key but keeps the same provider/URL/model, they will continue using the cached provider with the old key until cache eviction.

**Fix**: Include the API key hash in all cache key computations.

---

## MINOR Issues

### 8. Guard Regex for Swearing Uses Global Flag with `test()` (Stateful)

**File**: `server/services/guards.ts`, L77-84
**Code**: `swearRegex.lastIndex = 0;` before `test()` -- this is correctly reset, so the issue is mitigated. Well done.

### 9. Presence Service Error Handling on Disconnect

**File**: `server/socket/handlers.ts`, L888-893
**Issue**: `presenceService.decrementUserCount()` is awaited but has no try/catch. If Redis is down during disconnect, the error propagates to the socket disconnect handler which may not have a catch.

**Fix**: Wrap in try/catch with logging.

### 10. `ticketViewers` Map Has No Size Limit

**File**: `server/socket/handlers.ts`
**Issue**: The `ticketViewers` map grows unbounded if sockets fail to emit `ticket:left` and the disconnect handler does not fire (network partition). Entries are only cleaned on disconnect or explicit leave.

**Fix**: Add periodic cleanup (e.g., every 5 minutes, remove entries for sockets that are no longer connected).

### 11. AI Usage Log Has No Retention Policy

**File**: `server/db/schema.ts`, `ai_usage_log` table
**Issue**: The `ai_usage_log` table grows indefinitely. The GDPR purge does not reference this table. Over time this becomes a performance and storage concern.

**Fix**: Add `ai_usage_log` cleanup to the daily purge or add a separate retention policy (e.g., 90 days).

### 12. Repetition Store TTL Not Configurable

**File**: `server/services/repetitionStore.ts`
**Issue**: The Redis TTL for repetition tracking is hardcoded. Different partners may need different repetition windows.

**Fix**: Accept TTL as a parameter or read from partner config.

---

## Summary

| Severity | Count | Key Areas |
|----------|-------|-----------|
| CRITICAL | 2 | Whisper visibility leak, Guards not invoked on message:send |
| IMPORTANT | 5 | AI prompt injection, Rate limit drift, In-memory viewers, DNS rebinding, Cache key |
| MINOR | 5 | Presence error handling, Viewer map cleanup, AI log retention, Repetition TTL, (Regex OK) |

The two CRITICAL issues should be addressed before the next release. The whisper leak is a confidentiality violation (staff notes visible to end-users), and the missing guard invocation means the entire content moderation pipeline is non-functional for real-time messages.
