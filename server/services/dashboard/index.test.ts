/**
 * Boundary tests for the dashboard facade.
 *
 * Covers behavior that only exists at the facade level — range validation,
 * default window, the heatmap 28-day override, and the scorecard prior-
 * period derivation. Per-metric transform logic is covered by the existing
 * per-pair tests (scorecard.test.ts, deptBreakdown.test.ts, etc.).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  fetchPeriodRollup: vi.fn(),
  fetchDeptBreakdownData: vi.fn(),
  fetchStaffBreakdownData: vi.fn(),
  fetchStaffingHeatmapData: vi.fn(),
  fetchTrendsData: vi.fn(),
}));

vi.mock('./scorecardQueries.js', () => ({
  fetchPeriodRollup: h.fetchPeriodRollup,
}));
vi.mock('./deptBreakdownQueries.js', () => ({
  fetchDeptBreakdownData: h.fetchDeptBreakdownData,
}));
vi.mock('./staffBreakdownQueries.js', () => ({
  fetchStaffBreakdownData: h.fetchStaffBreakdownData,
}));
vi.mock('./staffingHeatmapQueries.js', () => ({
  fetchStaffingHeatmapData: h.fetchStaffingHeatmapData,
}));
vi.mock('./trendsQueries.js', () => ({
  fetchTrendsData: h.fetchTrendsData,
}));

import { compute, resolveScope } from './index.js';

const EMPTY_ROLLUP = {
  totalTickets: 0,
  ticketsMetSla: 0,
  ticketsWithResponse: 0,
  ratingSum: 0,
  ratingCount: 0,
  p95ResponseMinutes: null,
};

describe('resolveScope', () => {
  beforeEach(() => vi.clearAllMocks());

  it('defaults to a 7-day window when dateFrom/dateTo are omitted', () => {
    const before = Date.now();
    const scope = resolveScope({ partnerId: 'p1' });
    const after = Date.now();
    // `to` should be now-ish; `from` should be 7 days before `to`.
    expect(scope.window.to.getTime()).toBeGreaterThanOrEqual(before);
    expect(scope.window.to.getTime()).toBeLessThanOrEqual(after);
    const span = scope.window.to.getTime() - scope.window.from.getTime();
    expect(span).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('parses ISO dates with start-of-day and end-of-day UTC anchors', () => {
    const scope = resolveScope({
      partnerId: 'p1',
      dateFrom: '2026-04-18',
      dateTo: '2026-04-25',
    });
    expect(scope.window.from.toISOString()).toBe('2026-04-18T00:00:00.000Z');
    expect(scope.window.to.toISOString()).toBe('2026-04-25T23:59:59.999Z');
  });

  it('throws BAD_REQUEST when the range exceeds 365 days', () => {
    expect(() =>
      resolveScope({
        partnerId: 'p1',
        dateFrom: '2025-01-01',
        dateTo: '2026-04-01',
      }),
    ).toThrowError(expect.objectContaining({ code: 'BAD_REQUEST' }));
  });

  it('passes through partnerId and dept', () => {
    const scope = resolveScope({ partnerId: 'tenant-x', dept: 'sales' });
    expect(scope.partnerId).toBe('tenant-x');
    expect(scope.dept).toBe('sales');
  });
});

describe('compute — scorecard prior-period derivation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.fetchPeriodRollup.mockResolvedValue({ ...EMPTY_ROLLUP });
  });

  it('fetches current and previous periods as same-length, prev ending right before current starts', async () => {
    const scope = resolveScope({
      partnerId: 'p1',
      dateFrom: '2026-04-18',
      dateTo: '2026-04-24',
    });
    await compute(scope, { metric: 'scorecard' });

    expect(h.fetchPeriodRollup).toHaveBeenCalledTimes(2);
    const [, currentFrom, currentTo] = h.fetchPeriodRollup.mock.calls[0];
    const [, prevFrom, prevTo] = h.fetchPeriodRollup.mock.calls[1];

    const currentLen = (currentTo as Date).getTime() - (currentFrom as Date).getTime();
    const prevLen = (prevTo as Date).getTime() - (prevFrom as Date).getTime();
    expect(prevLen).toBeCloseTo(currentLen, -3);
    expect((prevTo as Date).getTime()).toBeLessThan((currentFrom as Date).getTime());
  });

  it('honors a caller-supplied slaConfig', async () => {
    h.fetchPeriodRollup.mockResolvedValueOnce({
      ...EMPTY_ROLLUP,
      totalTickets: 100,
      ticketsMetSla: 81,
      ticketsWithResponse: 100,
    });
    h.fetchPeriodRollup.mockResolvedValueOnce({ ...EMPTY_ROLLUP });
    const scope = resolveScope({ partnerId: 'p1' });

    // Default would paint 81% red (target 95, warn 5). With a more lenient
    // override the same value paints green.
    const out = await compute(scope, {
      metric: 'scorecard',
      slaConfig: { targetPct: 80, warnPct: 5 },
    });
    expect(out.sla.value).toBe(81);
    expect(out.sla.band).toBe('green');
  });
});

describe('compute — staffingHeatmap window override', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.fetchStaffingHeatmapData.mockResolvedValue({ dailyStats: [], agentStatus: [] });
  });

  it('uses a fixed 28-day window regardless of the scope', async () => {
    // Scope says March 2026, but the heatmap should ignore that and use ~28
    // days ending now. This is the rule that used to be a silent inline
    // branch in the router — making it visible at the metric case was the
    // headline win of phase 2.
    const scope = resolveScope({
      partnerId: 'p1',
      dateFrom: '2026-03-01',
      dateTo: '2026-03-15',
    });
    await compute(scope, { metric: 'staffingHeatmap' });

    expect(h.fetchStaffingHeatmapData).toHaveBeenCalledTimes(1);
    const [, from, to] = h.fetchStaffingHeatmapData.mock.calls[0];
    const span = (to as Date).getTime() - (from as Date).getTime();
    expect(span).toBe(28 * 24 * 60 * 60 * 1000);
    // And `to` is now-ish, not 2026-03-15.
    expect(Math.abs((to as Date).getTime() - Date.now())).toBeLessThan(5_000);
  });
});
