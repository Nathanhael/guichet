# Admin Dashboard Rework — Design Spec

**Date:** 2026-04-20
**Scope:** Restructure the Admin → Dashboard tab around four operational questions: demand patterns, per-support throughput, per-support handle time, and outlier end-users. Kill low-value subsystems (Time-in-Status, duplicate Team Satisfaction, misnamed Agent Performance).
**Status:** Draft — awaiting approval before implementation.

## Problem

The current dashboard answers "what happened today?" (KPIs, queue health, online now) and "how did volume trend?" (line chart), but leaves core ops questions unanswered:

| question | current dashboard | verdict |
|---|---|---|
| Do we have the right people at the right moment? | "Online Now" panel — instantaneous only, no pattern | **Missing** |
| When are tickets filed most? | Tickets Trend — daily granularity only, no hour-of-day or day-of-week pattern | **Missing** |
| How many tickets per support? | "Support performance" bar chart — total + today | ✓ |
| Avg handle time per support? | Response Time KPI is global; no per-support resolution metric | **Missing** |
| Which end-users file abnormal volume (needing extra coaching)? | "Agent performance" bar chart — raw volume, no dept baseline | **Partial — misleading label, no outlier signal** |

Plus structural bugs visible in the screenshot:

- **KPI row**: `grid-cols-6` but only 5 cards → empty 6th slot
- **Dept Distribution**: wrapped in stale `grid-cols-2` → orphaned at half-width with blank gap
- **Queue Health tiles**: ternary branches for border colour are identical → dead "warning border" indicator
- **Time-in-Status** panel: UUID-prefix x-axis labels, surveillance-adjacent per-user logging, 2-status chart is shallow, only surfaced on this one dashboard

## Non-Goals

- **Coverage heatmap** (hour × day, avg agents online). Requires retaining historical presence data and hourly aggregation — out of scope for v1. Q1 is partially answered by the Demand Heatmap + existing Online Now; full coverage view deferred.
- **Drill-down to a user's ticket history** from the Users panel. Existing Tickets tab already supports `agentId` filter — don't rebuild.
- **Real-time streaming updates** on new panels. Existing 30s `refetchInterval` polling is sufficient.
- **Per-priority metrics**. Tickets have no priority column; out of scope.
- **Exporting heatmap data** to CSV/PDF. KPIs, Support Workload, Users panel go to export — heatmap stays interactive-only.

## Solution

Rework the Dashboard tab around the four questions above:

1. **Add Demand Heatmap** (hour-of-day × day-of-week) — one aggregated block answers Q1 + Q2.
2. **Upgrade Support Workload** from bar chart to table with avg first-response + avg resolution + avg rating columns — answers Q4.
3. **Add Users Needing Attention** table, replacing "Agent Performance" — delta-from-dept-avg surfaces outliers for Q5.
4. **Add Avg Resolution Time KPI** card — fills the orphan grid slot, complements existing Response Time / p95.
5. **Delete Time-in-Status subsystem** (service, tables, socket hooks, GDPR purge, UI, i18n, socket test mocks) — single surface, shallow data, surveillance-adjacent.
6. **Delete Team Satisfaction panel** on dashboard + `rating.getStaffRatings` endpoint — duplicates Satisfaction tab's richer Staff Leaderboard.
7. **Delete Agent Performance chart** + `agentStats` computation — misleading label; volume without baseline is noise.
8. **Fix layout bugs**: KPI grid (6 filled), Dept Distribution full-width, Queue Health red border on breach.

## Scope Decisions

| decision | choice | rationale |
|---|---|---|
| Users panel surface | Dashboard panel, not new sidebar tab | AdminView already has 12 tabs; one-metric tab is nav clutter; dashboard is where admins already look |
| Users ranking default | Sort by **delta-from-dept-avg** desc | Raw volume surfaces high-demand depts, not individuals in need. Delta flags true outliers |
| Heatmap granularity | 24 hours × 7 weekdays (168 cells), one metric (ticket count) | Classic support-ops grid. Two-metric (demand + coverage) deferred to v2 |
| Heatmap implementation | Custom CSS grid with colour-mapped cells, not Recharts | Recharts has no native heatmap; custom grid is ~30 LOC and matches brutalist design (no shadows, no radii) |
| Support Workload format | Table, not bar chart | Need to show 5 columns (name + 4 metrics); bar chart only fits 2 |
| Resolution time definition | `closedAt - createdAt` where `status='closed'`, averaged over range | Simplest, end-to-end. Does **not** subtract whisper-only periods or customer-wait time |
| Time-in-Status removal | Full delete (service, 2 tables, socket hooks, rollup job, GDPR hook, i18n keys) | Single consumer; resurrecting for Coverage Heatmap v2 is fresh scope anyway |
| Team Satisfaction removal | Delete panel + unused `getStaffRatings` endpoint | One caller; `getAnalytics.byStaff` covers the same data, richer, on Satisfaction tab |
| Date filter on new panels | Inherit existing dashboard `dateFrom`/`dateTo`/`statsDept` state | Consistency; no extra UI |

## Data Model

No new tables. No migrations except the **drop** migration for Time-in-Status.

### Extend `stats.getGlobalStats` return

```ts
interface DashboardData {
  // existing
  total, todayTotal, todayOpen, todayClosed,
  avgResponseMinutes, p95ResponseMinutes,
  avgRating, totalRatings, abandonedCount,
  oldestWaitMinutes, waitingOver3, resolutionRate,
  deptCounts, dailyTrend, trendGranularity,
  supportStats, previousPeriod;

  // NEW
  avgResolutionMinutes: number;              // filled; drives new KPI card
  p95ResolutionMinutes: number | null;        // (optional; cut if adds cost)
  demandHeatmap: { dow: number; hour: number; count: number }[];  // 0..6 × 0..23, up to 168 rows
  userAttention: {                            // replaces agentStats
    userId: string;
    name: string;
    deptId: string | null;
    deptName: string | null;
    total: number;
    deptAvg: number;                          // avg tickets/user within that dept over same range
    deltaPct: number;                         // (total - deptAvg) / deptAvg * 100
  }[];

  // REMOVED
  // agentStats  — killed
}
```

### Upgrade `supportStats` per-row

```ts
{
  name, total, today,              // existing
  avgResponseMinutes: number,      // first response avg per support (NEW per-support)
  avgResolutionMinutes: number,    // closed-ticket duration avg per support (NEW)
  avgRating: number | null         // existing; retained
}
```

`trend`, `deptRatings`, `depts` fields on supportStats remain unchanged.

### Dropped tables (migration)

```sql
DROP TABLE daily_agent_status;
DROP TABLE agent_status_log;
```

## Component Structure

### Delete

| path | reason |
|---|---|
| `client/src/components/admin/AgentStatusStats.tsx` | single consumer, subsystem removed |
| `server/services/statusTracking.ts` | subsystem removed |
| Associated socket test mocks in `server/socket/__tests__/{auth,disconnect,message}.test.ts` | cleanup |

### Create

| path | purpose |
|---|---|
| `client/src/components/admin/dashboard/DemandHeatmap.tsx` | 24×7 coloured-cell grid, reads `stats.demandHeatmap` |
| `client/src/components/admin/dashboard/SupportWorkloadTable.tsx` | replaces inline bar chart; sortable table |
| `client/src/components/admin/dashboard/UsersAttention.tsx` | table with delta-from-dept-avg; replaces Agent Performance bar chart |
| `client/src/components/admin/dashboard/__tests__/*.test.tsx` | unit coverage for sort + colour-mapping logic |

### Modify

| path | change |
|---|---|
| `client/src/components/admin/AdminStats.tsx` | delete `TeamSatisfaction` + `StarRating` inline; delete `<AgentStatusStats/>`; re-layout KPI row to 6 cards (+ Resolution KPI); fix Dept Distribution orphan wrapper; fix Queue Health border ternary; render new panels |
| `client/src/utils/exportDashboard.ts` | drop `agentStats` from CSV + PDF; add `avgResolutionMinutes` row; add `userAttention` section to CSV/PDF |
| `client/src/types/index.ts` | drop `agentStats` from DashboardStats; add `avgResolutionMinutes`, `userAttention`, heatmap fields |
| `server/trpc/routers/stats.ts` | add resolution-minutes aggregation, demand heatmap aggregation, dept-avg computation; drop `agentStats` builder; upgrade per-support object |
| `server/trpc/routers/rating.ts` | delete `getStaffRatings` procedure |
| `server/trpc/routers/status.ts` | delete `getAgentStats` + `getTeamStats`; keep `getTeamStatus` (Online Now panel reads it; fed by Redis presence, not the deleted subsystem) |
| `server/trpc/router.ts` | no change — `statusRouter` stays; only internal procedures removed |
| `server/app.ts` | remove `rollupDay` import + nightly schedule |
| `server/services/gdpr.ts` | remove purge hook for `agent_status_log` |
| `server/socket/handlers/auth.ts` | remove `logTransition` call |
| `server/socket/handlers/presence.ts` | remove `logTransition` call |
| `server/socket/handlers/disconnect.ts` | remove `closeOpenRow` call |
| `server/db/schema.ts` | remove `agentStatusLog` + `dailyAgentStatus` tables |
| `client/src/locales/{en,fr,nl}.ts` | remove `time_in_status`, `availability_trend` keys |
| `server/trpc/routers/__tests__/stats.test.ts` | update asserted return keys |
| `CLAUDE.md` | update Agent Status Visibility paragraph to describe only Redis-presence-based Online Now (no history logging) |
| `CHANGELOG.md` | v-next entry |

## Layout (final)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ DASHBOARD — real-time metrics              [filters]  [CSV] [PDF]       │
├─────────────────────────────────────────────────────────────────────────┤
│ Total │ Response │ p95 │ Resolution │ Satisfaction │ Abandoned          │  6 KPIs
├──────────────────────────┬──────────────────────────────────────────────┤
│ Queue Health             │                                              │
│ Online Now               │       Tickets Trend (line)                   │
│                          │                                              │
├──────────────────────────┴──────────────────────────────────────────────┤
│            Demand Heatmap — hour × weekday, ticket count                │
├─────────────────────────────────────┬───────────────────────────────────┤
│ Dept Distribution                   │ Users Needing Attention           │
├─────────────────────────────────────┴───────────────────────────────────┤
│ Support Workload — table (name / total / today / first resp / resolve /  │
│                            avg rating)                                  │
└─────────────────────────────────────────────────────────────────────────┘
```

## Open Questions

| # | question | default |
|---|---|---|
| Q1 | Resolution time — include reopened-then-closed tickets? First-close or last-close timestamp? | **First-close timestamp.** Reopens are rare; re-closes skew avg upward |
| Q2 | Demand Heatmap — user local timezone vs partner business-hours timezone vs server UTC? | **Partner business-hours timezone** (already available via `businessHoursSchedule.timezone`). Falls back to UTC if unset |
| Q3 | Users Needing Attention — include users with < 3 total tickets in range? | **Exclude.** Tiny n makes delta-% nonsense. Filter `total >= 3` |
| Q4 | Heatmap empty-range cell — blank, zero-shaded, or "no data" overlay? | **Zero-shaded** (lightest tile colour). Matches brutalist flat palette |
| Q5 | When `deptAvg` is zero (single-user dept), `deltaPct` is undefined. Show how? | **Render as `—`, sort last.** Avoid Infinity values |

Resolve before implementation begins.

## Risks

| risk | mitigation |
|---|---|
| `stats.getGlobalStats` already has significant aggregation cost; adding heatmap + per-support resolution joins may slow it | Add Postgres EXPLAIN ANALYZE check in plan Phase 2; index `tickets(partner_id, created_at)` already exists |
| Dropping `agent_status_log` is destructive — customer may request retrospective analysis later | None needed. Subsystem has zero consumers outside UI being deleted; raw data purged at 30d anyway per existing GDPR rule |
| Time-in-Status tests mocked statusTracking in ~3 socket test files — removing causes mock-variable-unused lint errors | Each phase of plan ends green; test cleanup is part of removal tasks |
| Heatmap cell colour scale misleads if one outlier cell dominates (e.g. 500 tickets on Tue 10am, rest <10) | Use log-scale or p95-capped linear scale; flagged as scope decision (log wins if tested ok) |
