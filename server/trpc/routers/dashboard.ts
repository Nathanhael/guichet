import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, partnerScopedProcedure } from '../trpc.js';
import { isPlatformAdmin } from '../../services/roles.js';
import { UserRole } from '../../types/index.js';
import {
  buildScorecard,
  type Scorecard,
} from '../../services/dashboard/scorecard.js';
import { fetchPeriodRollup } from '../../services/dashboard/scorecardQueries.js';
import {
  buildDeptBreakdown,
  type DeptRow,
} from '../../services/dashboard/deptBreakdown.js';
import { fetchDeptBreakdownData } from '../../services/dashboard/deptBreakdownQueries.js';
import {
  buildStaffBreakdown,
  type StaffRow,
} from '../../services/dashboard/staffBreakdown.js';
import { fetchStaffBreakdownData } from '../../services/dashboard/staffBreakdownQueries.js';
import {
  buildStaffingHeatmap,
  type StaffingHeatmap,
} from '../../services/dashboard/staffingHeatmap.js';
import { fetchStaffingHeatmapData } from '../../services/dashboard/staffingHeatmapQueries.js';
import {
  buildTrends,
  type TrendsOutput,
} from '../../services/dashboard/trends.js';
import { fetchTrendsData } from '../../services/dashboard/trendsQueries.js';
import {
  buildOnboardingState,
  type OnboardingState,
} from '../../services/dashboard/onboarding.js';
import { fetchOnboardingData } from '../../services/dashboard/onboardingQueries.js';

/**
 * Phase-1 SLA banding defaults. The `slaTargetMinutes` per dept is
 * configurable in AdminDepartments, but the *percentage* of tickets that
 * should meet SLA (and the warn-band width) is not yet stored anywhere —
 * defaulted here until the partner-level config field lands in phase 2.
 */
const DEFAULT_SLA_TARGET_PCT = 95;
const DEFAULT_SLA_WARN_PCT = 5;

const allowedRoles: UserRole[] = ['admin', 'support'];

const dashboardProcedure = partnerScopedProcedure.use(({ ctx, next }) => {
  if (!allowedRoles.includes(ctx.user.role) && !isPlatformAdmin(ctx.user.isPlatformOperator)) {
    throw new TRPCError({ code: 'FORBIDDEN' });
  }
  return next();
});

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

const dashboardFiltersSchema = z.object({
  dateFrom: z.string().regex(dateRegex, 'Invalid date format').optional(),
  dateTo: z.string().regex(dateRegex, 'Invalid date format').optional(),
  dept: z.string().optional(),
  excludeWeekends: z.boolean().optional(),
});

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_RANGE_MS = 365 * 24 * 60 * 60 * 1000;

function resolveWindow(input: { dateFrom?: string; dateTo?: string }): { from: Date; to: Date } {
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
  return { from, to };
}

export const dashboardRouter = router({
  getScorecard: dashboardProcedure
    .input(dashboardFiltersSchema)
    .query(async ({ input, ctx }): Promise<Scorecard> => {
      const partnerId = ctx.user.partnerId;
      const { from, to } = resolveWindow(input);

      const lengthMs = to.getTime() - from.getTime();
      const prevTo = new Date(from.getTime() - 1);
      const prevFrom = new Date(prevTo.getTime() - lengthMs);

      const [current, previous] = await Promise.all([
        fetchPeriodRollup(partnerId, from, to, input.dept),
        fetchPeriodRollup(partnerId, prevFrom, prevTo, input.dept),
      ]);

      return buildScorecard({
        current,
        previous,
        slaConfig: {
          targetPct: DEFAULT_SLA_TARGET_PCT,
          warnPct: DEFAULT_SLA_WARN_PCT,
        },
      });
    }),

  getDeptBreakdown: dashboardProcedure
    .input(dashboardFiltersSchema)
    .query(async ({ input, ctx }): Promise<DeptRow[]> => {
      const partnerId = ctx.user.partnerId;
      const { from, to } = resolveWindow(input);

      const data = await fetchDeptBreakdownData(partnerId, from, to);

      return buildDeptBreakdown({
        partnerId,
        window: { from, to },
        departments: data.departments,
        tickets: data.tickets,
        ratings: data.ratings,
        breaches: data.breaches,
      });
    }),

  getStaffBreakdown: dashboardProcedure
    .input(dashboardFiltersSchema)
    .query(async ({ input, ctx }): Promise<StaffRow[]> => {
      const partnerId = ctx.user.partnerId;
      const { from, to } = resolveWindow(input);

      const data = await fetchStaffBreakdownData(partnerId, from, to);

      return buildStaffBreakdown({
        partnerId,
        window: { from, to },
        tickets: data.tickets,
        ratings: data.ratings,
        staffNames: data.staffNames,
      });
    }),

  getStaffingHeatmap: dashboardProcedure
    .input(dashboardFiltersSchema)
    .query(async ({ input, ctx }): Promise<StaffingHeatmap> => {
      const partnerId = ctx.user.partnerId;
      // Z3 uses a fixed 28-day window per spec §3, regardless of the FilterBar
      // date range — the heatmap models weekly arrival patterns, not the
      // narrow current-period view used by Z1/Z2/Z5.
      const now = new Date();
      const to = now;
      const from = new Date(to.getTime() - 28 * 24 * 60 * 60 * 1000);

      const data = await fetchStaffingHeatmapData(partnerId, from, to);

      return buildStaffingHeatmap({
        dailyStats: data.dailyStats,
        agentStatus: data.agentStatus,
        window: { from, to },
        now,
        excludeWeekends: input.excludeWeekends ?? false,
      });
    }),

  getTrends: dashboardProcedure
    .input(dashboardFiltersSchema)
    .query(async ({ input, ctx }): Promise<TrendsOutput> => {
      const partnerId = ctx.user.partnerId;
      const { from, to } = resolveWindow(input);

      const rows = await fetchTrendsData(partnerId, from, to);

      return buildTrends({
        rows,
        window: { from, to },
        excludeWeekends: input.excludeWeekends ?? false,
      });
    }),

  getOnboardingState: dashboardProcedure
    .query(async ({ ctx }): Promise<OnboardingState> => {
      const partnerId = ctx.user.partnerId;
      const data = await fetchOnboardingData(partnerId);
      return buildOnboardingState(data);
    }),
});
