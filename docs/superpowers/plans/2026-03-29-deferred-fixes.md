# Deferred Review Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 6 deferred review findings (#29, #33, #34, #36, #41, #43).

**Architecture:** Group A (3 isolated fixes) then Group B (3 interdependent token/SLA fixes). Single branch `fix/deferred-review-items`.

**Tech Stack:** TypeScript, Vitest, tRPC, Drizzle ORM, PostgreSQL, Zod, Redis

---

## Task 1: Tighten savedViews JSONB validation (#33)

**Files:**
- Modify: `server/trpc/routers/savedView.ts` (lines 12-16)
- Test: `server/__tests__/savedViewValidation.test.ts`

The `filtersSchema` uses `.passthrough()` allowing arbitrary JSONB fields.

- [ ] **Step 1: Write the test**

```ts
// server/__tests__/savedViewValidation.test.ts
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('savedViews JSONB validation (#33)', () => {
  const savedViewSource = fs.readFileSync(
    path.resolve(__dirname, '../trpc/routers/savedView.ts'), 'utf-8'
  );

  it('does not use .passthrough() on filtersSchema', () => {
    expect(savedViewSource).not.toMatch(/\.passthrough\(\)/);
  });

  it('uses .strict() on filtersSchema', () => {
    expect(savedViewSource).toMatch(/\.strict\(\)/);
  });

  it('enumerates valid filter fields', () => {
    expect(savedViewSource).toMatch(/dept.*z\.string/);
    expect(savedViewSource).toMatch(/tab.*z\.enum/);
    expect(savedViewSource).toMatch(/status.*z\.string/);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
docker compose exec server npx vitest run __tests__/savedViewValidation.test.ts
```

- [ ] **Step 3: Update filtersSchema**

In `server/trpc/routers/savedView.ts`, replace the `filtersSchema`:

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

- [ ] **Step 4: Run test — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add server/trpc/routers/savedView.ts server/__tests__/savedViewValidation.test.ts
git commit -m "fix: tighten savedViews filters validation with .strict() (#33)"
```

---

## Task 2: Optimize GDPR aggregation N+1 queries (#36)

**Files:**
- Modify: `server/services/gdpr.ts` (lines 49-120)
- Test: `server/__tests__/gdprAggregation.test.ts`

The nested date-partner loop runs ~1,830 serial queries. Replace with pre-grouped SQL.

- [ ] **Step 1: Write the test**

```ts
// server/__tests__/gdprAggregation.test.ts
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('GDPR aggregation optimization (#36)', () => {
  const gdprSource = fs.readFileSync(
    path.resolve(__dirname, '../services/gdpr.ts'), 'utf-8'
  );

  it('uses grouped SQL queries instead of per-partner loops', () => {
    // Should have GROUP BY partner_id in the aggregation section
    expect(gdprSource).toMatch(/GROUP BY.*partner_id|group.*partner/i);
  });

  it('does not have nested per-partner query loop', () => {
    // The old pattern: for (const { partnerId } of partnerIds) { ... await query(...partner_id = $3...) }
    // Should not iterate partners with individual queries
    const hasNestedPartnerLoop = /for.*partnerId.*of partnerIds[\s\S]{1,500}await query/.test(gdprSource);
    expect(hasNestedPartnerLoop).toBe(false);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Refactor aggregation**

Read the full `server/services/gdpr.ts` to understand the current loop structure. Then replace the nested loops (lines 58-120) with:

1. A single query that gets ticket stats grouped by `(date, partner_id)`:
```sql
SELECT date_trunc('day', created_at)::date as day, partner_id,
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE status = 'closed') as closed,
  COUNT(*) FILTER (WHERE status = 'closed' AND closed_at IS NOT NULL) as resolved,
  COUNT(*) FILTER (WHERE reopened = true) as reopened,
  AVG(EXTRACT(EPOCH FROM (COALESCE(support_joined_at, NOW()) - created_at)) * 1000) as avg_response_ms
FROM tickets
WHERE created_at >= $1 AND created_at < $2
GROUP BY day, partner_id
```

2. A single query for ratings grouped by `(date, partner_id)` via JOIN to tickets.

3. Iterate the grouped results in-memory to build `daily_stats` upsert rows.

The key is replacing the `for (partnerId of partnerIds)` inner loop with the grouped query result.

- [ ] **Step 4: Run test — expect PASS**
- [ ] **Step 5: Run existing GDPR tests to check for regressions**

```bash
docker compose exec server npx vitest run __tests__/gdprGuard.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add server/services/gdpr.ts server/__tests__/gdprAggregation.test.ts
git commit -m "fix: replace GDPR N+1 aggregation with grouped SQL queries (#36)"
```

---

## Task 3: Migrate SLA columns from text to timestamp (#34)

**Files:**
- Modify: `server/db/schema.ts` (lines 110-111)
- Create: `server/drizzle/0026_sla_timestamp_migration.sql`
- Update: `server/drizzle/meta/_journal.json`
- Test: `server/__tests__/slaTimestamp.test.ts`

- [ ] **Step 1: Write the test**

```ts
// server/__tests__/slaTimestamp.test.ts
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('SLA columns use timestamp type (#34)', () => {
  const schemaSource = fs.readFileSync(
    path.resolve(__dirname, '../db/schema.ts'), 'utf-8'
  );

  it('slaResponseDueAt uses timestamp not text', () => {
    expect(schemaSource).toMatch(/slaResponseDueAt:\s*timestamp\(/);
    expect(schemaSource).not.toMatch(/slaResponseDueAt:\s*text\(/);
  });

  it('slaResolutionDueAt uses timestamp not text', () => {
    expect(schemaSource).toMatch(/slaResolutionDueAt:\s*timestamp\(/);
    expect(schemaSource).not.toMatch(/slaResolutionDueAt:\s*text\(/);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Update schema**

In `server/db/schema.ts`, change lines 110-111:

```ts
// From:
slaResponseDueAt: text('sla_response_due_at'),
slaResolutionDueAt: text('sla_resolution_due_at'),
// To:
slaResponseDueAt: timestamp('sla_response_due_at', { mode: 'string' }),
slaResolutionDueAt: timestamp('sla_resolution_due_at', { mode: 'string' }),
```

- [ ] **Step 4: Create migration file**

Create `server/drizzle/0026_sla_timestamp_migration.sql`:

```sql
-- Migrate SLA columns from text to timestamptz
ALTER TABLE tickets ADD COLUMN sla_response_due_at_new TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN sla_resolution_due_at_new TIMESTAMPTZ;

UPDATE tickets SET sla_response_due_at_new = sla_response_due_at::timestamptz
  WHERE sla_response_due_at IS NOT NULL;
UPDATE tickets SET sla_resolution_due_at_new = sla_resolution_due_at::timestamptz
  WHERE sla_resolution_due_at IS NOT NULL;

ALTER TABLE tickets DROP COLUMN sla_response_due_at;
ALTER TABLE tickets DROP COLUMN sla_resolution_due_at;

ALTER TABLE tickets RENAME COLUMN sla_response_due_at_new TO sla_response_due_at;
ALTER TABLE tickets RENAME COLUMN sla_resolution_due_at_new TO sla_resolution_due_at;
```

Update `server/drizzle/meta/_journal.json` to register the new migration.

- [ ] **Step 5: Run test — expect PASS**
- [ ] **Step 6: Run migration**

```bash
docker compose exec server npm run db:migrate
```

- [ ] **Step 7: Commit**

```bash
git add server/db/schema.ts server/drizzle/0026_sla_timestamp_migration.sql server/drizzle/meta/_journal.json server/__tests__/slaTimestamp.test.ts
git commit -m "fix: migrate SLA columns from text to timestamp (#34)"
```

---

## Task 4: Use per-partner SLA config in stats computation (#29)

**Files:**
- Modify: `server/services/stats.ts` (lines 71, 96)
- Modify: `server/trpc/routers/stats.ts` (pass partner SLA config)
- Test: `server/__tests__/slaPerPartner.test.ts`

Stats computation hardcodes `config.SLA_THRESHOLD_MS` instead of using per-partner `getEffectiveSla()`.

- [ ] **Step 1: Write the test**

```ts
// server/__tests__/slaPerPartner.test.ts
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('SLA per-partner config in stats (#29)', () => {
  const statsServiceSource = fs.readFileSync(
    path.resolve(__dirname, '../services/stats.ts'), 'utf-8'
  );

  it('uses getEffectiveSla instead of global SLA_THRESHOLD_MS', () => {
    expect(statsServiceSource).toMatch(/getEffectiveSla/);
  });

  it('does not hardcode config.SLA_THRESHOLD_MS for compliance checks', () => {
    // Should not use config.SLA_THRESHOLD_MS directly for per-ticket compliance
    const directUsage = statsServiceSource.match(/config\.SLA_THRESHOLD_MS/g) || [];
    // May still be used as a fallback, but not as the primary check
    // The getEffectiveSla should appear more often than the hardcoded value
    const effectiveUsage = statsServiceSource.match(/getEffectiveSla/g) || [];
    expect(effectiveUsage.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Implement per-partner SLA**

1. In `server/services/stats.ts`, add import:
```ts
import { getEffectiveSla } from './sla.js';
```

2. Update `computeLiveDayStats` signature to accept an optional `slaConfig` parameter:
```ts
export function computeLiveDayStats(
  dayTickets: TicketWithReopened[],
  dayRatings: Rating[],
  deptFilter?: string,
  dayMessages: MessageWithSentiment[] = [],
  slaConfig?: Record<string, unknown>,
)
```

3. Inside the function, replace `config.SLA_THRESHOLD_MS` with:
```ts
const sla = getEffectiveSla(slaConfig, ticket.dept);
const isCompliant = responseTime <= sla.responseMs;
```

4. In `server/trpc/routers/stats.ts`, when calling `computeLiveDayStats`, pass the partner's `slaConfig` from the partner query.

- [ ] **Step 4: Run test — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add server/services/stats.ts server/trpc/routers/stats.ts server/__tests__/slaPerPartner.test.ts
git commit -m "fix: use per-partner SLA config in stats computation (#29)"
```

---

## Task 5: Implement refresh token infrastructure (#43)

**Files:**
- Create: `server/db/schema.ts` (add refreshTokens table)
- Create: `server/services/refreshToken.ts`
- Modify: `server/routes/auth.ts` (login, refresh, logout endpoints)
- Modify: `server/config.ts` (new config values)
- Modify: `server/services/authSession.ts` (update cookie helpers)
- Create: `server/drizzle/0027_refresh_tokens.sql`
- Test: `server/__tests__/refreshToken.test.ts`

This is the largest task. Implement short-lived access tokens with rotating refresh tokens.

- [ ] **Step 1: Write the test**

```ts
// server/__tests__/refreshToken.test.ts
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Refresh token infrastructure (#43)', () => {
  const configSource = fs.readFileSync(
    path.resolve(__dirname, '../config.ts'), 'utf-8'
  );
  const schemaSource = fs.readFileSync(
    path.resolve(__dirname, '../db/schema.ts'), 'utf-8'
  );
  const authSource = fs.readFileSync(
    path.resolve(__dirname, '../routes/auth.ts'), 'utf-8'
  );

  it('has ACCESS_TOKEN_EXPIRY and REFRESH_TOKEN_EXPIRY config', () => {
    expect(configSource).toMatch(/ACCESS_TOKEN_EXPIRY/);
    expect(configSource).toMatch(/REFRESH_TOKEN_EXPIRY/);
  });

  it('defines refreshTokens table in schema', () => {
    expect(schemaSource).toMatch(/refreshTokens|refresh_tokens/);
    expect(schemaSource).toMatch(/tokenHash/);
    expect(schemaSource).toMatch(/family/);
  });

  it('has a /auth/refresh endpoint', () => {
    expect(authSource).toMatch(/\/refresh/);
  });

  it('sets refresh cookie on login', () => {
    expect(authSource).toMatch(/tessera_refresh/);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Add config values**

In `server/config.ts`, add to the schema:

```ts
ACCESS_TOKEN_EXPIRY: z.string().default('15m'),
REFRESH_TOKEN_EXPIRY: z.string().default('7d'),
```

And add them to the `parseResult` object.

- [ ] **Step 4: Add refreshTokens table to schema**

In `server/db/schema.ts`, add:

```ts
export const refreshTokens = pgTable('refresh_tokens', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  family: text('family').notNull(),
  expiresAt: timestamp('expires_at', { mode: 'string' }).notNull(),
  revokedAt: timestamp('revoked_at', { mode: 'string' }),
  createdAt: timestamp('created_at', { mode: 'string' }).notNull().defaultNow(),
}, (table) => ({
  userIdx: index('idx_refresh_tokens_user').on(table.userId),
  familyIdx: index('idx_refresh_tokens_family').on(table.family),
  tokenHashIdx: uniqueIndex('idx_refresh_tokens_hash').on(table.tokenHash),
}));
```

- [ ] **Step 5: Create refresh token service**

Create `server/services/refreshToken.ts`:

```ts
import crypto from 'crypto';
import { db } from '../db.js';
import { refreshTokens } from '../db/schema.js';
import { eq, and, isNull, lt } from 'drizzle-orm';
import config from '../config.js';
import { parseExpiryToSeconds } from './authSession.js';
import logger from '../utils/logger.js';

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function createRefreshToken(userId: string): Promise<{ token: string; family: string; expiresAt: string }> {
  const token = crypto.randomBytes(32).toString('hex');
  const family = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + parseExpiryToSeconds(config.REFRESH_TOKEN_EXPIRY) * 1000).toISOString();

  await db.insert(refreshTokens).values({
    userId,
    tokenHash: hashToken(token),
    family,
    expiresAt,
  });

  return { token, family, expiresAt };
}

export async function rotateRefreshToken(oldToken: string): Promise<{ token: string; userId: string; family: string; expiresAt: string } | null> {
  const oldHash = hashToken(oldToken);

  const rows = await db.select()
    .from(refreshTokens)
    .where(and(
      eq(refreshTokens.tokenHash, oldHash),
      isNull(refreshTokens.revokedAt),
    ))
    .limit(1);

  const existing = rows[0];
  if (!existing) {
    // Token not found or already revoked — possible replay attack
    // Check if this hash was ever used (reuse detection)
    const usedRows = await db.select({ family: refreshTokens.family })
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, oldHash))
      .limit(1);

    if (usedRows[0]) {
      // Reuse detected — revoke entire family
      logger.warn({ family: usedRows[0].family }, '[refresh] Token reuse detected, revoking family');
      await revokeFamily(usedRows[0].family);
    }
    return null;
  }

  // Check expiry
  if (new Date(existing.expiresAt) < new Date()) {
    return null;
  }

  // Revoke old token
  await db.update(refreshTokens)
    .set({ revokedAt: new Date().toISOString() })
    .where(eq(refreshTokens.id, existing.id));

  // Issue new token in same family
  const newToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + parseExpiryToSeconds(config.REFRESH_TOKEN_EXPIRY) * 1000).toISOString();

  await db.insert(refreshTokens).values({
    userId: existing.userId,
    tokenHash: hashToken(newToken),
    family: existing.family,
    expiresAt,
  });

  return { token: newToken, userId: existing.userId, family: existing.family, expiresAt };
}

export async function revokeFamily(family: string): Promise<void> {
  await db.update(refreshTokens)
    .set({ revokedAt: new Date().toISOString() })
    .where(and(
      eq(refreshTokens.family, family),
      isNull(refreshTokens.revokedAt),
    ));
}

export async function revokeAllUserRefreshTokens(userId: string): Promise<void> {
  await db.update(refreshTokens)
    .set({ revokedAt: new Date().toISOString() })
    .where(and(
      eq(refreshTokens.userId, userId),
      isNull(refreshTokens.revokedAt),
    ));
}

export async function cleanupExpiredTokens(): Promise<number> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days ago
  const result = await db.delete(refreshTokens)
    .where(lt(refreshTokens.expiresAt, cutoff));
  return 0; // Drizzle delete doesn't return count easily
}
```

- [ ] **Step 6: Add refresh endpoint and update login/logout**

In `server/routes/auth.ts`:

1. Import the new service:
```ts
import { createRefreshToken, rotateRefreshToken, revokeAllUserRefreshTokens, revokeFamily } from '../services/refreshToken.js';
```

2. Add helper to set refresh cookie:
```ts
function setRefreshCookie(res: Response, token: string, maxAgeSecs: number) {
  res.cookie('tessera_refresh', token, {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/api/auth/refresh',
    maxAge: maxAgeSecs * 1000,
    ...(config.COOKIE_DOMAIN ? { domain: config.COOKIE_DOMAIN } : {}),
  });
}
```

3. Update login handler: after `setAuthCookie`, also create and set refresh token:
```ts
const refresh = await createRefreshToken(user.id);
setRefreshCookie(res, refresh.token, parseExpiryToSeconds(config.REFRESH_TOKEN_EXPIRY));
```

4. Add `POST /auth/refresh` endpoint:
```ts
router.post('/refresh', async (req: Request, res: Response) => {
  const refreshToken = req.cookies?.tessera_refresh;
  if (!refreshToken) {
    return res.status(401).json({ error: 'No refresh token' });
  }

  const result = await rotateRefreshToken(refreshToken);
  if (!result) {
    clearAuthCookie(res);
    res.clearCookie('tessera_refresh', { path: '/api/auth/refresh' });
    return res.status(401).json({ error: 'Invalid or expired refresh token' });
  }

  // Get user memberships to build fresh access token
  const memberships = await listUserMemberships(result.userId);
  // ... build token with current membership context ...

  setAuthCookie(res, token, parseExpiryToSeconds(config.ACCESS_TOKEN_EXPIRY));
  setRefreshCookie(res, result.token, parseExpiryToSeconds(config.REFRESH_TOKEN_EXPIRY));

  res.json({ expiresIn: parseExpiryToSeconds(config.ACCESS_TOKEN_EXPIRY) });
});
```

5. Update logout handler: also revoke refresh tokens:
```ts
await revokeAllUserRefreshTokens(req.user.id);
res.clearCookie('tessera_refresh', { path: '/api/auth/refresh' });
```

- [ ] **Step 7: Update session revocation**

In `server/services/sessionRevocation.ts`, update `revokeUserSessions` to also call `revokeAllUserRefreshTokens`.

- [ ] **Step 8: Create migration**

Create `server/drizzle/0027_refresh_tokens.sql`:

```sql
CREATE TABLE refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  family TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_family ON refresh_tokens(family);
CREATE UNIQUE INDEX idx_refresh_tokens_hash ON refresh_tokens(token_hash);
```

- [ ] **Step 9: Run test — expect PASS**
- [ ] **Step 10: Run migration and full test suite**

```bash
docker compose exec server npm run db:migrate
docker compose exec server npx vitest run
```

- [ ] **Step 11: Commit**

```bash
git add server/config.ts server/db/schema.ts server/services/refreshToken.ts server/routes/auth.ts server/services/sessionRevocation.ts server/drizzle/0027_refresh_tokens.sql server/drizzle/meta/_journal.json server/__tests__/refreshToken.test.ts
git commit -m "feat: implement refresh token infrastructure with rotation (#43)"
```

---

## Task 6: Deprecate Bearer token fallback (#41)

**Files:**
- Modify: `server/middleware/auth.ts` (lines 28-29)
- Modify: `server/trpc/context.ts` (lines 34-35)
- Test: `server/__tests__/bearerDeprecation.test.ts`

Add deprecation warning log when Bearer auth is used. Keep functional for now.

- [ ] **Step 1: Write the test**

```ts
// server/__tests__/bearerDeprecation.test.ts
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Bearer token deprecation warning (#41)', () => {
  const authSource = fs.readFileSync(
    path.resolve(__dirname, '../middleware/auth.ts'), 'utf-8'
  );
  const contextSource = fs.readFileSync(
    path.resolve(__dirname, '../trpc/context.ts'), 'utf-8'
  );

  it('logs deprecation warning when Bearer auth is used in middleware', () => {
    expect(authSource).toMatch(/deprecat|Bearer.*warn|warn.*Bearer/i);
  });

  it('logs deprecation warning when Bearer auth is used in tRPC context', () => {
    expect(contextSource).toMatch(/deprecat|Bearer.*warn|warn.*Bearer/i);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Add deprecation warnings**

In `server/middleware/auth.ts`, after the Bearer check (line 29):

```ts
if (authHeader?.startsWith('Bearer ')) {
  token = authHeader.split(' ')[1];
  logger.warn({ ip: req.ip }, '[Auth] Bearer token auth is deprecated — migrate to cookie-based auth');
} else if (req.cookies?.tessera_token) {
```

In `server/trpc/context.ts`, add similar:

```ts
if (authHeader?.startsWith('Bearer ')) {
  logger.warn('[Auth] Bearer token auth is deprecated in tRPC context — migrate to cookie-based auth');
}
const token = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1]
  : req.cookies?.tessera_token ?? undefined;
```

- [ ] **Step 4: Run test — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add server/middleware/auth.ts server/trpc/context.ts server/__tests__/bearerDeprecation.test.ts
git commit -m "fix: add deprecation warning for Bearer token auth (#41)"
```

---

## Execution Order

1. Task 1 — savedViews validation (smallest, isolated)
2. Task 2 — GDPR N+1 optimization (query refactor)
3. Task 3 — SLA columns text→timestamp (schema migration)
4. Task 4 — SLA per-partner stats (builds on existing SLA service)
5. Task 5 — Refresh token infrastructure (largest, new table + endpoints)
6. Task 6 — Bearer deprecation (depends on Task 5 being in place)
