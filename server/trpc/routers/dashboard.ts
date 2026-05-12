import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, partnerScopedProcedure } from '../trpc.js';
import { isPlatformAdmin } from '../../services/roles.js';
import { UserRole } from '../../types/index.js';
import { dashboard } from '../../services/dashboard/index.js';
import type { Scorecard } from '../../services/dashboard/scorecard.js';
import type { DeptRow } from '../../services/dashboard/deptBreakdown.js';
import type { StaffRow } from '../../services/dashboard/staffBreakdown.js';
import type { StaffingHeatmap } from '../../services/dashboard/staffingHeatmap.js';
import type { TrendsOutput } from '../../services/dashboard/trends.js';
import {
  buildOnboardingState,
  type OnboardingState,
} from '../../services/dashboard/onboarding.js';
import { fetchOnboardingData } from '../../services/dashboard/onboardingQueries.js';

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

export const dashboardRouter = router({
  getScorecard: dashboardProcedure
    .input(dashboardFiltersSchema)
    .query(({ input, ctx }): Promise<Scorecard> => {
      const scope = dashboard.resolveScope({ partnerId: ctx.user.partnerId, ...input });
      return dashboard.compute(scope, { metric: 'scorecard' });
    }),

  getDeptBreakdown: dashboardProcedure
    .input(dashboardFiltersSchema)
    .query(({ input, ctx }): Promise<DeptRow[]> => {
      const scope = dashboard.resolveScope({ partnerId: ctx.user.partnerId, ...input });
      return dashboard.compute(scope, { metric: 'deptBreakdown' });
    }),

  getStaffBreakdown: dashboardProcedure
    .input(dashboardFiltersSchema)
    .query(({ input, ctx }): Promise<StaffRow[]> => {
      const scope = dashboard.resolveScope({ partnerId: ctx.user.partnerId, ...input });
      return dashboard.compute(scope, { metric: 'staffBreakdown' });
    }),

  getStaffingHeatmap: dashboardProcedure
    .input(dashboardFiltersSchema)
    .query(({ input, ctx }): Promise<StaffingHeatmap> => {
      const scope = dashboard.resolveScope({ partnerId: ctx.user.partnerId, ...input });
      return dashboard.compute(scope, {
        metric: 'staffingHeatmap',
        excludeWeekends: input.excludeWeekends ?? false,
      });
    }),

  getTrends: dashboardProcedure
    .input(dashboardFiltersSchema)
    .query(({ input, ctx }): Promise<TrendsOutput> => {
      const scope = dashboard.resolveScope({ partnerId: ctx.user.partnerId, ...input });
      return dashboard.compute(scope, {
        metric: 'trends',
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
