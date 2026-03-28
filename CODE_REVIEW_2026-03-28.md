# Tessera Full Codebase Review — 2026-03-28

**Scope**: Entire codebase (server, client, infrastructure, CI/CD)
**Reviewers**: 5 parallel code review agents (auth/security, data layer, socket/services, client-side, infrastructure)
**Total findings**: 11 Critical, 27 Important

---

## Executive Summary

The Tessera codebase has strong foundations — Argon2id password hashing, fail-closed session revocation, proper CSRF state in SSO flows, and consistent multi-tenancy scoping in most routers. However, the review uncovered **11 critical issues** spanning security vulnerabilities, data integrity bugs, and infrastructure misconfigurations that should be addressed before any production deployment.

The most urgent fixes are: **webhook SSRF** (no private IP blocking), **TOTP replay fail-open** (Redis unavailability disables replay protection), **feedback insert crash** (missing partnerId), and **MFA bypass via password reset** (no TOTP required).

---

## CRITICAL Findings (11)

### C1. Webhook SSRF — No Private IP Block
| | |
|---|---|
| **File** | `server/services/webhookDispatch.ts:98` |
| **Confidence** | 95 |
| **Impact** | Partner admins can register webhooks to `http://169.254.169.254/` (cloud metadata), `http://redis:6379/`, or any internal Docker network service |

**Fix**: Before `fetch`, resolve hostname to IP and reject RFC-1918, loopback, link-local, and metadata ranges. Reject non-`https` schemes. Validate both at registration (tRPC router) and dispatch time.

---

### C2. TOTP Replay Protection Fails Open on Redis Unavailability
| | |
|---|---|
| **File** | `server/services/platformStepUp.ts:114–123` |
| **Confidence** | 90 |
| **Impact** | If Redis goes down, the same 30-second TOTP code can be submitted multiple times to create multiple valid sessions |

**Fix**: Return `true` (treat as used/blocked) in the catch block, matching the fail-closed pattern in `isRevoked`:
```typescript
} catch {
  return true; // fail closed
}
```

---

### C3. MFA Bypass via Password Reset Flow
| | |
|---|---|
| **File** | `server/routes/auth.ts:178–191` |
| **Confidence** | 95 |
| **Impact** | An attacker who compromises email can reset an MFA-enrolled account's password without TOTP verification |

**Fix**: Require current TOTP code as part of password reset confirmation when MFA is enabled, or document as accepted risk in threat model.

---

### C4. Feedback Insert Crashes — Missing `partnerId`
| | |
|---|---|
| **File** | `server/trpc/routers/feedback.ts:48–73` |
| **Confidence** | 92 |
| **Impact** | `appFeedback.partnerId` is `NOT NULL` but the `create` mutation never sets it — every feedback submission throws a DB constraint error |

**Fix**: Add `partnerId: ctx.user.partnerId` to insert values. Handle platform operators without partner context.

---

### C5. Archive Hash Chain Uses Non-Deterministic UUID Ordering
| | |
|---|---|
| **File** | `server/services/archive.ts:54–57` |
| **Confidence** | 90 |
| **Impact** | Within a batch sharing the same `archivedAt` timestamp, UUID tiebreaker ordering differs between write and verify, causing false chain integrity failures |

**Fix**: Use a dedicated `sequenceNumber` column, or store previous hash ID explicitly rather than relying on `ORDER BY archivedAt, id`.

---

### C6. `updateUser` Spreads Unsanitized Input + Uses `any` Type
| | |
|---|---|
| **File** | `server/trpc/routers/platform.ts:203` |
| **Confidence** | 95 |
| **Impact** | Latent privilege escalation if Zod schema is ever expanded (e.g., adding `isPlatformOperator`). The `diff` variable is typed `any`, violating project mandates. |

**Fix**: Explicitly pick allowed fields (matching the `updatePartner` pattern). Type the diff properly.

---

### C7. SSO Email Fallback Allows Account Takeover
| | |
|---|---|
| **File** | `server/routes/sso.ts:199–206` |
| **Confidence** | 85 |
| **Impact** | When SSO user not found by OID, falls back to email matching — silently links a local-auth account to an SSO identity without user consent |

**Fix**: Only match by email if existing user has `password = null` (SSO-only or uninitialised invite), or gate behind `authMethod` validation.

---

### C8. Hardcoded JWT Secret in docker-compose.yml
| | |
|---|---|
| **File** | `docker-compose.yml:27` |
| **Confidence** | 100 |
| **Impact** | Public secret in source control can forge valid JWTs if accidentally used in staging/prod |

**Fix**: Change to `JWT_SECRET=${JWT_SECRET:?JWT_SECRET must be set}` and require a `.env` file.

---

### C9. Production Redis Has No TLS
| | |
|---|---|
| **File** | `docker-compose.prod.yml:30` |
| **Confidence** | 88 |
| **Impact** | Redis password transmitted in plaintext between containers; exploitable if containers run on separate hosts |

**Fix**: Use `rediss://` (TLS) for production, or document the mitigation (shared Docker network).

---

### C10. Rate Limiting Permanently Disabled in Dev
| | |
|---|---|
| **File** | `docker-compose.yml:28` |
| **Confidence** | 90 |
| **Impact** | Rate limiting never exercised in dev/E2E testing; bugs in rate-limit paths go undetected |

**Fix**: Remove or default to `${DISABLE_RATE_LIMIT:-false}`.

---

### C11. Dev Dockerfile Runs `npm run dev` in Prod-Shaped Image
| | |
|---|---|
| **File** | `server/Dockerfile:35` |
| **Confidence** | 95 |
| **Impact** | Multi-stage Alpine image with `CMD ["npm", "run", "dev"]` — if mistakenly used as production image, ships dev server with file watching |

**Fix**: Rename to `Dockerfile.dev` to make intent unambiguous.

---

## IMPORTANT Findings (27)

### Auth & Security (5)

| # | Issue | File | Confidence |
|---|-------|------|------------|
| I1 | Race condition in account lockout — read-then-write without locking | `accountLockout.ts:38–79` | 85 |
| I2 | SSO payload exposed in browser URL hash (userId, roles, memberships) | `sso.ts:329` | 88 |
| I3 | TOTP verification uses non-constant-time string comparison | `platformStepUp.ts:99–105` | 80 |
| I4 | `mfa.disable` has no failed-attempt lockout — unlimited brute-force | `mfa.ts:134–137` | 82 |
| I5 | `curl` installed in production runtime image (attack surface) | `Dockerfile.prod:20` | 85 |

### Data Layer (8)

| # | Issue | File | Confidence |
|---|-------|------|------------|
| I6 | GDPR aggregation skips dates with existing stats rows (even if incomplete) | `gdpr.ts:31–38` | 85 |
| I7 | Platform operators without partner context can dump ALL ratings (unbounded) | `rating.ts:21–26` | 88 |
| I8 | Nullable `closedAt` corrupts cursor pagination for closed tickets | `ticket.ts:111–113` | 88 |
| I9 | `listGlobalUsers` loads all users + memberships into memory (incl. passwords, MFA secrets) | `platform.ts:311–328` | 82 |
| I10 | `demoList` is a public procedure that exposes all user emails | `user.ts:39–54` | 80 |
| I11 | `messages.senderId` has no FK; missing composite index `(ticketId, deletedAt)` | `schema.ts:126` | 82 |
| I12 | GDPR purge proceeds even if ticket archival failed silently | `gdpr.ts:97–104` | 80 |
| I13 | Stats query has no max date range — can load entire ticket/message tables | `stats.ts:147–151` | 83 |

### Socket & Services (6)

| # | Issue | File | Confidence |
|---|-------|------|------------|
| I14 | `status:set` accepts arbitrary strings into Redis (no allowlist) | `handlers.ts:436–443` | 85 |
| I15 | `ticket:labels:update` missing role check — agents can relabel tickets | `handlers.ts:760–798` | 90 |
| I16 | `broadcastQueuePositions` snake_case/camelCase mismatch causes infinite recursion crash | `businessHours.ts:292` | 82 |
| I17 | `isValidMediaUrl` bypassed by extension-less URLs | `security.ts:27` | 80 |
| I18 | `presence.ts` uses Redis `KEYS` command — blocks event loop under load | `presence.ts:220` | 80 |
| I19 | SLA config values unclamped — 0ms triggers instant breach, large values cause 43K iterations | `sla.ts:43` | 82 |

### Client-Side (8)

| # | Issue | File | Confidence |
|---|-------|------|------------|
| I20 | MFA flow stores plaintext password in React state during TOTP challenge | `LoginView.tsx:59–62` | 90 |
| I21 | `canDelete` logic lets any non-agent delete any message (UI-side) | `MessageBubble.tsx:74` | 92 |
| I22 | Optimistic message ID uses `Object.keys(messages).length` — collision-prone | `ChatWindow.tsx:382` | 88 |
| I23 | `ticket:updated` handler spreads unvalidated `[key: string]: any` onto ticket state | `useSocket.ts:229` | 85 |
| I24 | `s.off(event)` without handler ref removes ALL listeners (singleton socket) | `useSocket.ts:325–358` | 87 |
| I25 | `reactions` typed as object but stored as JSON string in messageSlice | `messageSlice.ts:79` | 85 |
| I26 | `hydrateAccessibilityPrefs` overwrites local prefs unconditionally on login | `uiSlice.ts:104` | 82 |
| I27 | `any` types in `AdminStats`/`CustomerInfoPanel` violate CLAUDE.md mandate | `AdminStats.tsx:339` | 80 |

### Infrastructure (5)

| # | Issue | File | Confidence |
|---|-------|------|------------|
| I28 | Client nginx.conf missing all security headers (X-Frame-Options, HSTS, CSP, nosniff) | `client/nginx.conf` | 90 |
| I29 | `.dockerignore` doesn't exclude `.env`, test files, scripts, backups | `server/.dockerignore` | 88 |
| I30 | PostgreSQL, Prometheus, Grafana bound to `0.0.0.0` in dev compose | `docker-compose.yml:10` | 85 |
| I31 | Grafana defaults to well-known `admin` password | `docker-compose.yml:105` | 82 |
| I32 | No memory/CPU resource limits on any production service | `docker-compose.prod.yml` | 80 |

---

## Verified Correct — Notable Security Patterns

These were scrutinised and found **well-implemented**:

- JWT revocation via Redis with fail-closed on Redis unavailability (`sessionRevocation.ts`)
- CSRF state + nonce in SSO flow stored server-side with one-time deletion
- `switch-partner` verifies userId ownership of membershipId before issuing new token
- `enter-partner` requires both `isPlatformOperator` AND `platformStepUpAt`
- `findUserByEmail` uses `lower()` comparison (no LIKE wildcard injection)
- Argon2id used consistently; no bcrypt anywhere
- Password history checked with Argon2id verify (not plain comparison)
- Recovery codes SHA-256 hashed at rest and consumed on use
- Multi-tenant isolation correct on all socket message/ticket mutation events
- AI prompt injection mitigations use `<user_content>` delimiters with angle-bracket escaping
- HMAC signing for webhooks implemented correctly
- No `dangerouslySetInnerHTML` found anywhere in client code
- Auth guard structure in App.tsx is sound

---

## Recommended Fix Priority

### Sprint 1 — Security (Immediate)
1. **C1** Webhook SSRF private IP block
2. **C2** TOTP replay fail-closed
3. **C3** MFA bypass on password reset
4. **C7** SSO email fallback account takeover
5. **I15** `ticket:labels:update` role check
6. **I20** Plaintext password in React state
7. **I28** Nginx security headers

### Sprint 2 — Data Integrity
8. **C4** Feedback insert partnerId
9. **C5** Archive hash chain ordering
10. **C6** `updateUser` explicit field picking
11. **I8** Nullable closedAt cursor pagination
12. **I12** GDPR purge after failed archival
13. **I16** broadcastQueuePositions camelCase crash

### Sprint 3 — Hardening
14. **C8** JWT secret from env
15. **C9** Redis TLS
16. **C10** Rate limiting default
17. **C11** Dockerfile rename
18. **I9** listGlobalUsers pagination + field filtering
19. **I13** Stats date range validation
20. **I18** Redis KEYS to SCAN
21. **I29** .dockerignore expansion
22. **I30** Bind ports to loopback

### Sprint 4 — Polish
23. Remaining Important findings (I1–I7, I10–I11, I14, I17, I19, I21–I27, I31–I32)
