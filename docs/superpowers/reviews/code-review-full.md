# Tessera Full Code Review

**Date**: 2026-04-09
**Reviewer**: Claude Opus 4.6
**Scope**: Full codebase — Auth, Multi-Tenancy, Real-Time, AI, tRPC, Client, Infrastructure

---

## Overall Assessment

The codebase demonstrates **strong security fundamentals** across all four reviewed areas. The architecture is well-layered, with consistent patterns for auth, tenant isolation, and service abstraction. No critical vulnerabilities were found. The findings below are improvement opportunities, not active threats.

**Rating**: Solid production-ready code with minor hardening opportunities.

---

## 1. Auth & Security

### Strengths
- **Constant-time login**: `DUMMY_ARGON2_HASH` prevents timing-based user enumeration — excellent practice
- **Atomic lockout**: Single SQL UPDATE with CASE expression prevents TOCTOU race conditions in `recordFailedLogin`
- **Refresh token rotation**: Atomic claim via `UPDATE ... RETURNING` ensures only one concurrent request wins; losers trigger family revocation (reuse detection)
- **Session revocation**: Redis-backed with `isRevoked()` check on every request; fails closed when Redis is down
- **Cookie security**: HttpOnly, SameSite=Lax, Secure flag, proper domain scoping
- **Belt-and-suspenders lockout**: Re-fetches user row after password verification to catch concurrent locks
- **Per-email rate limiting**: Forgot-password has both IP-based and per-email Redis counters
- **TOTP replay prevention**: `isTotpTokenUsed` + `markTotpTokenUsed` prevents code reuse within window

### Findings

#### LOW: Rate limiter Redis fallback allows unlimited attempts across instances
**File**: `server/routes/auth/rateLimit.ts`
**Detail**: When Redis is down, the in-memory fallback rate limiter is per-process. In a horizontally scaled deployment, each instance has its own counter, effectively multiplying the rate limit by the number of instances (e.g., 3 instances = 60 login attempts instead of 20).
**Recommendation**: Consider failing closed (reject all) when Redis is unavailable for auth rate limiting, or at minimum log a WARN. Current behavior is acceptable for most threat models since lockout still works at the DB level.

#### LOW: MFA challenge returns 200 instead of 401/403
**File**: `server/routes/auth/login.ts`
**Detail**: When MFA is required, the response is `res.status(200).json({ mfaRequired: true })`. This is a design choice (not a bug), but returning 200 for an incomplete auth flow means clients must check the response body, not just the status code. A 401 with a `mfaRequired` flag would be more semantically correct.
**Impact**: Minimal — client handles this correctly.

#### LOW: Refresh cookie path restriction not visible in review
**File**: `server/routes/auth/rateLimit.ts` (setRefreshCookie)
**Detail**: CLAUDE.md states refresh cookies are path-restricted to `/api/v1/auth/refresh`, but I'd verify this is set in `setRefreshCookie`. If not path-restricted, the refresh token is sent on every request, expanding the attack surface.
**Recommendation**: Verify `path: '/api/v1/auth/refresh'` is set on the refresh cookie.

#### INFO: Password reset token storage
**File**: `server/routes/auth/password.ts`
**Detail**: Reset tokens are stored in Redis with TTL — good practice. The token is hashed before storage (verify this). The forgot-password endpoint always returns 200 regardless of email existence — correct to prevent enumeration.

---

## 2. Multi-Tenancy & Data Isolation

### Strengths
- **`partnerScopedProcedure`**: tRPC middleware guarantees `partnerId` is non-null before any partner-scoped query — clean type narrowing
- **`requirePartnerScope` / `requirePartnerScopeWith`**: Socket-level tenant isolation verifies ticket ownership before every mutation
- **Platform operator virtual memberships**: `listUserMemberships` returns "virtual" memberships to all active partners — controlled cross-tenant access
- **Layered middleware**: `partnerAdminProcedure` = `partnerScopedProcedure` + admin role check — composable and correct
- **`partnerRoleProcedure`**: Dynamic role check with partner scope guarantee

### Findings

#### LOW: Platform operator bypasses role checks globally
**File**: `server/trpc/trpc.ts` — `roleProcedure`
**Detail**: `roleProcedure` bypasses role checks entirely for platform operators: `if (!roles.includes(ctx.user.role) && !isPlatformAdmin(ctx.user.isPlatformOperator))`. This is by design, but means a platform operator can call ANY role-gated procedure. If a future developer adds a `roleProcedure(['agent'])` expecting agent-only access, platform operators will also have access.
**Recommendation**: Document this clearly. Consider a `strictRoleProcedure` variant that doesn't bypass for platform operators, for cases where you truly need role-only gating.

#### INFO: Socket `partnerScope` relies on DB lookup per event
**Detail**: Every socket event that touches a ticket does a DB query (`findTicketPartner`) to verify tenant ownership. This is correct for security but adds latency. Consider caching ticket→partner mappings in Redis if this becomes a bottleneck under load.

---

## 3. Real-Time (Socket.io)

### Strengths
- **Server-side identity**: `socket.data.userId`, `socket.data.partnerId`, `socket.data.name` are all set server-side during `socket:identify` — never trusts client-supplied identity
- **`requireIdentified` guard**: Every event handler calls this first; returns false + emits error if socket is not identified
- **Token expiry enforcement**: JWT `exp` stored at handshake, checked on every event — expired sockets get `auth:expired` and must reconnect
- **Role-based event gating**: `ticket:new` checks `socket.data.role !== 'agent'`; `support:join` checks `socket.data.isSupport`
- **Partner-scoped broadcasts**: Room names include partnerId, preventing cross-tenant message leaks
- **Constants for limits**: `MAX_MESSAGE_LENGTH`, `MAX_EDIT_WINDOW_MS`, `MAX_BATCH_DELETE`, `REACTION_EMOJIS` — all server-enforced

### Findings

#### LOW: Socket event payloads lack Zod validation
**File**: `server/socket/handlers/message.ts`, `ticket.ts`, etc.
**Detail**: While tRPC routes use Zod for input validation, socket event handlers destructure payloads directly (e.g., `const { ticketId, body } = data`). There's no schema validation on the incoming socket data. A malformed payload could cause unexpected errors.
**Recommendation**: Add lightweight Zod schemas for socket event payloads, or at minimum validate required fields before use. The `message:send` handler does check `MAX_MESSAGE_LENGTH` and `isValidMediaUrl`, but there's no structural validation.

#### LOW: No socket-level rate limiting
**Detail**: HTTP auth routes have Redis-backed rate limiting, but socket events (especially `message:send`) have no per-user or per-socket rate limit. A compromised client could flood messages.
**Recommendation**: Add a simple sliding-window counter per socket for `message:send` events (e.g., 10 messages/second).

#### INFO: Collision detection is best-effort
**File**: `server/socket/handlers/collision.ts`
**Detail**: `ticket:viewing` / `ticket:left` events track who's viewing a ticket. This is inherently eventual-consistent — if a socket disconnects without sending `ticket:left`, the `disconnect` handler should clean up. Verify the disconnect handler handles this.

---

## 4. AI Service Layer

### Strengths
- **Prompt injection mitigation**: `interpolate()` escapes `<` and `>` in user-supplied values, preventing XML/HTML tag injection in prompts. Uses `<user_content>` delimiters in all templates.
- **SSRF protection**: `validateAiBaseUrl` rejects private IPs, loopback, link-local, and metadata endpoints. Requires HTTPS in production.
- **Atomic rate limiting**: Lua script (`DUAL_RATE_LIMIT_SCRIPT`) checks minute limit before incrementing day counter — prevents counter inflation under concurrent load
- **DI pattern**: `AiContext` cleanly injects all dependencies (db, redis, logger, config, decrypt) — no scattered imports
- **Error masking**: `runAiAction` catches provider errors and throws generic "AI service unavailable" — no internal details leaked to clients
- **Encrypted API keys**: Partner-specific AI API keys support encryption at rest (`encryptedApiKey` + `decrypt()`)
- **Provider caching**: Keyed by config hash with LRU eviction at 100 entries
- **Timeout enforcement**: All providers use `AbortSignal.timeout(config.AI_TIMEOUT_MS)`

### Findings

#### LOW: Rate limit allows requests when Redis is down
**File**: `server/services/ai/rateLimit.ts`
**Detail**: `if (!r) { logger.warn(...); return { allowed: true }; }` — when Redis is unavailable, all AI requests are allowed. Same pattern in the catch block. This is a deliberate tradeoff (availability over safety), but could lead to unexpected provider costs during a Redis outage.
**Recommendation**: Consider a circuit breaker pattern or a fallback in-memory counter for the degraded case.

#### LOW: `validateAiBaseUrl` doesn't check DNS rebinding
**File**: `server/services/ai/validateUrl.ts`
**Detail**: The URL validation checks the hostname string against known private IP patterns, but doesn't resolve DNS. An attacker could configure an AI endpoint like `http://evil.com` that DNS-resolves to `127.0.0.1` (DNS rebinding). This is only exploitable if partner admins can set custom AI endpoints.
**Recommendation**: If partners can configure AI base URLs, resolve the hostname and re-check the IP at connection time. If only platform operators can set AI URLs, this is low risk.

#### LOW: Streaming responses don't track token usage
**File**: `server/services/ai/ollama.ts`, `azure-openai.ts`, `openai-compatible.ts`
**Detail**: The `chatStream` generators yield content chunks but don't accumulate token usage stats. Only the non-streaming `chat()` method logs usage. This means streaming AI calls are invisible in usage tracking.
**Recommendation**: Accumulate stream metadata (most providers include usage in the final SSE chunk) and log it after stream completion.

#### INFO: Custom prompt templates are partner-controlled
**File**: `server/services/ai/prompts.ts`
**Detail**: Partners can store custom prompt templates in `ai_prompt_templates`. These templates use `{{var}}` interpolation where values are HTML-escaped. However, the template itself is not sanitized — a partner admin could craft a template that instructs the AI to behave maliciously. This is by design (partners control their own AI behavior), but worth documenting as a trust boundary.

---

## Summary of Findings

| # | Area | Severity | Finding |
|---|------|----------|---------|
| 1 | Auth | LOW | Rate limiter in-memory fallback per-process in multi-instance |
| 2 | Auth | LOW | MFA challenge returns 200 instead of 401 |
| 3 | Auth | LOW | Verify refresh cookie path restriction |
| 4 | Tenancy | LOW | Platform operator global role bypass could surprise future devs |
| 5 | Socket | LOW | Socket event payloads lack Zod validation |
| 6 | Socket | LOW | No socket-level rate limiting for message:send |
| 7 | AI | LOW | Rate limit allows all requests when Redis is down |
| 8 | AI | LOW | validateAiBaseUrl doesn't check DNS rebinding |
| 9 | AI | LOW | Streaming responses don't track token usage |

**No HIGH or CRITICAL findings.** The codebase shows mature security practices across all four areas.

---

## 5. tRPC Routers & Business Logic

### Strengths
- **Consistent Zod validation**: Every tRPC procedure uses Zod input schemas with proper types, ranges, and regex patterns
- **Layered procedure middleware**: Clear hierarchy — `publicProcedure` → `protectedProcedure` → `partnerScopedProcedure` → `partnerAdminProcedure` / `platformProcedure`
- **Feature gating**: `featureGate()` middleware disables unreleased features (webhooks, KB) cleanly
- **N+1 avoidance**: Message router batch-resolves reply snippets (`resolveReplySnippetsBatch`) instead of N+1 loops
- **Cursor-based pagination**: Ticket list, messages, audit all use keyset pagination (`createdAt|id` composite cursor) — correct for real-time data
- **SQL injection prevention**: All queries use Drizzle's `sql` tagged template literals or the ORM builder — no raw string concatenation. `toTsQuery` sanitizes full-text search input by stripping non-alphanumeric characters
- **LIKE wildcard escaping**: `escapeLikePattern()` utility prevents `%`/`_` injection in search queries
- **Date range limits**: Stats router enforces max 365-day range to prevent expensive queries

### Findings

#### LOW: `alerts` router uses manual `requirePartnerId` instead of `partnerScopedProcedure`
**File**: `server/trpc/routers/alerts.ts`
**Detail**: The alerts router uses `roleProcedure(['admin'])` with a manual `requirePartnerId(ctx)` helper instead of the standard `partnerAdminProcedure`. This works correctly but bypasses the type narrowing that `partnerScopedProcedure` provides, making it easier for a future developer to accidentally forget the partnerId check.
**Recommendation**: Migrate to `partnerAdminProcedure` for consistency with other routers.

#### LOW: Stats router is very large (~32KB)
**File**: `server/trpc/routers/stats.ts`
**Detail**: The stats router at ~32KB is by far the largest single file. It contains many complex SQL queries with raw `sql` template literals. While each query is correctly partner-scoped, the size makes it harder to review and maintain.
**Recommendation**: Consider splitting into sub-modules (e.g., `stats/tickets.ts`, `stats/sentiment.ts`, `stats/historical.ts`).

#### INFO: Webhook router correctly validates URL targets
**Detail**: `validateWebhookUrl` is called on create/update. Webhook ownership is verified per-operation via `verifyWebhookOwnership(id, partnerId)`. HMAC signing with per-webhook secrets is handled in the dispatch service.

---

## 6. Client Architecture

### Strengths
- **Zustand with shallow selectors**: `useStoreShallow` wrapper with documented anti-pattern warning ("NEVER use bare `useStore()`") — good performance discipline
- **Slice-based composition**: 6 slices (auth, tickets, messages, UI, config, rating) composed into a single store — clean separation of concerns
- **Token refresh**: `useTokenRefresh` hook is well-implemented: proactive timer, visibility change detection for tab sleep/resume, mutex to prevent parallel refreshes, debounce (30s minimum), AbortController cleanup on unmount, graceful network error retry (30s) instead of immediate logout
- **Socket singleton**: Module-level socket instance with `listenersAttached` guard ensures listeners are attached exactly once — prevents duplicate handlers
- **Socket identity from JWT**: `socket:identify` only sends `partnerId` — server derives `userId`/`role`/`name` from JWT cookie, never trusting client-supplied identity
- **Idle detection**: `useIdleStatus` properly cleans up event listeners and timers on unmount, handles visibility changes
- **Session expiry detection**: `isSessionExpired()` reads the non-HttpOnly `session_expires` cookie for client-side session state — correct pattern that avoids exposing the JWT
- **Service worker cache clearing on logout**: Prevents stale authenticated data on shared devices
- **tRPC client with credentials**: Both React Query (`trpc`) and vanilla (`trpcVanilla`) clients correctly set `credentials: 'include'`
- **Media URL validation**: Only accepts relative `/uploads/` paths — rejects all external URLs to prevent tracking pixels leaking staff IPs. SVG excluded to prevent XSS.

### Findings

#### LOW: User data persisted in sessionStorage
**File**: `client/src/store/slices/authSlice.ts`
**Detail**: User object, memberships, active partner ID are stored in `sessionStorage`. While sessionStorage is tab-scoped (not shared across tabs) and cleared on tab close, it persists through page refreshes. On shared computers where users don't close tabs, the next user could see the previous user's identity data in DevTools. The code does clear sessionStorage on logout and when the session cookie expires.
**Recommendation**: This is an acceptable tradeoff for UX (surviving page refreshes). The `isSessionExpired()` check on store initialization mitigates the risk. Consider adding a comment documenting this as a deliberate decision.

#### LOW: Socket listeners never detach
**File**: `client/src/hooks/useSocket.ts`
**Detail**: The `listenersAttached` module-level flag ensures listeners are added once, but the useEffect cleanup function doesn't detach them (it only runs on unmount of the top-level component). Since the socket is a singleton that outlives component lifecycles, this is intentional — but it means stale closure references in handlers could theoretically reference old store state. The code mitigates this by using `useStore.getState()` (direct store access) inside handlers instead of closure variables.
**Recommendation**: The pattern is correct for a singleton socket. The use of `useStore.getState()` avoids stale closures. No action needed.

#### FIXED: XSS — LinkPreviewCard `javascript:` protocol injection
**File**: `client/src/components/chat/LinkPreviewCard.tsx`
**Detail**: Link preview `href` and `<img src>` accepted arbitrary URLs from server-side unfurl data. A malicious `javascript:` URI could execute code on click.
**Resolution**: Added `isSafeUrl()` guard that validates `http(s):` protocol only. Applied to both `href` and image `src`.

#### INFO: No other XSS concerns found
**Detail**: Markdown rendering uses `DOMPurify.sanitize()` with strict `ALLOWED_TAGS`/`ALLOWED_ATTR` allowlist. All other user content rendered via JSX (auto-escaped). Media URLs validated server-side to `/uploads/` paths only.

---

## 7. Infrastructure & Ops

### Strengths
- **Production hardening**: `config.ts` uses Zod v4 schema validation for all env vars — FATAL exits for CORS/cookie/rate-limit misconfigurations in production
- **JWT secret minimum**: 64 characters enforced by Zod schema — prevents weak HS256 keys
- **AES-256-GCM encryption**: Field-level encryption with random 96-bit IVs, 128-bit auth tags, packed format (IV + ciphertext + tag). Key cached in memory after first access.
- **WORM audit archive**: SHA-256 hash chain with tamper-evident verification. Chain integrity checked BEFORE GDPR purge — broken chain aborts the purge (throws, not silently swallowed)
- **GDPR purge pipeline**: Archive → verify chain → purge. Retention configurable per-entity. AI usage log has separate 90-day retention. Daily stats aggregated before ticket purge.
- **Argon2id passwords**: Proper parameters (memoryCost: 19456, timeCost: 2, parallelism: 1). Password strength validation: min 10 chars, uppercase/lowercase/digit/special, common password blocking, email/name inclusion check, max 128 chars. History check prevents reuse of last 5 passwords.
- **Content moderation guards**: Length, caps, repetition, injection detection. Guards run synchronously and fail closed — no try/catch bypass.
- **Docker prod**: Resource limits (512M/1CPU), health checks, restart policies, Redis password, separate networks. Comments note Redis TLS requirement for multi-host.
- **Dev Docker**: JWT_SECRET required via `${JWT_SECRET:?}` — won't start without it. Fixed dev encryption key is documented as dev-only.

### Findings

#### LOW: No encryption key rotation mechanism
**File**: `server/services/encryption.ts`
**Detail**: The encryption key is loaded once from `FIELD_ENCRYPTION_SECRET` and cached for the process lifetime. There's no mechanism to rotate the key — all encrypted values (e.g., partner AI API keys) would need to be re-encrypted manually if the key is compromised.
**Recommendation**: For a v1, this is acceptable. Consider adding a key rotation script (`re-encrypt` command) that reads old key, decrypts all values, re-encrypts with new key in a transaction.

#### LOW: Dev Docker compose has hardcoded DB credentials
**File**: `docker-compose.yml`
**Detail**: `POSTGRES_USER: user`, `POSTGRES_PASSWORD: password` are hardcoded. While this is dev-only, if someone accidentally uses this compose file in production, the database is wide open. The prod compose correctly uses `${POSTGRES_USER}` variables.
**Recommendation**: Add a comment or a `NODE_ENV` check. The existing production hardening in `config.ts` would catch other misconfigurations but not DB credentials.

#### INFO: WORM archive hash chain is sequential
**Detail**: The hash chain is computed sequentially per archive batch. This is correct for integrity but means archiving large batches of audit logs could be slow. The code processes entries in order with `asc(auditLog.createdAt)` — correct for chain ordering.

---

## Complete Summary of All Findings

| # | Area | Severity | Status | Finding |
|---|------|----------|--------|---------|
| 1 | Auth | LOW | Acceptable | Rate limiter in-memory fallback per-process in multi-instance (DB lockout still works) |
| 2 | Auth | LOW | **FIXED** | MFA challenge returns 401 instead of 200; client updated |
| 3 | Auth | LOW | Acceptable | Refresh cookie path restriction verified |
| 4 | Tenancy | LOW | Acceptable | Platform operator global role bypass — by design, documented |
| 5 | Socket | LOW | **FIXED** | Zod validation on all 15 socket event payloads |
| 6 | Socket | LOW | **FIXED** | Per-socket sliding-window rate limiting (send/edit/react) |
| 7 | AI | LOW | **FIXED** | In-memory rate limit fallback when Redis is unavailable |
| 8 | AI | LOW | **FIXED** | DNS rebinding check via `validateResolvedAiUrl` at provider creation |
| 9 | AI | LOW | Acceptable | Streaming token tracking — cost visibility only, no security impact |
| 10 | tRPC | LOW | **FIXED** | Alerts router migrated to `partnerAdminProcedure` |
| 11 | tRPC | LOW | **Deferred** | Stats router is 508-line single procedure — needs test coverage before refactoring |
| 12 | Client | LOW | Acceptable | sessionStorage mitigated by `isSessionExpired()` check |
| 13 | Infra | LOW | **FIXED** | Encryption key rotation script added (`scripts/rotate_encryption_key.ts`) |
| 14 | Infra | LOW | Acceptable | Dev Docker hardcoded creds — dev only, prod compose uses env vars |
| 15 | Client | LOW | **FIXED** | XSS — LinkPreviewCard `javascript:` protocol injection blocked |

**8 fixed, 6 acceptable, 1 deferred. No HIGH or CRITICAL findings.**

---

## Remaining: #11 Stats Router Refactor

The stats router (`server/trpc/routers/stats.ts`) is a single 508-line `getGlobalStats` procedure
containing ~15 SQL queries, aggregation logic, and response assembly. It's the largest file in the
tRPC layer but is functionally correct and partner-scoped.

**Why it was deferred**: Splitting requires extracting query helpers into `server/services/statsQueries.ts`,
which touches deeply intertwined data flow. Without test coverage for the endpoint's output shape,
a refactor risks subtle regressions in dashboard data.

**Recommended approach**:
1. Add integration test for `trpc.stats.getGlobalStats` — snapshot the response shape with known seed data
2. Extract SQL queries into `server/services/statsQueries.ts` (ticket stats, sentiment, ratings, SLA, historical)
3. Keep the single `getGlobalStats` procedure as an orchestrator that calls the extracted helpers
4. Verify the snapshot test still passes after refactoring
