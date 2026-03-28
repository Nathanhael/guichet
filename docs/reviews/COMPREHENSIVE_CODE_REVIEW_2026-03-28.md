# Comprehensive Code Review Report — 2026-03-28

**Reviewed by**: Claude Opus 4.6 (4 parallel review agents)
**Commit**: `8528a09` (HEAD)
**Scope**: Full codebase — server auth, tRPC routers, socket/services, client

---

## Executive Summary

| Severity | Count | Breakdown |
|----------|-------|-----------|
| **CRITICAL** | 10 | Auth: 3, tRPC: 3, Sockets/Services: 2, Client: 2 |
| **IMPORTANT** | 26 | Auth: 6, tRPC: 8, Sockets/Services: 5, Client: 7 |
| **MINOR** | 21 | Auth: 6, tRPC: 6, Sockets/Services: 5, Client: 4 |
| **Total** | **57** | |

The codebase is well-architected with mature security patterns (Argon2id, atomic lockouts, fail-closed Redis, TOTP replay prevention, HttpOnly cookies). However, this review uncovered **10 critical issues** that need immediate attention, particularly around socket-level data exposure, missing content moderation enforcement, SQL injection vectors, and multi-tenancy gaps.

---

## CRITICAL Issues (Fix Immediately)

### CR-01. Whisper Messages Broadcast to End-Users
**Area**: Socket Handlers | **File**: `server/socket/handlers.ts` ~L610
Whisper messages (internal agent notes) are emitted to the entire `ticket:{id}` room via `io.to()`, which includes the end-user. Client-side filtering is trivially bypassed by any WebSocket client.
**Fix**: Emit whispers only to sockets with support/admin roles using `fetchSockets()` filtering.

### CR-02. Content Moderation Guards Never Invoked
**Area**: Socket Handlers | **File**: `server/socket/handlers.ts` ~L578-620
`runGuards()` is imported but never called in the `message:send` handler. The entire guard pipeline (profanity, threats, discrimination, injection, repetition) is **dead code** for real-time messages.
**Fix**: Call `runGuards(messageBody)` before persisting/broadcasting messages.

### CR-03. SQL LIKE Injection in Search
**Area**: tRPC Routers | **Files**: `server/trpc/routers/ticket.ts:55`, `message.ts:104`
User-supplied search strings are interpolated directly into SQL `LIKE` patterns. Characters `%` and `_` alter query semantics, enabling data extraction or DoS via expensive patterns.
**Fix**: Escape `%`, `_`, and `\` in search input before interpolation: `input.replace(/[%_\\]/g, '\\$&')`.

### CR-04. Agents Can See All Partner Tickets
**Area**: tRPC Routers | **File**: `server/trpc/routers/ticket.ts:24-36`
The ticket list query filters by `partnerId` but not by agent assignment or department. Agents (non-admin) can view all tickets across all departments within the partner, including tickets they shouldn't have access to.
**Fix**: Add role-based row filtering — agents see only tickets assigned to them or in their departments.

### CR-05. Stale Lockout Check After Password Verification
**Area**: Auth | **File**: `server/routes/auth.ts:336-340`
After password verification, lockout is re-checked against the **stale in-memory user object**, not the database. A concurrent request that locked the account between fetch and check is invisible.
**Fix**: Re-fetch `lockedUntil` from DB, or remove the redundant check.

### CR-06. SSO Exchange Endpoint Unauthenticated
**Area**: Auth | **File**: `server/routes/sso.ts:380-408`
The `/exchange` endpoint redeems an opaque UUID token for user profile data with no authentication. Mitigated by 122-bit entropy + 60s TTL + single-use, but if the token leaks via referrer/logs, the window is exploitable.
**Fix**: Require the `tessera_token` cookie when calling `/exchange`.

### CR-07. MFA Challenge Redis Failure Handling
**Area**: Auth | **File**: `server/routes/auth.ts:363-366`
If Redis is unavailable when storing the MFA challenge token, the error is caught and logged but the flow continues, returning an unusable token. The user can re-submit with password+TOTP directly.
**Fix**: Return an error response when Redis storage fails instead of continuing.

### CR-08. Stats Router Type Safety Defeat
**Area**: tRPC Routers | **File**: `server/trpc/routers/stats.ts:25`
`[key: string]: unknown` index signature effectively makes the stats response untyped, defeating TypeScript's type safety guarantees.
**Fix**: Define explicit typed interfaces for all stat response shapes.

### CR-09. Stale Closures in useSocket.ts
**Area**: Client | **File**: `client/src/hooks/useSocket.ts`
19 handler call sites use destructured store functions captured at first render instead of `useStore.getState()`. Works today because Zustand references happen to be stable, but is fragile. Some handlers already correctly use `getState()`, making the pattern inconsistent.
**Fix**: Use `useStore.getState()` consistently in all socket handlers.

### CR-10. Object URL Memory Leak
**Area**: Client | **File**: `client/src/components/ChatWindow.tsx`
`URL.createObjectURL()` is called for file upload previews but `revokeObjectURL()` is never called, leaking blob references on every file upload.
**Fix**: Call `URL.revokeObjectURL()` in cleanup (useEffect return or after upload completes).

---

## IMPORTANT Issues (Fix Soon)

### Auth & Security (6)

| ID | Issue | File |
|----|-------|------|
| IM-01 | In-memory login rate limiter ineffective multi-instance | `auth.ts:28-67` |
| IM-02 | Raw DB error messages leaked to clients | `user.ts:25-31` |
| IM-03 | No rate limiting on password reset endpoint | `auth.ts:189-268` |
| IM-04 | `demoList` public procedure leaks user IDs + privilege levels | `user.ts:33-55` |
| IM-05 | MFA disable doesn't require password re-auth | `mfa.ts:119-169` |
| IM-06 | Race condition on concurrent password reset requests | `auth.ts:142-151` |

### tRPC Routers (8)

| ID | Issue | File |
|----|-------|------|
| IM-07 | Platform operator sees all feedback cross-tenant | `feedback.ts:24` |
| IM-08 | `resendInvite` fetches full user row (password/secrets in memory) | `platform.ts:517` |
| IM-09 | Race condition in `inviteExternalUser` (no transaction) | `partner.ts:558` |
| IM-10 | `listPartners` returns AI config/keys unlike `getManifest` | `platform.ts:67` |
| IM-11 | `getManifest` catch swallows NOT_FOUND into INTERNAL_SERVER_ERROR | `partner.ts:223` |
| IM-12 | `updateMember` allows no role change for tenant admins | `partner.ts:610` |
| IM-13 | `rating.list` has no pagination (unbounded result set) | `rating.ts:14` |
| IM-14 | `kb.aiSearch` loads ALL article bodies into memory | `kb.ts:99` |

### Sockets & Services (5)

| ID | Issue | File |
|----|-------|------|
| IM-15 | AI prompt injection via partner-customizable templates | `services/ai/prompts.ts` |
| IM-16 | Rate limit increment-before-check allows one extra request | `services/ai/rateLimit.ts` |
| IM-17 | Ticket viewer tracking in-memory only (breaks horizontal scaling) | `socket/handlers.ts` |
| IM-18 | Webhook SSRF: DNS rebinding not prevented | `services/webhookDispatch.ts` |
| IM-19 | AI provider cache key missing API key hash | `services/ai/summaryCache.ts` |

### Client (7)

| ID | Issue | File |
|----|-------|------|
| IM-20 | ~30 `as any` type assertions violating no-any mandate | Various components |
| IM-21 | ~15 native `alert()` calls instead of Toast component | Various components |
| IM-22 | Stale closure in PlatformSystemSettings useEffect | `PlatformSystemSettings.tsx` |
| IM-23 | Dialogs missing `aria-modal`, focus trapping, `aria-labelledby` | Various dialogs |
| IM-24 | Hardcoded `DEMO_PASSWORD` ships in production bundle | `LoginView.tsx` |
| IM-25 | Hardcoded hex colors in AdminStats (invisible in dark mode) | `AdminStats.tsx` |
| IM-26 | Non-brutalist default theme (border-radius: 12px, glassmorphism) | `useTheme.ts` |

---

## MINOR Issues (21 total)

### Auth (6)
- Missing lockout check on `mfa.enable`
- Non-constant-time recovery code hash comparison (`indexOf`)
- SSO redirect uses CORS_ORIGIN instead of FRONTEND_URL
- No audit log for individual failed logins
- JWT claims trusted without DB re-validation
- No-op `canAccessPartnerContext` call

### tRPC (6)
- Inconsistent procedure usage across routers
- Duplicated `slugify` functions in partner.ts and kb.ts
- Non-null assertion in `label.delete`
- `stats.getGlobalStats` is a 600+ line monolith
- Alerts router missing partner scope validation
- `cannedResponse.list` wrong arity to `canUseSupportWorkflows`

### Services (5)
- Guard regex uses global flag with `test()` (stateful bug)
- Missing try/catch on presence decrement during disconnect
- `ticketViewers` Map has no size limit
- `ai_usage_log` has no retention policy
- Repetition store TTL not configurable

### Client (4)
- LoginView missing ErrorBoundary wrapping
- ErrorBoundary exposes stack traces in production
- `border-radius: 1px` in scrollbar styles (brutalist violation)
- AdminStats Recharts colors not dark-mode aware

---

## What Was Done Well

**Server Security:**
- Argon2id with proper parameters (19456 KiB, 2 iterations)
- Atomic lockout increments preventing TOCTOU races
- Fail-closed Redis revocation (Redis down = tokens revoked)
- TOTP replay prevention with timing-safe comparison
- HttpOnly + SameSite=Lax cookies, proper CSRF state for SSO
- Password strength validation with history (last 5) and common password blocking
- Session revocation on all security-critical changes

**Architecture:**
- Clean tRPC router organization with 17 domain routers
- Proper middleware chain (public -> protected -> admin -> platform)
- Server-side identity enforcement on all socket events
- Tenant isolation on socket events with `partnerId` scoping
- GDPR archive-before-purge with SHA-256 hash chain verification
- Zod validation on all config with minimum JWT_SECRET length

**Client:**
- Zero XSS vectors found (no dangerouslySetInnerHTML misuse)
- Proper HttpOnly cookie auth (no token in localStorage)
- Thorough socket cleanup in useEffect returns
- Good ErrorBoundary coverage on main views
- Solid route-based access control

---

## Recommended Fix Priority

### Phase 1 — Security Critical (do now)
1. **CR-01** Whisper broadcast fix (high impact, easy fix)
2. **CR-02** Enable content moderation guards (dead code activation)
3. **CR-03** Escape LIKE wildcards in search
4. **CR-04** Add agent-level ticket row filtering
5. **CR-05** Fix stale lockout check

### Phase 2 — Security Hardening (this sprint)
6. **IM-01** Move login rate limiter to Redis
7. **IM-03** Rate limit password reset endpoint
8. **IM-02** Stop leaking raw error messages
9. **IM-07** Scope platform operator feedback to partner context
10. **IM-15** Enforce `<user_content>` in AI prompt templates
11. **IM-18** Add DNS rebinding prevention to webhook dispatch

### Phase 3 — Quality & Compliance (next sprint)
12. **CR-09** Fix stale closures in useSocket.ts
13. **CR-10** Fix Object URL memory leak
14. **IM-20** Remove all `as any` assertions
15. **IM-21** Replace `alert()` with Toast
16. **IM-23** Fix dialog accessibility
17. **IM-24** Gate DEMO_PASSWORD behind build-time flag
18. **IM-25/26** Fix design system violations

---

## Detailed Reports

Individual review reports with full code snippets, line numbers, and fix recommendations:

| Report | File |
|--------|------|
| Auth & Security | `SECURITY_REVIEW_2026-03-28.md` (project root) |
| tRPC Routers | `REVIEW_TRPC_ROUTERS.md` (project root) |
| Sockets & Services | `REVIEW_SERVER_SERVICES.md` (project root) |
| Client Code | `docs/reviews/CLIENT_CODE_REVIEW_2026-03-28.md` |
