/**
 * Dashboard facade — single entry point for the tRPC router.
 *
 * Two functions:
 *   - resolveScope(input)          : normalize date filter + validate range
 *   - compute<R>(scope, request)   : dispatch to the per-metric fetch + build
 *
 * Replaces the per-metric routing that used to live in the dashboard router.
 * The router becomes a thin adapter: parse → resolveScope → compute → return.
 *
 * Per-metric `fetch*` + `build*` modules are still public for now to keep
 * existing per-pair tests + mocks working. Phase 3 will mark them
 * package-private and migrate tests to assert on this facade.
 *
 * tRPC coupling: resolveScope throws TRPCError on out-of-range input. The
 * router has a single caller, so duplicating a translator layer would add
 * more lines than it saves.
 */

import { TRPCError } from '@trpc/server';
import {
  buildScorecard,
  type Scorecard,
} from './scorecard.js';
import { fetchPeriodRollup } from './scorecardQueries.js';
import {
  buildDeptBreakdown,
  type DeptRow,
} from './deptBreakdown.js';
import { fetchDeptBreakdownData } from './deptBreakdownQueries.js';
import {
  buildStaffBreakdown,
  type StaffRow,
} from './staffBreakdown.js';
import { fetchStaffBreakdownData } from './staffBreakdownQueries.js';
import {
  buildStaffingHeatmap,
  type StaffingHeatmap,
} from './staffingHeatmap.js';
import { fetchStaffingHeatmapData } from './staffingHeatmapQueries.js';
import {
  buildTrends,
  type TrendsOutput,
} from './trends.js';
import { fetchTrendsData } from './trendsQueries.js';
import type { DateWindow } from './shared.js';

export type { DateWindow } from './shared.js';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_RANGE_MS = 365 * 24 * 60 * 60 * 1000;
const HEATMAP_WINDOW_MS = 28 * 24 * 60 * 60 * 1000;

/** Defaults until the partner-level SLA target/warn fields land. */
const DEFAULT_SLA_TARGET_PCT = 95;
const DEFAULT_SLA_WARN_PCT = 5;

export interface DashboardScope {
  partnerId: string;
  window: DateWindow;
  dept?: string;
}

export interface ResolveScopeInput {
  partnerId: string;
  dateFrom?: string;
  dateTo?: string;
  dept?: string;
}

export function resolveScope(input: ResolveScopeInput): DashboardScope {
  const now = new Date();
  const to = input.dateTo
    ? new Date(`${input.dateTo}T23:59:59.999Z`)
    : now;
  const from = input.dateFrom
    ? new Date(`${input.dateFrom}T00:00:00.000Z`)
    : new Date(to.getTime() - SEVEN_DAYS_MS);
  if (to.getTime() - from.getTime() > MAX_RANGE_MS) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Date range cannot exceed 365 days',
    });
  }
  return {
    partnerId: input.partnerId,
    window: { from, to },
    dept: input.dept,
  };
}

export type MetricRequest =
  | { metric: 'scorecard'; slaConfig?: { targetPct: number; warnPct: number } }
  | { metric: 'deptBreakdown' }
  | { metric: 'staffBreakdown' }
  | { metric: 'staffingHeatmap'; excludeWeekends?: boolean }
  | { metric: 'trends'; excludeWeekends?: boolean };

export type MetricResult<R extends MetricRequest> =
  R extends { metric: 'scorecard' } ? Scorecard :
  R extends { metric: 'deptBreakdown' } ? DeptRow[] :
  R extends { metric: 'staffBreakdown' } ? StaffRow[] :
  R extends { metric: 'staffingHeatmap' } ? StaffingHeatmap :
  R extends { metric: 'trends' } ? TrendsOutput :
  never;

export async function compute<R extends MetricRequest>(
  scope: DashboardScope,
  request: R,
): Promise<MetricResult<R>> {
  switch (request.metric) {
    case 'scorecard': {
      const { from, to } = scope.window;
      const lengthMs = to.getTime() - from.getTime();
      const prevTo = new Date(from.getTime() - 1);
      const prevFrom = new Date(prevTo.getTime() - lengthMs);
      const [current, previous] = await Promise.all([
        fetchPeriodRollup(scope.partnerId, from, to, scope.dept),
        fetchPeriodRollup(scope.partnerId, prevFrom, prevTo, scope.dept),
      ]);
      const result = buildScorecard({
        current,
        previous,
        slaConfig: request.slaConfig ?? {
          targetPct: DEFAULT_SLA_TARGET_PCT,
          warnPct: DEFAULT_SLA_WARN_PCT,
        },
      });
      return result as MetricResult<R>;
    }
    case 'deptBreakdown': {
      const data = await fetchDeptBreakdownData(scope.partnerId, scope.window.from, scope.window.to);
      const result = buildDeptBreakdown({
        partnerId: scope.partnerId,
        window: scope.window,
        departments: data.departments,
        tickets: data.tickets,
        ratings: data.ratings,
        breaches: data.breaches,
      });
      return result as MetricResult<R>;
    }
    case 'staffBreakdown': {
      const data = await fetchStaffBreakdownData(scope.partnerId, scope.window.from, scope.window.to);
      const result = buildStaffBreakdown({
        partnerId: scope.partnerId,
        window: scope.window,
        tickets: data.tickets,
        ratings: data.ratings,
        staffNames: data.staffNames,
      });
      return result as MetricResult<R>;
    }
    case 'staffingHeatmap': {
      // Heatmap models weekly arrival patterns and uses a fixed 28-day window
      // regardless of the user's date filter (spec §3). Overriding here keeps
      // the rule visible at the call site instead of hidden in the router.
      const now = new Date();
      const to = now;
      const from = new Date(to.getTime() - HEATMAP_WINDOW_MS);
      const data = await fetchStaffingHeatmapData(scope.partnerId, from, to);
      const result = buildStaffingHeatmap({
        dailyStats: data.dailyStats,
        agentStatus: data.agentStatus,
        window: { from, to },
        now,
        excludeWeekends: request.excludeWeekends ?? false,
      });
      return result as MetricResult<R>;
    }
    case 'trends': {
      const rows = await fetchTrendsData(scope.partnerId, scope.window.from, scope.window.to);
      const result = buildTrends({
        rows,
        window: scope.window,
        excludeWeekends: request.excludeWeekends ?? false,
      });
      return result as MetricResult<R>;
    }
  }
}

export const dashboard = { resolveScope, compute };
