import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  return {
    fetchPeriodRollup: vi.fn(),
    fetchDeptBreakdownData: vi.fn(),
    fetchStaffBreakdownData: vi.fn(),
    fetchStaffingHeatmapData: vi.fn(),
    fetchTrendsData: vi.fn(),
    fetchOnboardingData: vi.fn(),
  };
});

vi.mock('../../services/dashboard/scorecardQueries.js', () => ({
  fetchPeriodRollup: h.fetchPeriodRollup,
}));

vi.mock('../../services/dashboard/deptBreakdownQueries.js', () => ({
  fetchDeptBreakdownData: h.fetchDeptBreakdownData,
}));

vi.mock('../../services/dashboard/staffBreakdownQueries.js', () => ({
  fetchStaffBreakdownData: h.fetchStaffBreakdownData,
}));

vi.mock('../../services/dashboard/staffingHeatmapQueries.js', () => ({
  fetchStaffingHeatmapData: h.fetchStaffingHeatmapData,
}));

vi.mock('../../services/dashboard/trendsQueries.js', () => ({
  fetchTrendsData: h.fetchTrendsData,
}));

vi.mock('../../services/dashboard/onboardingQueries.js', () => ({
  fetchOnboardingData: h.fetchOnboardingData,
}));

vi.mock('../../services/roles.js', () => ({
  isPlatformAdmin: vi.fn((v: boolean) => v),
}));

vi.mock('../../utils/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../config.js', () => ({
  default: { JWT_SECRET: 'test-secret-key-that-is-long-enough-for-hs256' },
}));

vi.mock('../../constants.js', () => ({
  DISABLED_FEATURES: [],
}));

vi.mock('../../services/sessionRevocation.js', () => ({
  isRevoked: vi.fn().mockResolvedValue(false),
}));

import { dashboardRouter } from './dashboard.js';

type CallerCtx = Parameters<typeof dashboardRouter.createCaller>[0];

function caller(over: Partial<{
  partnerId: string | null;
  role: 'admin' | 'support' | 'agent';
  isPlatformOperator: boolean;
}> = {}) {
  return dashboardRouter.createCaller({
    user: {
      id: 'u1',
      partnerId: over.partnerId ?? 'p1',
      role: over.role ?? 'admin',
      isPlatformOperator: over.isPlatformOperator ?? false,
      departments: [],
    },
  } as unknown as CallerCtx);
}

const EMPTY_ROLLUP = {
  totalTickets: 0,
  ticketsMetSla: 0,
  ticketsWithResponse: 0,
  ratingSum: 0,
  ratingCount: 0,
  p95ResponseMinutes: null,
};

describe('dashboardRouter.getScorecard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.fetchPeriodRollup.mockResolvedValue({ ...EMPTY_ROLLUP });
  });

  it('returns three cards with the expected keys', async () => {
    const out = await caller().getScorecard({});
    for (const key of ['sla', 'csat', 'volume'] as const) {
      expect(out[key]).toHaveProperty('value');
      expect(out[key]).toHaveProperty('prevValue');
      expect(out[key]).toHaveProperty('deltaPct');
      expect(out[key].band).toMatch(/green|amber|red|neutral/);
    }
  });

  it('forwards ctx.user.partnerId to every rollup query (current + previous)', async () => {
    await caller({ partnerId: 'tenant-x' }).getScorecard({
      dateFrom: '2026-04-18',
      dateTo: '2026-04-25',
    });
    const calls = h.fetchPeriodRollup.mock.calls;
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call[0]).toBe('tenant-x');
    }
  });

  it('queries the previous period as the same length immediately before the current period', async () => {
    await caller().getScorecard({
      dateFrom: '2026-04-18',
      dateTo: '2026-04-24',
    });
    const [, currentFrom, currentTo] = h.fetchPeriodRollup.mock.calls[0];
    const [, prevFrom, prevTo] = h.fetchPeriodRollup.mock.calls[1];
    const len = currentTo.getTime() - currentFrom.getTime();
    expect(prevTo.getTime() - prevFrom.getTime()).toBeCloseTo(len, -3);
    expect(prevTo.getTime()).toBeLessThanOrEqual(currentFrom.getTime());
  });

  it('rejects date ranges greater than 365 days', async () => {
    await expect(
      caller().getScorecard({
        dateFrom: '2025-01-01',
        dateTo: '2026-04-01',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('paints SLA green when current period meets the default 95% target', async () => {
    h.fetchPeriodRollup.mockResolvedValueOnce({
      ...EMPTY_ROLLUP,
      totalTickets: 100,
      ticketsMetSla: 96,
      ticketsWithResponse: 100,
    });
    h.fetchPeriodRollup.mockResolvedValueOnce({ ...EMPTY_ROLLUP });
    const out = await caller().getScorecard({});
    expect(out.sla.value).toBe(96);
    expect(out.sla.band).toBe('green');
  });

  it('paints SLA red when far below the warn band', async () => {
    h.fetchPeriodRollup.mockResolvedValueOnce({
      ...EMPTY_ROLLUP,
      totalTickets: 100,
      ticketsMetSla: 80,
      ticketsWithResponse: 100,
    });
    h.fetchPeriodRollup.mockResolvedValueOnce({ ...EMPTY_ROLLUP });
    const out = await caller().getScorecard({});
    expect(out.sla.band).toBe('red');
  });

  it('reports volume and CSAT with neutral bands and computed delta', async () => {
    h.fetchPeriodRollup.mockResolvedValueOnce({
      ...EMPTY_ROLLUP,
      totalTickets: 120,
      ratingSum: 90,
      ratingCount: 20,
    });
    h.fetchPeriodRollup.mockResolvedValueOnce({
      ...EMPTY_ROLLUP,
      totalTickets: 100,
      ratingSum: 80,
      ratingCount: 20,
    });
    const out = await caller().getScorecard({});
    expect(out.volume).toMatchObject({ value: 120, prevValue: 100, deltaPct: 20, band: 'neutral' });
    expect(out.csat).toMatchObject({ value: 4.5, prevValue: 4, band: 'neutral' });
  });

  it('agents are forbidden', async () => {
    await expect(
      caller({ role: 'agent' }).getScorecard({}),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('platform operators bypass the role gate on scorecard', async () => {
    await expect(
      caller({ role: 'agent', isPlatformOperator: true }).getScorecard({}),
    ).resolves.toBeDefined();
  });
});

describe('dashboardRouter.getDeptBreakdown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.fetchDeptBreakdownData.mockResolvedValue({
      tickets: [],
      ratings: [],
      breaches: [],
      departments: [],
    });
  });

  it('returns an empty array when no data is supplied', async () => {
    const out = await caller().getDeptBreakdown({});
    expect(out).toEqual([]);
  });

  it('forwards ctx.user.partnerId to the queries (never trusts input)', async () => {
    await caller({ partnerId: 'tenant-x' }).getDeptBreakdown({});
    const [partnerId] = h.fetchDeptBreakdownData.mock.calls[0];
    expect(partnerId).toBe('tenant-x');
  });

  it('uses a 7-day default window when no dates are supplied', async () => {
    await caller().getDeptBreakdown({});
    const [, from, to] = h.fetchDeptBreakdownData.mock.calls[0];
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    expect(to.getTime() - from.getTime()).toBeGreaterThanOrEqual(sevenDaysMs - 1000);
    expect(to.getTime() - from.getTime()).toBeLessThanOrEqual(sevenDaysMs + 1000);
  });

  it('rejects date ranges greater than 365 days', async () => {
    await expect(
      caller().getDeptBreakdown({
        dateFrom: '2025-01-01',
        dateTo: '2026-04-01',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('forwards rows from the queries through buildDeptBreakdown', async () => {
    h.fetchDeptBreakdownData.mockResolvedValue({
      tickets: [
        {
          id: 't-1',
          partnerId: 'p1',
          dept: 'sales',
          createdAt: new Date('2026-04-22T09:00:00Z'),
          firstStaffResponseAt: new Date('2026-04-22T09:10:00Z'),
        },
      ],
      ratings: [],
      breaches: [],
      departments: [
        {
          id: 'sales',
          name: 'Sales',
          sla: { enabled: true, firstResponseMinutes: 30 },
        },
      ],
    });
    const out = await caller().getDeptBreakdown({
      dateFrom: '2026-04-20',
      dateTo: '2026-04-25',
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'sales', name: 'Sales', volume: 1, slaPct: 100 });
  });

  it('agents are forbidden', async () => {
    await expect(
      caller({ role: 'agent' }).getDeptBreakdown({}),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('platform operators bypass the role gate on dept breakdown', async () => {
    await expect(
      caller({ role: 'agent', isPlatformOperator: true }).getDeptBreakdown({}),
    ).resolves.toBeDefined();
  });
});

describe('dashboardRouter.getStaffBreakdown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.fetchStaffBreakdownData.mockResolvedValue({
      tickets: [],
      ratings: [],
      staffNames: new Map(),
    });
  });

  it('returns an empty array when no data is supplied', async () => {
    const out = await caller().getStaffBreakdown({});
    expect(out).toEqual([]);
  });

  it('forwards ctx.user.partnerId to the queries (never trusts input)', async () => {
    await caller({ partnerId: 'tenant-x' }).getStaffBreakdown({});
    const [partnerId] = h.fetchStaffBreakdownData.mock.calls[0];
    expect(partnerId).toBe('tenant-x');
  });

  it('uses a 7-day default window when no dates are supplied', async () => {
    await caller().getStaffBreakdown({});
    const [, from, to] = h.fetchStaffBreakdownData.mock.calls[0];
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    expect(to.getTime() - from.getTime()).toBeGreaterThanOrEqual(sevenDaysMs - 1000);
    expect(to.getTime() - from.getTime()).toBeLessThanOrEqual(sevenDaysMs + 1000);
  });

  it('rejects date ranges greater than 365 days', async () => {
    await expect(
      caller().getStaffBreakdown({
        dateFrom: '2025-01-01',
        dateTo: '2026-04-01',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('forwards rows from the queries through buildStaffBreakdown', async () => {
    h.fetchStaffBreakdownData.mockResolvedValue({
      tickets: [
        {
          id: 't-1',
          partnerId: 'p1',
          supportId: 'u-alice',
          createdAt: new Date('2026-04-22T09:00:00Z'),
          firstStaffResponseAt: new Date('2026-04-22T09:10:00Z'),
        },
      ],
      ratings: [],
      staffNames: new Map([['u-alice', 'Alice']]),
    });
    const out = await caller().getStaffBreakdown({
      dateFrom: '2026-04-20',
      dateTo: '2026-04-25',
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: 'u-alice',
      name: 'Alice',
      handled: 1,
      avgResponseMinutes: 10,
      csat: null,
    });
  });

  it('agents are forbidden', async () => {
    await expect(
      caller({ role: 'agent' }).getStaffBreakdown({}),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('platform operators bypass the role gate on staff breakdown', async () => {
    await expect(
      caller({ role: 'agent', isPlatformOperator: true }).getStaffBreakdown({}),
    ).resolves.toBeDefined();
  });
});

describe('dashboardRouter.getStaffingHeatmap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.fetchStaffingHeatmapData.mockResolvedValue({ dailyStats: [], agentStatus: [] });
  });

  it('returns empty matrix + zero-strip + 0 daysCollected when queries return no rows', async () => {
    const out = await caller().getStaffingHeatmap({});
    expect(out.heatmap).toEqual([]);
    expect(out.todayVsTypical).toHaveLength(24);
    expect(out.daysCollected).toBe(0);
  });

  it('forwards ctx.user.partnerId to the query (never trusts input)', async () => {
    await caller({ partnerId: 'tenant-x' }).getStaffingHeatmap({});
    const [partnerId] = h.fetchStaffingHeatmapData.mock.calls[0];
    expect(partnerId).toBe('tenant-x');
  });

  it('uses a 28-day window regardless of caller filter (PRD §3 Z3 fixed window)', async () => {
    await caller().getStaffingHeatmap({});
    const [, from, to] = h.fetchStaffingHeatmapData.mock.calls[0];
    const days = Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
    expect(days).toBeGreaterThanOrEqual(27);
    expect(days).toBeLessThanOrEqual(28);
  });

  it('forwards rows from the query through buildStaffingHeatmap', async () => {
    h.fetchStaffingHeatmapData.mockResolvedValue({
      dailyStats: [
        { date: '2026-04-22', hourly: Array.from({ length: 24 }, (_, h) => (h === 9 ? 5 : 0)) },
      ],
      agentStatus: [],
    });
    const out = await caller().getStaffingHeatmap({});
    expect(out.daysCollected).toBe(1);
    expect(out.heatmap.find((c) => c.hour === 9)?.tickets).toBe(5);
  });

  it('honors the excludeWeekends filter', async () => {
    h.fetchStaffingHeatmapData.mockResolvedValue({
      dailyStats: [
        { date: '2026-04-25', hourly: Array.from({ length: 24 }, (_, h) => (h === 9 ? 9 : 0)) },
        { date: '2026-04-21', hourly: Array.from({ length: 24 }, (_, h) => (h === 9 ? 5 : 0)) },
      ],
      agentStatus: [],
    });
    const out = await caller().getStaffingHeatmap({ excludeWeekends: true });
    expect(out.heatmap.find((c) => c.dow === 6)).toBeUndefined();
    expect(out.heatmap.find((c) => c.dow === 2)?.tickets).toBe(5);
  });

  it('passes agentStatus rows through to surface a staff overlay', async () => {
    h.fetchStaffingHeatmapData.mockResolvedValue({
      dailyStats: [
        { date: '2026-04-21', hourly: Array.from({ length: 24 }, (_, h) => (h === 9 ? 5 : 0)) },
      ],
      agentStatus: [
        { date: '2026-04-21', userId: 'u-a', onlineSeconds: 3600 },
        { date: '2026-04-21', userId: 'u-b', onlineSeconds: 7200 },
      ],
    });
    const out = await caller().getStaffingHeatmap({});
    const tuesday9 = out.heatmap.find((c) => c.dow === 2 && c.hour === 9);
    expect(tuesday9?.staff).toBe(2);
  });

  it('agents are forbidden', async () => {
    await expect(
      caller({ role: 'agent' }).getStaffingHeatmap({}),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('platform operators bypass the role gate on staffing heatmap', async () => {
    await expect(
      caller({ role: 'agent', isPlatformOperator: true }).getStaffingHeatmap({}),
    ).resolves.toBeDefined();
  });
});

describe('dashboardRouter.getTrends', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.fetchTrendsData.mockResolvedValue([]);
  });

  it('returns daily granularity and empty series when no rows are present', async () => {
    const out = await caller().getTrends({});
    expect(out.granularity).toBe('daily');
    expect(out.series.volume).toEqual([]);
    expect(out.series.csat).toEqual([]);
    expect(out.series.avgResponseMinutes).toEqual([]);
  });

  it('forwards ctx.user.partnerId to the query (never trusts input)', async () => {
    await caller({ partnerId: 'tenant-x' }).getTrends({});
    const [partnerId] = h.fetchTrendsData.mock.calls[0];
    expect(partnerId).toBe('tenant-x');
  });

  it('uses the FilterBar window when supplied', async () => {
    await caller().getTrends({
      dateFrom: '2026-04-01',
      dateTo: '2026-04-15',
    });
    const [, from, to] = h.fetchTrendsData.mock.calls[0];
    expect(from.toISOString().slice(0, 10)).toBe('2026-04-01');
    expect(to.toISOString().slice(0, 10)).toBe('2026-04-15');
  });

  it('rejects date ranges greater than 365 days', async () => {
    await expect(
      caller().getTrends({
        dateFrom: '2025-01-01',
        dateTo: '2026-04-01',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('forwards rows from the query through buildTrends', async () => {
    h.fetchTrendsData.mockResolvedValue([
      {
        date: '2026-04-22',
        total: 5,
        ratingSum: 8,
        ratingCount: 2,
        responseSumMs: 600_000,
        responseCount: 2,
      },
    ]);
    const out = await caller().getTrends({
      dateFrom: '2026-04-20',
      dateTo: '2026-04-25',
    });
    expect(out.granularity).toBe('daily');
    expect(out.series.volume).toEqual([{ bucket: '2026-04-22', value: 5 }]);
    expect(out.series.csat[0]).toMatchObject({ value: 4 });
  });

  it('agents are forbidden', async () => {
    await expect(
      caller({ role: 'agent' }).getTrends({}),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('platform operators bypass the role gate on trends', async () => {
    await expect(
      caller({ role: 'agent', isPlatformOperator: true }).getTrends({}),
    ).resolves.toBeDefined();
  });
});

describe('dashboardRouter.getOnboardingState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.fetchOnboardingData.mockResolvedValue({
      closedTicketCount: 0,
      nonAdminStaffCount: 0,
      departments: [],
      businessHoursSchedule: null,
    });
  });

  it('reports isNewPartner=true for a brand-new partner', async () => {
    const out = await caller().getOnboardingState();
    expect(out.isNewPartner).toBe(true);
    expect(out.steps.every((s) => s.done === false)).toBe(true);
  });

  it('reports isNewPartner=false once one closed ticket exists', async () => {
    h.fetchOnboardingData.mockResolvedValue({
      closedTicketCount: 1,
      nonAdminStaffCount: 0,
      departments: [],
      businessHoursSchedule: null,
    });
    const out = await caller().getOnboardingState();
    expect(out.isNewPartner).toBe(false);
  });

  it('forwards ctx.user.partnerId to the query (never trusts input)', async () => {
    await caller({ partnerId: 'tenant-x' }).getOnboardingState();
    expect(h.fetchOnboardingData).toHaveBeenCalledWith('tenant-x');
  });

  it('exposes the four canonical steps with done flags from buildOnboardingState', async () => {
    h.fetchOnboardingData.mockResolvedValue({
      closedTicketCount: 0,
      nonAdminStaffCount: 2,
      departments: [
        { id: 'sales', name: 'Sales', sla: { enabled: true, firstResponseMinutes: 30 } },
      ],
      businessHoursSchedule: { timezone: 'Europe/Brussels' },
    });
    const out = await caller().getOnboardingState();
    expect(out.steps.map((s) => ({ id: s.id, done: s.done }))).toEqual([
      { id: 'departments', done: true },
      { id: 'team', done: true },
      { id: 'businessHours', done: true },
      { id: 'sla', done: true },
    ]);
  });

  it('agents are forbidden', async () => {
    await expect(
      caller({ role: 'agent' }).getOnboardingState(),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('platform operators bypass the role gate on onboarding state', async () => {
    await expect(
      caller({ role: 'agent', isPlatformOperator: true }).getOnboardingState(),
    ).resolves.toBeDefined();
  });
});
