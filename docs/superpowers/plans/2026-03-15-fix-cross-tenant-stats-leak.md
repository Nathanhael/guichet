# Fix Cross-Tenant Stats Data Leakage — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 4 SQL queries in `getGlobalStats` that leak cross-tenant data by adding missing `partner_id` filters.

**Architecture:** Each query needs a `AND partner_id = $N` clause added, matching the pattern already used by adjacent queries in the same procedure (e.g., line 169). The existing `partnerId` variable (line 138) is already available.

**Tech Stack:** PostgreSQL raw queries via `query()`, tRPC, Vitest

---

## File Structure

| File | Responsibility |
|------|---------------|
| `server/trpc/routers/stats.ts` | **Modify** — Add `partner_id` filter to 4 queries |
| `server/__tests__/stats-tenant-isolation.test.ts` | **New** — Tests proving tenant isolation in stats queries |

---

## Task 1: Write failing tests for tenant isolation

**Files:**
- Create: `server/__tests__/stats-tenant-isolation.test.ts`

- [ ] **Step 1: Write tests that prove cross-tenant leakage**

Create `server/__tests__/stats-tenant-isolation.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { query } from '../db.js';

vi.mock('../db.js', () => ({
  query: vi.fn().mockResolvedValue([]),
  get: vi.fn(),
}));

describe('Stats tenant isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prevHistSql includes partner_id filter', async () => {
    // Import the module that builds the query
    // We'll verify by checking that query() was called with partner_id param
    const { query: mockQuery } = await import('../db.js');

    // Trigger getGlobalStats via tRPC caller
    const { appRouter } = await import('../trpc/router.js');
    const jwt = await import('jsonwebtoken');
    const config = await import('../config.js');

    const adminUser = { id: 'admin-1', role: 'admin' as const, partnerId: 'partner-A', isPlatformOperator: false };
    const caller = appRouter.createCaller({
      user: adminUser,
      token: jwt.default.sign(adminUser, config.default.JWT_SECRET),
    });

    try {
      await caller.stats.getGlobalStats({});
    } catch {
      // May fail due to mocked DB, that's fine
    }

    // Check ALL query calls include partner_id where they query tenant data
    const calls = (mockQuery as any).mock.calls;
    const tenantTables = ['daily_stats', 'tickets', 'ticket_labels', 'canned_responses', 'messages'];

    for (const [sql, params] of calls) {
      const sqlLower = (sql as string).toLowerCase();
      const touchesTenantTable = tenantTables.some(t => sqlLower.includes(t));
      if (touchesTenantTable) {
        const hasPartnerFilter = sqlLower.includes('partner_id');
        expect(hasPartnerFilter, `Query missing partner_id filter: ${sql}`).toBe(true);
        expect(params).toContain('partner-A');
      }
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `docker-compose exec -T server npx vitest run stats-tenant-isolation`
Expected: FAIL — queries missing partner_id will be caught

- [ ] **Step 3: Commit failing test**

```bash
git add server/__tests__/stats-tenant-isolation.test.ts
git commit -m "test: add tenant isolation checks for stats queries (expected to fail)"
```

---

## Task 2: Fix `waitingTickets` query (line 404)

**Files:**
- Modify: `server/trpc/routers/stats.ts:404`

- [ ] **Step 1: Add partner_id filter**

Change line 404 from:
```ts
const waitingTickets = (await query('SELECT created_at FROM tickets WHERE status = $1 AND support_id IS NULL AND created_at >= $2', ['open', thirtyMinsAgo])) as unknown as { createdAt: string }[];
```

To:
```ts
const waitingTickets = (await query('SELECT created_at FROM tickets WHERE status = $1 AND support_id IS NULL AND created_at >= $2 AND partner_id = $3', ['open', thirtyMinsAgo, partnerId])) as unknown as { createdAt: string }[];
```

- [ ] **Step 2: Verify server tests still pass**

Run: `docker-compose exec -T server npx vitest run stats`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add server/trpc/routers/stats.ts
git commit -m "security: add partner_id filter to waitingTickets query"
```

---

## Task 3: Fix `prevHistSql` query (lines 516-522)

**Files:**
- Modify: `server/trpc/routers/stats.ts:516-522`

- [ ] **Step 1: Add partner_id filter**

Change lines 516-522 from:
```ts
let prevHistSql = `SELECT SUM(total) as total, AVG(avg_response_ms) as avgresp, AVG(avg_duration_ms) as avgdur, SUM(abandoned) as abandoned, AVG(sla_resolved) as slares, AVG(sla_compliant) as slacomp, AVG(avg_rating) as avgrat
                   FROM daily_stats
                   WHERE date >= $1 AND date <= $2`;
if (excludeWeekends) {
    prevHistSql += " AND EXTRACT(DOW FROM date::date) NOT IN (0, 6)";
}
const prevHist = (await query(prevHistSql, [prevStartStr, prevEndStr])) as unknown as (PrevHistRow & { avgrat: number | null })[];
```

To:
```ts
let prevHistSql = `SELECT SUM(total) as total, AVG(avg_response_ms) as avgresp, AVG(avg_duration_ms) as avgdur, SUM(abandoned) as abandoned, AVG(sla_resolved) as slares, AVG(sla_compliant) as slacomp, AVG(avg_rating) as avgrat
                   FROM daily_stats
                   WHERE date >= $1 AND date <= $2 AND partner_id = $3`;
if (excludeWeekends) {
    prevHistSql += " AND EXTRACT(DOW FROM date::date) NOT IN (0, 6)";
}
const prevHist = (await query(prevHistSql, [prevStartStr, prevEndStr, partnerId])) as unknown as (PrevHistRow & { avgrat: number | null })[];
```

- [ ] **Step 2: Commit**

```bash
git add server/trpc/routers/stats.ts
git commit -m "security: add partner_id filter to prevHistSql query"
```

---

## Task 4: Fix `labelsSql` query (lines 563-570)

**Files:**
- Modify: `server/trpc/routers/stats.ts:563-570`

- [ ] **Step 1: Add partner_id filter**

Change lines 563-570 from:
```ts
const labelsSql = `SELECT l.name, t.dept, COUNT(*) as count
                   FROM ticket_labels tl
                   JOIN labels l ON tl.label_id = l.id
                   JOIN tickets t ON tl.ticket_id = t.id
                   WHERE t.created_at::date >= $1 AND t.created_at::date <= $2
                   GROUP BY l.name, t.dept
                   ORDER BY t.dept, count DESC`;
const labelCounts = (await query(labelsSql, [rangeStart, rangeEnd])) as unknown as LabelCountRow[];
```

To:
```ts
const labelsSql = `SELECT l.name, t.dept, COUNT(*) as count
                   FROM ticket_labels tl
                   JOIN labels l ON tl.label_id = l.id
                   JOIN tickets t ON tl.ticket_id = t.id
                   WHERE t.created_at::date >= $1 AND t.created_at::date <= $2 AND t.partner_id = $3
                   GROUP BY l.name, t.dept
                   ORDER BY t.dept, count DESC`;
const labelCounts = (await query(labelsSql, [rangeStart, rangeEnd, partnerId])) as unknown as LabelCountRow[];
```

- [ ] **Step 2: Commit**

```bash
git add server/trpc/routers/stats.ts
git commit -m "security: add partner_id filter to labelsSql query"
```

---

## Task 5: Fix `cannedSql` query (lines 576-583)

**Files:**
- Modify: `server/trpc/routers/stats.ts:576-583`

- [ ] **Step 1: Add partner_id filter**

Change lines 576-583 from:
```ts
const cannedSql = `SELECT cr.shortcut, COUNT(*) as usage_count, AVG(r.rating) as avg_rating
                   FROM messages m
                   JOIN canned_responses cr ON m.canned_response_id = cr.id
                   JOIN ratings r ON m.ticket_id = r.ticket_id
                   WHERE m.created_at::date >= $1 AND m.created_at::date <= $2
                   GROUP BY cr.shortcut
                   ORDER BY usage_count DESC`;
return await query(cannedSql, [rangeStart, rangeEnd]);
```

To:
```ts
const cannedSql = `SELECT cr.shortcut, COUNT(*) as usage_count, AVG(r.rating) as avg_rating
                   FROM messages m
                   JOIN canned_responses cr ON m.canned_response_id = cr.id
                   JOIN ratings r ON m.ticket_id = r.ticket_id
                   JOIN tickets tk ON m.ticket_id = tk.id
                   WHERE m.created_at::date >= $1 AND m.created_at::date <= $2 AND tk.partner_id = $3
                   GROUP BY cr.shortcut
                   ORDER BY usage_count DESC`;
return await query(cannedSql, [rangeStart, rangeEnd, partnerId]);
```

Note: `messages` table doesn't have `partner_id` directly, so we join through `tickets` to scope by partner.

- [ ] **Step 2: Commit**

```bash
git add server/trpc/routers/stats.ts
git commit -m "security: add partner_id filter to cannedSql query"
```

---

## Task 6: Run full test suite and push

- [ ] **Step 1: Run tenant isolation test**

Run: `docker-compose exec -T server npx vitest run stats-tenant-isolation`
Expected: PASS — all queries now include partner_id

- [ ] **Step 2: Run full server tests**

Run: `docker-compose exec -T server npm test`
Expected: All tests pass

- [ ] **Step 3: Run client tests**

Run: `docker-compose exec -T client npm test`
Expected: All tests pass (no client changes, but verify nothing broke)

- [ ] **Step 4: Push**

```bash
git push
```
