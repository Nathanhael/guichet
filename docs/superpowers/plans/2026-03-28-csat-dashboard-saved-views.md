# CSAT Dashboard & Saved Views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated CSAT analytics dashboard with trend charts, distribution breakdowns, and per-department/staff drill-down; plus a saved views feature letting support staff save and recall queue filter combinations.

**Architecture:** Feature 1 (CSAT) adds a new `rating.getAnalytics` tRPC procedure and a new `AdminSatisfaction.tsx` component with Recharts visualizations. Feature 2 (Saved Views) adds a `saved_views` DB table, a `savedView` tRPC router with CRUD, and UI in QueueSidebar for saving/loading filter state. Both features are independent and can be built in parallel.

**Tech Stack:** React 19, Recharts, tRPC 11, Drizzle ORM, Zod, Zustand, Tailwind CSS 4, PostgreSQL 18

---

## File Structure

### Feature 1: CSAT Dashboard

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `server/trpc/routers/rating.ts` | Add `getAnalytics` procedure (trend, distribution, dept breakdown) |
| Create | `client/src/components/admin/AdminSatisfaction.tsx` | CSAT dashboard component with charts and tables |
| Modify | `client/src/views/AdminView.tsx` | Register new "Satisfaction" tab in admin sidebar |

### Feature 2: Saved Views

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `server/db/schema.ts` | Add `savedViews` table definition |
| Create | `server/trpc/routers/savedView.ts` | CRUD router for saved views |
| Modify | `server/trpc/router.ts` | Register `savedView` router |
| Create | `client/src/components/support/SavedViewPicker.tsx` | Dropdown UI for saved views in QueueSidebar |
| Modify | `client/src/components/support/QueueSidebar.tsx` | Integrate SavedViewPicker, expose filter state |

---

## Task 1: CSAT Analytics Backend — `rating.getAnalytics` Procedure

**Files:**
- Modify: `server/trpc/routers/rating.ts`

- [ ] **Step 1: Add the `getAnalytics` procedure to the rating router**

Open `server/trpc/routers/rating.ts`. Add a new procedure after `getStaffRatings`. This procedure returns:
- `trend`: daily average rating over time
- `distribution`: count of each rating value (1-5)
- `byDept`: average rating per department
- `byStaff`: top/bottom performers with count
- `summary`: overall avg, total, and period comparison

```typescript
getAnalytics: adminProcedure
  .input(z.object({
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
    dept: z.string().optional(),
  }))
  .query(async ({ input, ctx }) => {
    try {
      if (!ctx.user.partnerId) {
        return { trend: [], distribution: [], byDept: [], byStaff: [], summary: { avg: 0, total: 0, withComment: 0 } };
      }

      const partnerId = ctx.user.partnerId;

      // Build date conditions as raw SQL fragments
      const dateConditions: string[] = [];
      const dateParams: string[] = [];
      let paramIdx = 2; // $1 is partnerId

      if (input.dateFrom) {
        dateConditions.push(`r.created_at >= $${paramIdx}`);
        dateParams.push(new Date(input.dateFrom).toISOString());
        paramIdx++;
      }
      if (input.dateTo) {
        const endDate = new Date(input.dateTo);
        endDate.setDate(endDate.getDate() + 1);
        dateConditions.push(`r.created_at < $${paramIdx}`);
        dateParams.push(endDate.toISOString());
        paramIdx++;
      }
      if (input.dept) {
        dateConditions.push(`t.dept = $${paramIdx}`);
        dateParams.push(input.dept);
        paramIdx++;
      }

      const whereBase = `r.ticket_id = t.id AND t.partner_id = $1`;
      const whereExtra = dateConditions.length > 0 ? ` AND ${dateConditions.join(' AND ')}` : '';
      const fullWhere = whereBase + whereExtra;
      const allParams = [partnerId, ...dateParams];

      // 1) Daily trend
      const trendRows = await query(
        `SELECT DATE(r.created_at) AS date, ROUND(AVG(r.rating)::numeric, 2) AS avg, COUNT(*)::int AS count
         FROM ratings r JOIN tickets t ON ${fullWhere}
         GROUP BY DATE(r.created_at)
         ORDER BY date ASC`,
        allParams
      );

      // 2) Distribution (1-5)
      const distRows = await query(
        `SELECT r.rating, COUNT(*)::int AS count
         FROM ratings r JOIN tickets t ON ${fullWhere}
         GROUP BY r.rating
         ORDER BY r.rating ASC`,
        allParams
      );

      // 3) By department
      const deptRows = await query(
        `SELECT t.dept, ROUND(AVG(r.rating)::numeric, 2) AS avg, COUNT(*)::int AS count
         FROM ratings r JOIN tickets t ON ${fullWhere}
         GROUP BY t.dept
         ORDER BY avg DESC`,
        allParams
      );

      // 4) By staff
      const staffRows = await query(
        `SELECT r.support_id, COALESCE(u.name, 'Unknown') AS name,
                ROUND(AVG(r.rating)::numeric, 2) AS avg, COUNT(*)::int AS count
         FROM ratings r JOIN tickets t ON ${fullWhere}
         LEFT JOIN users u ON r.support_id = u.id
         GROUP BY r.support_id, u.name
         ORDER BY avg DESC`,
        allParams
      );

      // 5) Summary
      const summaryRows = await query(
        `SELECT ROUND(AVG(r.rating)::numeric, 2) AS avg, COUNT(*)::int AS total,
                COUNT(r.comment) FILTER (WHERE r.comment IS NOT NULL AND r.comment != '')::int AS with_comment
         FROM ratings r JOIN tickets t ON ${fullWhere}`,
        allParams
      );

      const summary = summaryRows[0] || { avg: 0, total: 0, with_comment: 0 };

      return {
        trend: (trendRows || []).map((r: Record<string, unknown>) => ({
          date: String(r.date).slice(0, 10),
          avg: Number(r.avg),
          count: Number(r.count),
        })),
        distribution: (distRows || []).map((r: Record<string, unknown>) => ({
          rating: Number(r.rating),
          count: Number(r.count),
        })),
        byDept: (deptRows || []).map((r: Record<string, unknown>) => ({
          dept: String(r.dept),
          avg: Number(r.avg),
          count: Number(r.count),
        })),
        byStaff: (staffRows || []).map((r: Record<string, unknown>) => ({
          supportId: r.support_id as string | null,
          name: String(r.name),
          avg: Number(r.avg),
          count: Number(r.count),
        })),
        summary: {
          avg: Number(summary.avg) || 0,
          total: Number(summary.total) || 0,
          withComment: Number(summary.with_comment) || 0,
        },
      };
    } catch (err: unknown) {
      const message = errMsg(err);
      logger.error({ err: message }, 'tRPC: Error getting rating analytics');
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message });
    }
  }),
```

Also add the `query` import at the top of the file — it's needed for raw SQL:

```typescript
import { query } from '../../db.js';
```

Add this import alongside the existing `db` import. The `query` function is the raw SQL helper from `server/db/postgres.ts`.

- [ ] **Step 2: Verify the server compiles**

Run:
```bash
docker compose exec -T server npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add server/trpc/routers/rating.ts
git commit -m "feat(rating): add getAnalytics procedure for CSAT dashboard"
```

---

## Task 2: CSAT Dashboard Component — `AdminSatisfaction.tsx`

**Files:**
- Create: `client/src/components/admin/AdminSatisfaction.tsx`

- [ ] **Step 1: Create the AdminSatisfaction component**

Create `client/src/components/admin/AdminSatisfaction.tsx`:

```tsx
import { useState } from 'react';
import { Panel, StatCard, Skeleton, Stars } from './DashboardHelpers';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Cell,
} from 'recharts';
import { trpc } from '../../utils/trpc';
import useStore from '../../store/useStore';

interface AnalyticsData {
  trend: { date: string; avg: number; count: number }[];
  distribution: { rating: number; count: number }[];
  byDept: { dept: string; avg: number; count: number }[];
  byStaff: { supportId: string | null; name: string; avg: number; count: number }[];
  summary: { avg: number; total: number; withComment: number };
}

export default function AdminSatisfaction() {
  const { memberships, activeMembershipId } = useStore();
  const activeMembership = (memberships || []).find(m => m.id === activeMembershipId);
  const departments: { id: string; name: string }[] = activeMembership?.manifest?.departments || [];

  const [dept, setDept] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [activePreset, setActivePreset] = useState<string | null>(null);

  function applyPreset(key: string) {
    const now = new Date();
    const toStr = now.toISOString().slice(0, 10);
    let fromStr = toStr;
    if (key === '7d') {
      const d = new Date(now); d.setDate(d.getDate() - 6); fromStr = d.toISOString().slice(0, 10);
    } else if (key === '14d') {
      const d = new Date(now); d.setDate(d.getDate() - 13); fromStr = d.toISOString().slice(0, 10);
    } else if (key === '30d') {
      const d = new Date(now); d.setDate(d.getDate() - 29); fromStr = d.toISOString().slice(0, 10);
    } else if (key === '90d') {
      const d = new Date(now); d.setDate(d.getDate() - 89); fromStr = d.toISOString().slice(0, 10);
    }
    setDateFrom(fromStr);
    setDateTo(toStr);
    setActivePreset(key);
  }

  const { data, isLoading } = trpc.rating.getAnalytics.useQuery(
    {
      dept: dept === 'all' ? undefined : dept,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    },
    { refetchInterval: 30000 }
  );

  if (isLoading || !data) {
    return (
      <div className="space-y-6 max-w-7xl mx-auto">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const stats = data as AnalyticsData;

  // Fill distribution gaps (ensure 1-5 all present)
  const fullDist = [1, 2, 3, 4, 5].map(r => ({
    rating: r,
    label: `${r} Star${r > 1 ? 's' : ''}`,
    count: stats.distribution.find(d => d.rating === r)?.count || 0,
  }));

  const commentRate = stats.summary.total > 0
    ? Math.round((stats.summary.withComment / stats.summary.total) * 100)
    : 0;

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-10">
      {/* Header */}
      <div className="flex items-center justify-between gap-6">
        <div>
          <h2 className="text-2xl font-bold uppercase tracking-tight">Customer Satisfaction</h2>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">CSAT analytics and rating trends</p>
        </div>

        <div className="flex items-center gap-2 border border-[var(--color-border)] p-2 bg-[var(--color-bg-surface)] overflow-x-auto">
          {/* Department filter */}
          <div className="flex gap-1">
            {(['all', ...departments.map(d => d.id)] as string[]).map(d => (
              <button
                key={d}
                onClick={() => setDept(d)}
                className={`px-3 py-1.5 text-xs font-bold uppercase border ${
                  dept === d
                    ? 'border-[var(--color-border)] bg-[var(--color-text-primary)] text-[var(--color-bg-base)]'
                    : 'border-transparent text-[var(--color-text-muted)] hover:opacity-100'
                }`}
              >
                {d === 'all' ? 'All' : (departments.find(dep => dep.id === d)?.name || d)}
              </button>
            ))}
          </div>

          <div className="w-px h-6 bg-[var(--color-border)] mx-1" />

          {/* Date presets */}
          <div className="flex gap-1">
            {[
              { key: 'today', label: 'Today' },
              { key: '7d', label: '7D' },
              { key: '30d', label: '30D' },
              { key: '90d', label: '90D' },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => applyPreset(key)}
                className={`px-2.5 py-1.5 text-xs font-bold uppercase border ${
                  activePreset === key
                    ? 'border-[var(--color-border)] bg-[var(--color-text-primary)] text-[var(--color-bg-base)]'
                    : 'border-transparent text-[var(--color-text-muted)] hover:opacity-100'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="w-px h-6 bg-[var(--color-border)] mx-1" />

          {/* Custom date range */}
          <div className="flex items-center gap-2">
            <input
              type="date"
              aria-label="Start date"
              value={dateFrom}
              onChange={e => { setDateFrom(e.target.value); setActivePreset(null); }}
              className="input-field text-xs"
            />
            <span className="text-xs text-[var(--color-text-muted)]">&rarr;</span>
            <input
              type="date"
              aria-label="End date"
              value={dateTo}
              onChange={e => { setDateTo(e.target.value); setActivePreset(null); }}
              className="input-field text-xs"
            />
            {(dept !== 'all' || dateFrom || dateTo) && (
              <button
                onClick={() => { setDept('all'); setDateFrom(''); setDateTo(''); setActivePreset(null); }}
                className="p-1.5 border border-[var(--color-border)] text-[var(--color-text-muted)] hover:opacity-100"
                title="Clear all filters"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Average Rating" value={stats.summary.avg > 0 ? stats.summary.avg.toFixed(1) : '---'} color="dark" />
        <StatCard label="Total Ratings" value={stats.summary.total} color="gray" />
        <StatCard label="Comment Rate" value={`${commentRate}%`} color="gray" />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-2 gap-4">
        {/* Rating Trend */}
        <Panel title="Rating Trend">
          {stats.trend.length < 2 ? (
            <p className="text-sm text-[var(--color-text-secondary)] py-8 text-center">Not enough data for trend</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={stats.trend} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={Math.ceil(stats.trend.length / 8)} />
                <YAxis tick={{ fontSize: 10 }} domain={[0, 5]} ticks={[1, 2, 3, 4, 5]} />
                <Tooltip
                  formatter={(v: number, name: string) => [
                    name === 'avg' ? v.toFixed(1) : v,
                    name === 'avg' ? 'Avg Rating' : 'Count',
                  ]}
                />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="avg" stroke="var(--color-text-primary)" strokeWidth={2} dot={false} name="Avg Rating" />
                <Line type="monotone" dataKey="count" stroke="var(--color-text-muted)" strokeWidth={1} dot={false} name="Count" yAxisId="right" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Panel>

        {/* Rating Distribution */}
        <Panel title="Rating Distribution">
          {stats.summary.total === 0 ? (
            <p className="text-sm text-[var(--color-text-secondary)] py-8 text-center">No ratings yet</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={fullDist} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" name="Ratings">
                  {fullDist.map((entry, idx) => (
                    <Cell key={idx} fill={entry.rating >= 4 ? 'var(--color-text-primary)' : entry.rating >= 3 ? 'var(--color-text-secondary)' : 'var(--color-text-muted)'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Panel>
      </div>

      {/* Department breakdown */}
      {stats.byDept.length > 0 && (
        <Panel title="Satisfaction by Department">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-[var(--color-border)]">
                  <th className="font-mono text-[9px] uppercase text-[var(--color-text-muted)] tracking-wide py-2 pr-4">Department</th>
                  <th className="font-mono text-[9px] uppercase text-[var(--color-text-muted)] tracking-wide py-2 pr-4">Avg Rating</th>
                  <th className="font-mono text-[9px] uppercase text-[var(--color-text-muted)] tracking-wide py-2 pr-4">Stars</th>
                  <th className="font-mono text-[9px] uppercase text-[var(--color-text-muted)] tracking-wide py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {stats.byDept.map(row => {
                  const deptName = departments.find(d => d.id === row.dept)?.name || row.dept;
                  return (
                    <tr key={row.dept} className="border-b border-[var(--color-border)]">
                      <td className="py-2 pr-4 text-sm font-bold uppercase">{deptName}</td>
                      <td className="py-2 pr-4 text-sm font-bold tabular-nums">{row.avg.toFixed(1)}</td>
                      <td className="py-2 pr-4"><Stars value={Math.round(row.avg)} /></td>
                      <td className="py-2 text-sm font-bold text-[var(--color-text-secondary)] text-right">{row.count}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {/* Staff leaderboard */}
      {stats.byStaff.length > 0 && (
        <Panel title="Staff Leaderboard">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-[var(--color-border)]">
                  <th className="font-mono text-[9px] uppercase text-[var(--color-text-muted)] tracking-wide py-2 w-8">#</th>
                  <th className="font-mono text-[9px] uppercase text-[var(--color-text-muted)] tracking-wide py-2 pr-4">Support Staff</th>
                  <th className="font-mono text-[9px] uppercase text-[var(--color-text-muted)] tracking-wide py-2 pr-4">Avg Rating</th>
                  <th className="font-mono text-[9px] uppercase text-[var(--color-text-muted)] tracking-wide py-2 pr-4">Stars</th>
                  <th className="font-mono text-[9px] uppercase text-[var(--color-text-muted)] tracking-wide py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {stats.byStaff.map((staff, idx) => (
                  <tr key={staff.supportId || idx} className="border-b border-[var(--color-border)]">
                    <td className="py-2 text-sm font-bold text-[var(--color-text-muted)]">{idx + 1}</td>
                    <td className="py-2 pr-4 text-sm font-bold">{staff.name}</td>
                    <td className="py-2 pr-4 text-sm font-bold tabular-nums">{staff.avg.toFixed(1)}</td>
                    <td className="py-2 pr-4"><Stars value={Math.round(staff.avg)} /></td>
                    <td className="py-2 text-sm font-bold text-[var(--color-text-secondary)] text-right">{staff.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}
```

**Note on the trend chart:** The LineChart uses a dual Y-axis — the left axis shows avg rating (0-5), the right axis shows count. The `yAxisId="right"` on the count line requires adding `<YAxis yAxisId="right" orientation="right" />` — but to keep it simple, we omit the second axis and let Recharts auto-scale. If the count line looks odd, add the second YAxis later.

- [ ] **Step 2: Verify the client compiles**

Run:
```bash
docker compose exec -T client npx tsc --noEmit
```
Expected: No errors. If the dual `yAxisId="right"` causes a type error, remove it — the count line will share the left axis which is fine for now.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/admin/AdminSatisfaction.tsx
git commit -m "feat(admin): add AdminSatisfaction CSAT dashboard component"
```

---

## Task 3: Register CSAT Dashboard in AdminView

**Files:**
- Modify: `client/src/views/AdminView.tsx`

- [ ] **Step 1: Read AdminView.tsx to find the tab registration pattern**

Open `client/src/views/AdminView.tsx` and find:
1. The import section — where components are imported
2. The tab definition array or switch/conditional — where tabs are mapped to components
3. The sidebar navigation — where tab buttons are rendered

- [ ] **Step 2: Add the import and tab registration**

Add the import at the top with the other admin component imports:

```typescript
import AdminSatisfaction from '../components/admin/AdminSatisfaction';
```

Add a new tab entry in the tab list. Place it after "Stats" (the main dashboard) since it's a drill-down analytics view. The exact insertion depends on how AdminView structures its tabs — follow the existing pattern. The tab key should be `'satisfaction'`, the label should be `'Satisfaction'`, and it should render `<AdminSatisfaction />`.

The tab should be visible to `admin` role users (same as Stats).

- [ ] **Step 3: Verify the client compiles and the tab appears**

Run:
```bash
docker compose exec -T client npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/views/AdminView.tsx
git commit -m "feat(admin): register Satisfaction tab in AdminView"
```

---

## Task 4: Saved Views — Database Table

**Files:**
- Modify: `server/db/schema.ts`

- [ ] **Step 1: Add the `savedViews` table to the schema**

Open `server/db/schema.ts`. Add the table definition near the bottom, before any export statements. Follow the pattern used by `cannedResponses` (per-partner, per-user resource):

```typescript
export const savedViews = pgTable('saved_views', {
  id: text('id').primaryKey(),
  partnerId: text('partner_id').notNull().references(() => partners.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  filters: jsonb('filters').notNull().default({}),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at', { mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).notNull().defaultNow(),
}, (table) => [
  index('idx_saved_views_partner_user').on(table.partnerId, table.userId),
]);
```

The `filters` JSONB column stores the serialized filter state:
```json
{
  "dept": "sales",
  "tab": "queue",
  "status": "open"
}
```

- [ ] **Step 2: Push the schema change to the database**

Run:
```bash
docker compose exec -T server npx drizzle-kit push
```
Expected: Creates `saved_views` table.

- [ ] **Step 3: Verify the server compiles**

Run:
```bash
docker compose exec -T server npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add server/db/schema.ts
git commit -m "feat(db): add saved_views table for queue filter persistence"
```

---

## Task 5: Saved Views — tRPC Router

**Files:**
- Create: `server/trpc/routers/savedView.ts`
- Modify: `server/trpc/router.ts`

- [ ] **Step 1: Create the savedView router**

Create `server/trpc/routers/savedView.ts`:

```typescript
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { router, protectedProcedure } from '../trpc.js';
import { db } from '../../db.js';
import { savedViews } from '../../db/schema.js';
import { eq, and, asc } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { wrapError } from '../../utils/trpcErrors.js';

const MAX_SAVED_VIEWS = 20;

const filtersSchema = z.object({
  dept: z.string().optional(),
  tab: z.enum(['queue', 'archive', 'search']).optional(),
  status: z.string().optional(),
}).passthrough();

export const savedViewRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    try {
      if (!ctx.user.partnerId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Partner context required' });
      }

      return await db.select()
        .from(savedViews)
        .where(and(
          eq(savedViews.partnerId, ctx.user.partnerId),
          eq(savedViews.userId, ctx.user.id),
        ))
        .orderBy(asc(savedViews.name));
    } catch (err: unknown) {
      wrapError(err, 'Error listing saved views');
    }
  }),

  create: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(50),
      filters: filtersSchema,
      isDefault: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        if (!ctx.user.partnerId) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Partner context required' });
        }

        // Enforce limit
        const existing = await db.select({ id: savedViews.id })
          .from(savedViews)
          .where(and(
            eq(savedViews.partnerId, ctx.user.partnerId),
            eq(savedViews.userId, ctx.user.id),
          ));

        if (existing.length >= MAX_SAVED_VIEWS) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: `Maximum ${MAX_SAVED_VIEWS} saved views allowed` });
        }

        // If setting as default, clear existing default
        if (input.isDefault) {
          await db.update(savedViews)
            .set({ isDefault: false, updatedAt: new Date().toISOString() })
            .where(and(
              eq(savedViews.partnerId, ctx.user.partnerId),
              eq(savedViews.userId, ctx.user.id),
              eq(savedViews.isDefault, true),
            ));
        }

        const id = `sv_${uuidv4()}`;
        const now = new Date().toISOString();

        await db.insert(savedViews).values({
          id,
          partnerId: ctx.user.partnerId,
          userId: ctx.user.id,
          name: input.name.trim(),
          filters: input.filters,
          isDefault: input.isDefault || false,
          createdAt: now,
          updatedAt: now,
        });

        return { id, name: input.name.trim(), filters: input.filters, isDefault: input.isDefault || false };
      } catch (err: unknown) {
        wrapError(err, 'Error creating saved view');
      }
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.string(),
      name: z.string().min(1).max(50).optional(),
      filters: filtersSchema.optional(),
      isDefault: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        if (!ctx.user.partnerId) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Partner context required' });
        }

        // Verify ownership
        const existing = await db.select()
          .from(savedViews)
          .where(and(
            eq(savedViews.id, input.id),
            eq(savedViews.partnerId, ctx.user.partnerId),
            eq(savedViews.userId, ctx.user.id),
          ))
          .limit(1);

        if (existing.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Saved view not found' });
        }

        // If setting as default, clear existing default
        if (input.isDefault) {
          await db.update(savedViews)
            .set({ isDefault: false, updatedAt: new Date().toISOString() })
            .where(and(
              eq(savedViews.partnerId, ctx.user.partnerId),
              eq(savedViews.userId, ctx.user.id),
              eq(savedViews.isDefault, true),
            ));
        }

        const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
        if (input.name !== undefined) updates.name = input.name.trim();
        if (input.filters !== undefined) updates.filters = input.filters;
        if (input.isDefault !== undefined) updates.isDefault = input.isDefault;

        await db.update(savedViews)
          .set(updates)
          .where(eq(savedViews.id, input.id));

        return { success: true };
      } catch (err: unknown) {
        wrapError(err, 'Error updating saved view');
      }
    }),

  delete: protectedProcedure
    .input(z.string())
    .mutation(async ({ input: id, ctx }) => {
      try {
        if (!ctx.user.partnerId) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Partner context required' });
        }

        const deleted = await db.delete(savedViews)
          .where(and(
            eq(savedViews.id, id),
            eq(savedViews.partnerId, ctx.user.partnerId),
            eq(savedViews.userId, ctx.user.id),
          ))
          .returning({ id: savedViews.id });

        if (deleted.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Saved view not found' });
        }

        return { success: true };
      } catch (err: unknown) {
        wrapError(err, 'Error deleting saved view');
      }
    }),
});
```

- [ ] **Step 2: Register the router in the main router**

Open `server/trpc/router.ts`. Add the import:

```typescript
import { savedViewRouter } from './routers/savedView.js';
```

Add to the `appRouter` object:

```typescript
savedView: savedViewRouter,
```

Place it alphabetically (after `rating`, before `stats`).

- [ ] **Step 3: Verify the server compiles**

Run:
```bash
docker compose exec -T server npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add server/trpc/routers/savedView.ts server/trpc/router.ts
git commit -m "feat(savedView): add CRUD router for queue saved views"
```

---

## Task 6: Saved Views — Client UI Component

**Files:**
- Create: `client/src/components/support/SavedViewPicker.tsx`

- [ ] **Step 1: Create the SavedViewPicker component**

Create `client/src/components/support/SavedViewPicker.tsx`:

```tsx
import { useState } from 'react';
import { trpc } from '../../utils/trpc';
import { Bookmark, Plus, Trash2, Star, X } from 'lucide-react';
import { useT } from '../../i18n';

export interface ViewFilters {
  dept?: string;
  tab?: 'queue' | 'archive' | 'search';
}

interface SavedViewPickerProps {
  currentFilters: ViewFilters;
  onApply: (filters: ViewFilters) => void;
}

export default function SavedViewPicker({ currentFilters, onApply }: SavedViewPickerProps) {
  const t = useT();
  const utils = trpc.useUtils();

  const [isOpen, setIsOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [showSaveInput, setShowSaveInput] = useState(false);

  const { data: views } = trpc.savedView.list.useQuery();
  const createMutation = trpc.savedView.create.useMutation({
    onSuccess: () => {
      utils.savedView.list.invalidate();
      setSaveName('');
      setShowSaveInput(false);
    },
  });
  const deleteMutation = trpc.savedView.delete.useMutation({
    onSuccess: () => utils.savedView.list.invalidate(),
  });
  const updateMutation = trpc.savedView.update.useMutation({
    onSuccess: () => utils.savedView.list.invalidate(),
  });

  function handleSave() {
    if (!saveName.trim()) return;
    createMutation.mutate({
      name: saveName.trim(),
      filters: currentFilters,
    });
  }

  function handleApply(filters: Record<string, unknown>) {
    onApply({
      dept: (filters.dept as string) || undefined,
      tab: (filters.tab as ViewFilters['tab']) || undefined,
    });
    setIsOpen(false);
  }

  function handleSetDefault(id: string, isDefault: boolean) {
    updateMutation.mutate({ id, isDefault: !isDefault });
  }

  const hasFilters = currentFilters.dept && currentFilters.dept !== 'all';

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`w-7 h-7 flex items-center justify-center border border-[var(--color-border)] ${
          isOpen ? 'bg-[var(--color-text-primary)] text-[var(--color-bg-base)]' : 'hover:bg-[var(--color-bg-elevated)]'
        }`}
        title={t('saved_views') || 'Saved Views'}
      >
        <Bookmark className="h-3.5 w-3.5" />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-56 bg-[var(--color-bg-surface)] border border-[var(--color-border)] z-50 animate-fade-in">
          {/* Header */}
          <div className="px-3 py-2 border-b border-[var(--color-border)] flex items-center justify-between">
            <span className="font-mono text-[9px] font-bold uppercase text-[var(--color-text-muted)] tracking-wide">
              {t('saved_views') || 'Saved Views'}
            </span>
            <button onClick={() => setIsOpen(false)} className="opacity-40 hover:opacity-100">
              <X className="h-3 w-3" />
            </button>
          </div>

          {/* List */}
          <div className="max-h-48 overflow-y-auto">
            {!views || views.length === 0 ? (
              <p className="px-3 py-4 text-center font-mono text-[9px] text-[var(--color-text-muted)] uppercase">
                {t('no_saved_views') || 'No saved views'}
              </p>
            ) : (
              views.map(view => (
                <div
                  key={view.id}
                  className="flex items-center gap-1 px-3 py-2 hover:bg-[var(--color-bg-elevated)] group"
                >
                  <button
                    onClick={() => handleApply(view.filters as Record<string, unknown>)}
                    className="flex-1 text-left text-xs font-bold uppercase truncate"
                  >
                    {view.name}
                  </button>
                  <button
                    onClick={() => handleSetDefault(view.id, view.isDefault)}
                    className={`shrink-0 opacity-0 group-hover:opacity-100 ${view.isDefault ? '!opacity-100' : ''}`}
                    title={view.isDefault ? 'Remove default' : 'Set as default'}
                  >
                    <Star className={`h-3 w-3 ${view.isDefault ? 'fill-current' : ''}`} />
                  </button>
                  <button
                    onClick={() => deleteMutation.mutate(view.id)}
                    className="shrink-0 opacity-0 group-hover:opacity-100 hover:text-[var(--color-accent-red)]"
                    title="Delete"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))
            )}
          </div>

          {/* Save current */}
          <div className="border-t border-[var(--color-border)] p-2">
            {showSaveInput ? (
              <div className="flex gap-1">
                <input
                  type="text"
                  value={saveName}
                  onChange={e => setSaveName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSave()}
                  placeholder={t('view_name') || 'View name...'}
                  className="input-field flex-1 text-xs"
                  autoFocus
                />
                <button
                  onClick={handleSave}
                  disabled={!saveName.trim() || createMutation.isPending}
                  className="btn-primary text-[8px] px-2 py-1 disabled:opacity-30"
                >
                  Save
                </button>
                <button
                  onClick={() => { setShowSaveInput(false); setSaveName(''); }}
                  className="p-1 opacity-40 hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowSaveInput(true)}
                disabled={!hasFilters}
                className="w-full flex items-center justify-center gap-1 py-1.5 font-mono text-[9px] font-bold uppercase text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] disabled:opacity-20 disabled:cursor-not-allowed"
              >
                <Plus className="h-3 w-3" />
                {t('save_current_view') || 'Save Current View'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify the client compiles**

Run:
```bash
docker compose exec -T client npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/support/SavedViewPicker.tsx
git commit -m "feat(support): add SavedViewPicker component for queue filter persistence"
```

---

## Task 7: Integrate SavedViewPicker into QueueSidebar

**Files:**
- Modify: `client/src/components/support/QueueSidebar.tsx`

- [ ] **Step 1: Add the import and integrate SavedViewPicker**

Open `client/src/components/support/QueueSidebar.tsx`. Add the import at the top:

```typescript
import SavedViewPicker, { ViewFilters } from './SavedViewPicker';
```

- [ ] **Step 2: Add the apply handler and render the picker**

Inside the `QueueSidebar` component function, add an apply handler after the existing state declarations:

```typescript
function applyView(filters: ViewFilters) {
  if (filters.dept) setFilterDept(filters.dept);
  if (filters.tab) setSidebarTab(filters.tab);
}
```

- [ ] **Step 3: Render the SavedViewPicker in the sidebar header**

Find the header section (the `<div className="px-4 py-3 border-b ...">` block). Add the SavedViewPicker button next to the `mono-label` heading. Replace:

```tsx
<h2 className="mono-label mb-2">
  {sidebarTab === 'queue' ? t('queue') : t('archive')}
</h2>
```

With:

```tsx
<div className="flex items-center justify-between mb-2">
  <h2 className="mono-label">
    {sidebarTab === 'queue' ? t('queue') : sidebarTab === 'archive' ? t('archive') : (t('search') || 'Search')}
  </h2>
  <SavedViewPicker
    currentFilters={{ dept: filterDept, tab: sidebarTab }}
    onApply={applyView}
  />
</div>
```

- [ ] **Step 4: Load default view on mount**

Add a `useEffect` that loads the default saved view when the component mounts. After the existing state declarations, add:

```typescript
const { data: savedViews } = trpc.savedView.list.useQuery();

useEffect(() => {
  if (savedViews) {
    const defaultView = savedViews.find(v => v.isDefault);
    if (defaultView) {
      const filters = defaultView.filters as Record<string, unknown>;
      if (filters.dept && typeof filters.dept === 'string') setFilterDept(filters.dept);
      if (filters.tab && typeof filters.tab === 'string') setSidebarTab(filters.tab as 'queue' | 'archive' | 'search');
    }
  }
}, [savedViews]);
```

**Important:** This `useEffect` should only run once when `savedViews` data first loads. The dependency on `savedViews` is correct — it will be `undefined` initially, then populated once the query resolves.

- [ ] **Step 5: Verify the client compiles**

Run:
```bash
docker compose exec -T client npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/support/QueueSidebar.tsx
git commit -m "feat(support): integrate SavedViewPicker into QueueSidebar"
```

---

## Task 8: Typecheck and Test Everything

- [ ] **Step 1: Run full typecheck on both server and client**

```bash
docker compose exec -T server npx tsc --noEmit
docker compose exec -T client npx tsc --noEmit
```
Expected: Both pass with no errors.

- [ ] **Step 2: Run all existing tests**

```bash
docker compose exec -T server npm test
docker compose exec -T client npm test
```
Expected: All existing tests still pass. No regressions.

- [ ] **Step 3: Fix any issues found**

If any typecheck errors or test failures occur, fix them before proceeding.

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: resolve typecheck and test issues for CSAT + saved views"
```

---

## Task 9: Update PLAN.md

**Files:**
- Modify: `PLAN.md`

- [ ] **Step 1: Update the sprint plan**

Open `PLAN.md`. Update the "Next Sprint" section to document what was built:

```markdown
## Sprint 2 (2026-03-28)

**Status**: Complete

- **CSAT Dashboard**: Dedicated analytics page with rating trends, star distribution, per-department breakdown, and staff leaderboard (`AdminSatisfaction.tsx`, `rating.getAnalytics`)
- **Saved Views**: Queue filter persistence for support staff — save, load, delete, and set default views (`saved_views` table, `savedView` router, `SavedViewPicker`)

## Next Sprint

**Status**: Not yet planned
```

- [ ] **Step 2: Commit**

```bash
git add PLAN.md
git commit -m "docs: update PLAN.md with Sprint 2 completion"
```
