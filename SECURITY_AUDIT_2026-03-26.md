# Tessera Backend Security Audit — 2026-03-26

## Executive Summary

Three parallel deep-dives into: (1) Socket.io handler authorization, (2) JWT cookie migration feasibility, (3) GDPR purge timing & audit log tamper window. Overall security posture is strong — no cross-tenant data leaks found — but several hardening opportunities exist, including one critical finding.

---

## Critical Findings

### 1. Audit Log 30-Day Tamper Window (CRITICAL)

**Location**: `server/services/archive.ts`, `server/services/gdpr.ts`

Audit log entries sit in the unprotected `audit_log` table for the full `GDPR_RETENTION_DAYS` (30 days) before archival to the WORM `audit_archive`. During this window:

- Rows can be `UPDATE`d or `DELETE`d by any process with DB write access
- Deleted rows never appear in the hash chain — silent evidence destruction
- No triggers, row-level security, or checksums protect `audit_log`

**Fix**: Decouple archival from GDPR retention. Add `AUDIT_ARCHIVE_DELAY_DAYS` (e.g., 2 days) so entries are hash-chained within 48 hours. Add a PostgreSQL trigger or RLS policy blocking UPDATE/DELETE on `audit_log` from the application role.

---

### 2. `ticket:new` — Agent ID Spoofing (IMPORTANT)

**Location**: `server/socket/handlers.ts` ~line 309

Client-supplied `agentId` is written directly to the ticket row without verifying it matches `socket.data.userId`. An agent can create tickets attributed to any user.

**Fix**: Replace `const { agentId } = data` with `const agentId = socket.data.userId`.

---

### 3. `ticket:transfer` — Cross-Partner User Assignment (IMPORTANT)

**Location**: `server/socket/handlers.ts` ~line 718

`targetSupportId` from the client is used in a `SELECT name FROM users WHERE id = $1` with no membership check. A support agent can transfer a ticket to any user on the platform, including users from other partners.

**Fix**: Add `JOIN memberships m ON u.id = m.user_id WHERE u.id = $1 AND m.partner_id = $2` to the target user lookup.

---

### 4. Non-Atomic Audit Archival (IMPORTANT)

**Location**: `server/services/archive.ts`

Insert loop and final delete are not wrapped in a transaction. A crash mid-loop leaves the hash chain in a partially-built state.

**Fix**: Wrap the entire `archiveAuditLog()` in a single DB transaction.

---

### 5. No Scheduled Chain Verification (IMPORTANT)

**Location**: `server/services/archive.ts`

`verifyAuditChain()` is on-demand only. No automated integrity monitoring.

**Fix**: Run `verifyAuditChain()` as part of the daily purge job. Log/alert on `valid: false`.

---

### 6. GDPR Purge — No Startup Catch-Up (MODERATE)

**Location**: `server/app.ts` lines 269–277

Purge uses `setTimeout` + `setInterval` with random jitter. No catch-up after extended downtime — data older than 30 days persists for the duration of the outage.

**Fix**: On startup, check last purge timestamp. If gap exceeds `PURGE_INTERVAL_MS`, run immediately.

---

### 7. `rating:submit` — Client-Supplied agentId (LOW)

**Location**: `server/socket/handlers.ts` ~line 533

Client-supplied `agentId` written to `ratings` table. Logically constrained (caller must be the ticket agent) but not explicitly validated.

**Fix**: Use `socket.data.userId` instead of client payload.

---

## Socket.io Authorization — Full Event Matrix

| Event | Partner Scope | Role Check | Identity Source | Verdict |
|---|---|---|---|---|
| `socket:identify` | DB membership verified | N/A | `socket.data.authedUserId` | SECURE |
| `ticket:new` | `socket.data.partnerId` | N/A | **Client `agentId`** | **FIX NEEDED** |
| `support:join` | DB partner_id check | `canUseSupportWorkflows()` | `socket.data` | SECURE |
| `support:leave` | DB partner_id check | N/A | `socket.data.userId` | SECURE |
| `ticket:close` | DB partner_id check | `canUseSupportWorkflows()` | `socket.data` | SECURE |
| `ticket:transfer` | DB partner_id check | `canUseSupportWorkflows()` | **Client `targetSupportId` unverified** | **FIX NEEDED** |
| `ticket:labels:update` | DB partner_id + label ownership | None (any member) | `socket.data` | SECURE |
| `message:send` | DB partner_id + membership JOIN | Whisper gated | `socket.data.userId` | SECURE |
| `message:edit` | DB partner_id check | Ownership + 15min window | `socket.data.userId` | SECURE |
| `message:delete` | DB partner_id check | Role-differentiated | `socket.data.userId` | SECURE |
| `message:read` | DB partner_id check | N/A (batch capped 100) | `socket.data` | SECURE |
| `message:delivered` | DB partner_id check | N/A | `socket.data` | SECURE |
| `typing:start/stop` | Room membership | N/A | `socket.data.name` | SECURE |
| `rating:submit` | Ticket ownership check | Agent-only | **Client `agentId`** | LOW RISK |
| `ticket:viewing` | DB partner_id check | Role check | `socket.data` | SECURE |
| `status:set` | N/A | N/A | `socket.data` | SECURE |

**No cross-tenant data leak vectors found.** Every mutation fetches `partner_id` from DB and compares to `socket.data.partnerId`.

---

## JWT → HttpOnly Cookie Migration

### Feasibility: FEASIBLE but NON-TRIVIAL

### Current Architecture
- **Issuance**: 4 endpoints return JWT in JSON body (`/login`, `/login-local`, `/switch-partner`, `/enter-partner`)
- **Storage**: `localStorage` in client
- **Transmission**: `Authorization: Bearer` header (tRPC, fetch calls), `socket.handshake.auth.token` (Socket.io)
- **Expiry detection**: Client-side JWT decode from `localStorage` on hydration

### Two Genuine Blockers

1. **Socket.io**: Requires explicit cookie parsing from `socket.handshake.headers.cookie` — not automatic, but documented pattern
2. **Client-side expiry awareness**: `isTokenExpired()` in `authSlice.ts` decodes JWT from localStorage. With HttpOnly cookie, JS can't read it. Solution: issue a separate non-HttpOnly `__session_expires` cookie carrying only the `exp` timestamp.

### Migration Phases

| Phase | Scope | Risk |
|---|---|---|
| 1. Server: add cookie alongside body response | `app.ts`, `auth.ts`, `config.ts` | Low (backward compat) |
| 2. Server: read cookie as fallback | `auth.ts`, `context.ts`, `handlers.ts` | Low |
| 3. Client: stop using localStorage for token | `authSlice.ts`, `main.tsx`, `useSocket.ts`, `ChatWindow.tsx`, `uploadLogo.ts` | High (breaking) |
| 4. Remove body token | All issuance endpoints | Low (cleanup) |

### CSRF Mitigation
- `SameSite=Lax` blocks cross-origin POSTs natively
- Existing CORS whitelist is compatible with `credentials: true`
- Double-submit cookie pattern as defense-in-depth for mutations

### Files Requiring Changes (12 files)

**Server**: `app.ts`, `config.ts`, `routes/auth.ts`, `routes/sso.ts`, `middleware/auth.ts`, `trpc/context.ts`, `socket/handlers.ts`

**Client**: `main.tsx`, `hooks/useSocket.ts`, `store/slices/authSlice.ts`, `components/ChatWindow.tsx`, `utils/uploadLogo.ts`

---

## GDPR Purge — Detailed Analysis

| Aspect | Status |
|---|---|
| Purge correctness | Cutoff recalculated at runtime — safe after downtime |
| Idempotency | Safe to run multiple times (`onConflictDoNothing`, idempotent deletes) |
| Startup catch-up | **Missing** — no check for missed purges |
| Multi-instance safety | Jitter helps, but no distributed lock |
| Hash chain ordering | Fragile under concurrent archival (timestamp-based sort) |

---

## Prioritized Action Plan

| Priority | Action | Effort | Impact |
|---|---|---|---|
| P0 | Fix `ticket:new` agentId spoofing | 5 min | Prevents ticket attribution fraud |
| P0 | Fix `ticket:transfer` membership check | 15 min | Closes cross-partner assignment vector |
| P1 | Shrink audit tamper window (archive after 2 days) | 2 hours | Critical for compliance/forensics |
| P1 | Wrap archival in transaction | 30 min | Prevents partial chain state |
| P1 | Add scheduled chain verification | 30 min | Detects tampering automatically |
| P2 | Add RLS/trigger on audit_log | 1 hour | Defense-in-depth for tamper resistance |
| P2 | GDPR startup catch-up | 1 hour | Ensures compliance after downtime |
| P2 | Fix `rating:submit` agentId | 5 min | Code quality hardening |
| P3 | JWT → HttpOnly cookie migration | 2-3 days | Eliminates XSS token exfiltration |
