# Deferred Review Fixes — Design Spec

**Date:** 2026-03-29
**Scope:** 6 deferred findings from codebase review (#29, #33, #34, #36, #41, #43). Item #17 confirmed correct — excluded.

## Strategy

Two groups based on coupling:

**Group A — Isolated fixes** (3 items, independent):
- #33: savedViews JSONB validation
- #34: SLA columns text→timestamp migration
- #36: GDPR aggregation N+1 optimization

**Group B — Token infrastructure** (3 items, interdependent):
- #43: Short-lived access tokens + refresh token
- #41: Remove Bearer token fallback (depends on #43 — refresh tokens replace the use case)
- #29: SLA per-partner config in stats (independent but grouped for single branch)

Single branch: `fix/deferred-review-items`

---

## Group A Fixes

### #33: SavedViews JSONB Validation

**Problem:** `filtersSchema` in `server/trpc/routers/savedView.ts` uses `.passthrough()`, allowing arbitrary JSONB fields to be stored. User-controlled JSONB with no structure validation.

**Fix:** Replace `.passthrough()` with `.strict()` and enumerate all valid filter fields:

```ts
const filtersSchema = z.object({
  dept: z.string().optional(),
  tab: z.enum(['queue', 'archive', 'search']).optional(),
  status: z.string().optional(),
  labels: z.array(z.string()).optional(),
  search: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  agentId: z.string().optional(),
}).strict();
```

Also add `.$type<SavedViewFilters>()` to the schema column definition for type safety.

**Risk:** Low. Only affects future saves — existing saved views with extra fields will fail validation on update but remain readable.

---

### #34: SLA Columns Text→Timestamp

**Problem:** `slaResponseDueAt` and `slaResolutionDueAt` in the tickets table are `text` columns storing ISO date strings. This prevents PostgreSQL date arithmetic and index-optimized timestamp comparisons.

**Fix:**
1. Generate a Drizzle migration that:
   - Adds new `timestamp` columns (`sla_response_due_at_ts`, `sla_resolution_due_at_ts`)
   - Copies data with `::timestamptz` cast
   - Drops old `text` columns
   - Renames new columns to original names
2. Update `server/db/schema.ts` to use `timestamp('sla_response_due_at', { mode: 'string' })` (same mode as all other timestamps in the codebase)

**Risk:** Medium. Data migration on tickets table. Requires backup first. The `{ mode: 'string' }` means Drizzle still returns ISO strings to TypeScript — no application code changes needed.

**Migration SQL:**
```sql
ALTER TABLE tickets ADD COLUMN sla_response_due_at_ts TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN sla_resolution_due_at_ts TIMESTAMPTZ;

UPDATE tickets SET sla_response_due_at_ts = sla_response_due_at::timestamptz
  WHERE sla_response_due_at IS NOT NULL;
UPDATE tickets SET sla_resolution_due_at_ts = sla_resolution_due_at::timestamptz
  WHERE sla_resolution_due_at IS NOT NULL;

ALTER TABLE tickets DROP COLUMN sla_response_due_at;
ALTER TABLE tickets DROP COLUMN sla_resolution_due_at;

ALTER TABLE tickets RENAME COLUMN sla_response_due_at_ts TO sla_response_due_at;
ALTER TABLE tickets RENAME COLUMN sla_resolution_due_at_ts TO sla_resolution_due_at;
```

---

### #36: GDPR Aggregation N+1 Optimization

**Problem:** `server/services/gdpr.ts` runs ~1,830 serial queries per purge (30 days x ~20 partners x 3 queries each). Runs daily but takes unnecessarily long.

**Fix:** Replace the nested date-partner loop with pre-grouped SQL aggregation:

1. Single query to get ticket counts grouped by `(date_trunc('day', created_at), partner_id)`
2. Single query to get rating aggregates grouped by `(date, partner_id)` via JOIN to tickets
3. Single query to get message/sentiment aggregates grouped by `(date, partner_id)` via JOIN

Then iterate the results in-memory to build `daily_stats` rows. This reduces ~1,830 queries to 3-4.

**Risk:** Low. Output is identical — same `daily_stats` rows. The purge already runs in a transaction.

---

## Group B Fixes

### #43: Short-Lived Access Tokens + Refresh Token

**Problem:** 24h JWT lifetime. A stolen token is valid for a full day. No refresh mechanism — expiry means re-login.

**Design:**

**Token pair:**
- **Access token:** 15-minute JWT in HttpOnly cookie (`tessera_token`), same as today
- **Refresh token:** 7-day opaque token in HttpOnly cookie (`tessera_refresh`), stored hashed in DB

**New table:** `refresh_tokens`
```
id: text PK (UUID)
userId: text FK → users.id
tokenHash: text (SHA-256 of opaque token)
expiresAt: timestamp
createdAt: timestamp
revokedAt: timestamp (nullable — for explicit revocation)
family: text (rotation family ID for reuse detection)
```

**New config:**
```
ACCESS_TOKEN_EXPIRY: '15m' (default)
REFRESH_TOKEN_EXPIRY: '7d' (default)
```

**Flow:**
1. **Login:** Issues access token (15m) + refresh token (7d). Both set as HttpOnly cookies.
2. **API request:** Access token used as today. If expired → 401.
3. **Refresh:** `POST /auth/refresh` — validates refresh cookie, issues new access + refresh pair (rotation). Old refresh token invalidated.
4. **Client detection:** `session_expires` companion cookie updated to access token expiry. Client calls `/auth/refresh` proactively before expiry (e.g., at 12 minutes).
5. **Logout:** Revokes refresh token family. Clears both cookies.
6. **Session revocation:** `revokeUserSessions()` marks all refresh tokens for user as revoked.

**Rotation & reuse detection:** Each refresh token belongs to a `family`. When a refresh token is used, a new one is issued with the same family. If a previously-used token from the same family is presented (replay attack), all tokens in that family are revoked.

**Migration path:** Deploy with `ACCESS_TOKEN_EXPIRY: '24h'` initially (backwards compatible). Then reduce to `15m` once stable.

---

### #41: Remove Bearer Token Fallback

**Problem:** CLAUDE.md states HttpOnly cookie auth, but Bearer header fallback widens XSS attack surface. Any XSS that can read a token from anywhere can use the Authorization header.

**Fix:** Remove the Bearer header check from:
- `server/middleware/auth.ts` lines 28-29
- `server/trpc/context.ts` lines 34-35

**Depends on:** #43 (refresh tokens). Without refresh tokens, removing Bearer would break any API client or script that uses `Authorization: Bearer`. With refresh tokens, the cookie-only approach is viable because the client never needs to handle tokens directly.

**Migration:**
1. Add deprecation warning log when Bearer auth is used
2. After 1 release cycle, remove Bearer support entirely
3. For this implementation: add the deprecation log now, keep Bearer functional but logged

---

### #29: SLA Per-Partner Config in Stats

**Problem:** `server/services/stats.ts` hardcodes `config.SLA_THRESHOLD_MS` globally. Partners have per-department SLA config in `partners.slaConfig` JSONB, and `getEffectiveSla()` already reads it, but stats computation ignores it.

**Fix:**
1. Accept partner's `slaConfig` as parameter to `computeLiveDayStats()`
2. Inside the function, use `getEffectiveSla(slaConfig, dept)` to get the per-department threshold instead of `config.SLA_THRESHOLD_MS`
3. For `getGlobalStats` (which spans multiple partners), resolve SLA per-ticket using the ticket's partner config
4. Historical `daily_stats` already have SLA compliance baked in — only live computation needs fixing

**Risk:** Low. Only changes how live stats are computed. Historical data is unchanged.

---

## Execution Order

1. #33 (savedViews validation) — smallest, isolated
2. #36 (GDPR N+1) — query refactor, no schema change
3. #34 (SLA text→timestamp) — schema migration
4. #29 (SLA per-partner stats) — builds on existing `getEffectiveSla()`
5. #43 (refresh tokens) — new table, new endpoints, cookie changes
6. #41 (Bearer deprecation) — depends on #43

## Out of Scope

- #17 (nextBoundary timezone) — confirmed correct, excluded
- Token blacklisting infrastructure (refresh token revocation covers this)
- Sliding session windows (refresh rotation achieves similar UX)
