import { useMemo } from 'react';
import { useDashboardFilters } from '../../../hooks/useDashboardFilters';
import { trpc } from '../../../utils/trpc';
import { resolveDateRange } from '../../../utils/dashboardDateRange';
import { FilterBar } from './FilterBar';
import { Scorecard, type ScorecardData } from './Scorecard';
import { DeptBreakdownTable, type DeptRow } from './DeptBreakdownTable';
import { StaffBreakdownTable, type StaffRow } from './StaffBreakdownTable';
import {
  StaffingHeatmapZone,
  type StaffingHeatmapData,
} from './StaffingHeatmapZone';
import { TrendsZone, type TrendsData } from './TrendsZone';
import {
  OnboardingChecklist,
  type OnboardingChecklistData,
} from './OnboardingChecklist';
import { exportDashboardCsv, exportDashboardPdf } from '../../../utils/dashboardExport';
import { useT } from '../../../i18n';

/**
 * AdminView default `dashboard` tab.
 *
 * Hosts the URL-persisted filter hook and renders the 4 zones:
 *   Z2 Scorecard · Z3 Staffing fit
 *   Z4 Trend charts · Z5 Breakdown tables (staff + dept)
 *
 * Brand-new partners (zero closed tickets, zero non-admin staff) see the
 * onboarding checklist instead, gated on `dashboard.getOnboardingState`.
 *
CSV and PDF exports both compose the already-fetched zone payloads
 * client-side. PDF goes through the browser's print dialog ("Save as PDF")
 * — cheaper than bundling jspdf for a once-a-day morning glance.
 */
export interface DashboardViewProps {
  departments?: { id: string; name: string }[];
}

export function DashboardView({
  departments = [],
}: DashboardViewProps = {}) {
  const t = useT();
  const { filters, applyPreset, setFilter, reset } = useDashboardFilters();

  const range = useMemo(() => resolveDateRange(filters), [filters]);

  const queryInput = {
    dateFrom: range.dateFrom,
    dateTo: range.dateTo,
    dept: filters.dept,
    excludeWeekends: filters.excludeWeekends,
  };

  const scorecardQuery = trpc.dashboard.getScorecard.useQuery(queryInput);
  const deptBreakdownQuery = trpc.dashboard.getDeptBreakdown.useQuery(queryInput);
  const staffBreakdownQuery = trpc.dashboard.getStaffBreakdown.useQuery(queryInput);
  const staffingHeatmapQuery = trpc.dashboard.getStaffingHeatmap.useQuery(queryInput);
  const trendsQuery = trpc.dashboard.getTrends.useQuery(queryInput);
  const onboardingQuery = trpc.dashboard.getOnboardingState.useQuery();

  const rootAttrs: Record<string, string> = {
    'data-preset': filters.preset,
    'data-weekends': filters.excludeWeekends ? 'on' : 'off',
  };
  if (filters.dept) rootAttrs['data-dept'] = filters.dept;
  if (filters.dateFrom) rootAttrs['data-from'] = filters.dateFrom;
  if (filters.dateTo) rootAttrs['data-to'] = filters.dateTo;

  const scorecardData = (scorecardQuery.data ?? null) as ScorecardData | null;
  const deptBreakdownData = (deptBreakdownQuery.data ?? null) as DeptRow[] | null;
  const staffBreakdownData = (staffBreakdownQuery.data ?? null) as StaffRow[] | null;
  const staffingHeatmapData = (staffingHeatmapQuery.data ?? null) as StaffingHeatmapData | null;
  const trendsData = (trendsQuery.data ?? null) as TrendsData | null;
  const onboardingData = (onboardingQuery.data ?? null) as OnboardingChecklistData | null;
  const showOnboarding = onboardingData?.isNewPartner === true;

  const refreshAll = () => {
    scorecardQuery.refetch();
    deptBreakdownQuery.refetch();
    staffBreakdownQuery.refetch();
    staffingHeatmapQuery.refetch();
    trendsQuery.refetch();
  };

  const canExport =
    !!scorecardData ||
    (deptBreakdownData?.length ?? 0) > 0 ||
    (staffBreakdownData?.length ?? 0) > 0 ||
    !!trendsData;

  const buildSnapshot = () => {
    if (!scorecardData || !trendsData) return null;
    return {
      filters: {
        dateFrom: range.dateFrom,
        dateTo: range.dateTo,
        dept: filters.dept,
        excludeWeekends: filters.excludeWeekends,
      },
      scorecard: scorecardData,
      deptBreakdown: deptBreakdownData ?? [],
      staffBreakdown: staffBreakdownData ?? [],
      trends: trendsData,
    };
  };

  const handleExportCsv = canExport
    ? () => {
        const snapshot = buildSnapshot();
        if (snapshot) exportDashboardCsv(snapshot);
      }
    : undefined;

  const handleExportPdf = canExport
    ? () => {
        const snapshot = buildSnapshot();
        if (snapshot) exportDashboardPdf(snapshot);
      }
    : undefined;

  if (showOnboarding && onboardingData) {
    return (
      <div
        data-testid="dashboard-view"
        data-mode="onboarding"
        className="flex flex-col gap-6 p-6"
      >
        <OnboardingChecklist data={onboardingData} />
      </div>
    );
  }

  return (
    <div
      data-testid="dashboard-view"
      className="flex flex-col gap-6 p-6"
      {...rootAttrs}
    >
      <header
        data-testid="dashboard-filter-bar"
        aria-label={t('dashboard_filters_aria')}
        className="flex items-center justify-between"
      >
        <FilterBar
          filters={filters}
          applyPreset={applyPreset}
          setFilter={setFilter}
          reset={reset}
          departments={departments}
          onRefresh={refreshAll}
          onExportCsv={handleExportCsv}
          onExportPdf={handleExportPdf}
        />
      </header>

      <DashboardZone testId="dashboard-zone-scorecard" title={t('zone_scorecard')}>
        <Scorecard
          data={scorecardData}
          loading={scorecardQuery.isLoading}
          error={scorecardQuery.isError}
          onRetry={() => scorecardQuery.refetch()}
        />
      </DashboardZone>
      <DashboardZone testId="dashboard-zone-staffing" title={t('zone_staffing_fit')}>
        <StaffingHeatmapZone
          data={staffingHeatmapData}
          loading={staffingHeatmapQuery.isLoading}
          error={staffingHeatmapQuery.isError}
          onRetry={() => staffingHeatmapQuery.refetch()}
          excludeWeekends={filters.excludeWeekends}
        />
      </DashboardZone>
      <DashboardZone testId="dashboard-zone-trends" title={t('zone_trends')}>
        <TrendsZone
          data={trendsData}
          loading={trendsQuery.isLoading}
          error={trendsQuery.isError}
          onRetry={() => trendsQuery.refetch()}
        />
      </DashboardZone>
      <DashboardZone testId="dashboard-zone-breakdown" title={t('zone_breakdown')}>
        <StaffBreakdownTable
          data={staffBreakdownData}
          loading={staffBreakdownQuery.isLoading}
          error={staffBreakdownQuery.isError}
          onRetry={() => staffBreakdownQuery.refetch()}
        />
        <DeptBreakdownTable
          data={deptBreakdownData}
          loading={deptBreakdownQuery.isLoading}
          error={deptBreakdownQuery.isError}
          onRetry={() => deptBreakdownQuery.refetch()}
        />
      </DashboardZone>
    </div>
  );
}

function DashboardZone({
  testId,
  title,
  children,
}: {
  testId: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <section
      data-testid={testId}
      aria-label={title}
      className="rounded-[var(--radius-card)] bg-[var(--color-bg-surface)] shadow-[var(--shadow-card)] p-4 flex flex-col gap-3"
    >
      <h2 className="text-[13px] font-medium text-[var(--color-ink)]">{title}</h2>
      {children}
    </section>
  );
}

export default DashboardView;
