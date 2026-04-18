import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks (available before vi.mock hoisting) ─────────────────────

const { emptyRows, dbExecuteMock, dbSelectMock, whereMock, mockDayData } = vi.hoisted(() => {
  const emptyRows = { rows: [] };
  const dbExecuteMock = vi.fn().mockResolvedValue(emptyRows);
  const dbSelectMock = vi.fn();
  const fromMock = vi.fn();
  const whereMock = vi.fn();
  const limitMock = vi.fn();

  dbSelectMock.mockReturnValue({ from: fromMock });
  fromMock.mockReturnValue({ where: whereMock });
  whereMock.mockReturnValue({ limit: limitMock });
  whereMock.mockResolvedValue([]);
  limitMock.mockResolvedValue([]);

  const mockDayData = {
    total: 0,
    deptCounts: {},
    closed: 0,
    abandoned: 0,
    reopened: 0,
    responseSum: 0,
    responseCount: 0,
    p95ResponseMs: 0,
    durationSum: 0,
    durationCount: 0,
    ratingSum: 0,
    ratingCount: 0,
    ratingsByDept: {},
    sentimentSum: 0,
    sentimentCount: 0,
    deptResolved: {},
    hourly: Array(24).fill(0),
    supportIds: [],
  };

  return { emptyRows, dbExecuteMock, dbSelectMock, fromMock, whereMock, limitMock, mockDayData };
});

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('../../../db.js', () => ({
  db: {
    execute: dbExecuteMock,
    select: dbSelectMock,
  },
}));

vi.mock('../../../db/schema.js', () => ({
  partners: { id: 'id' },
  users: { id: 'id', name: 'name' },
}));

vi.mock('../../../services/stats.js', () => ({
  computeLiveDayStats: vi.fn().mockReturnValue(mockDayData),
  calculatePercentile: vi.fn().mockReturnValue(0),
}));

vi.mock('../../../services/roles.js', () => ({
  isPlatformAdmin: vi.fn((v: boolean) => v),
  isTenantAdmin: vi.fn((role: string) => role === 'admin'),
}));

vi.mock('../../../utils/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../services/sessionRevocation.js', () => ({
  isRevoked: vi.fn().mockResolvedValue(false),
}));

vi.mock('../../../config.js', () => ({
  default: { JWT_SECRET: 'test-secret-key-that-is-long-enough-for-hs256' },
}));

vi.mock('../../../constants.js', () => ({
  DISABLED_FEATURES: [],
}));

// ── Import router AFTER mocks ────────────────────────────────────────────

import { statsRouter } from '../stats.js';

// ── Tests ─────────────────────────────────────────────────────────────────

describe('statsRouter.getGlobalStats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbExecuteMock.mockResolvedValue(emptyRows);
    whereMock.mockResolvedValue([]);
  });

  it('returns expected response shape with all top-level keys', async () => {
    const caller = statsRouter.createCaller({
      user: {
        id: 'u1',
        partnerId: 'p1',
        role: 'admin' as const,
        isPlatformOperator: false,
        departments: [],
      },
    } as unknown as Parameters<typeof statsRouter.createCaller>[0]);

    const result = await caller.getGlobalStats({
      dateFrom: '2026-01-01',
      dateTo: '2026-01-02',
    });

    // All expected top-level keys
    const expectedKeys = [
      'todayTotal', 'todayOpen', 'todayClosed',
      'avgResponseMinutes', 'avgDurationMinutes', 'p95ResponseMinutes',
      'abandonedCount', 'reopenRate', 'sentimentScore',
      'total', 'avgRating', 'totalRatings', 'resolutionRate',
      'hourlyDistribution', 'hourlyStaffing',
      'dailyTrend', 'deptCounts',
      'ratingsByDept', 'sentimentByDept',
      'supportStats', 'agentStats',
      'oldestWaitMinutes', 'waitingOver3',
      'daySummary', 'previousPeriod', 'trendGranularity', 'avgConcurrency',
    ];

    for (const key of expectedKeys) {
      expect(result).toHaveProperty(key);
    }
  });

  it('hourlyDistribution has 24 entries', async () => {
    const caller = statsRouter.createCaller({
      user: {
        id: 'u1',
        partnerId: 'p1',
        role: 'admin' as const,
        isPlatformOperator: false,
        departments: [],
      },
    } as unknown as Parameters<typeof statsRouter.createCaller>[0]);

    const result = await caller.getGlobalStats({
      dateFrom: '2026-01-01',
      dateTo: '2026-01-02',
    });

    expect(result.hourlyDistribution).toHaveLength(24);
  });

  it('previousPeriod has expected keys', async () => {
    const caller = statsRouter.createCaller({
      user: {
        id: 'u1',
        partnerId: 'p1',
        role: 'admin' as const,
        isPlatformOperator: false,
        departments: [],
      },
    } as unknown as Parameters<typeof statsRouter.createCaller>[0]);

    const result = await caller.getGlobalStats({
      dateFrom: '2026-01-01',
      dateTo: '2026-01-02',
    });

    const prevKeys = ['total', 'avgResponseMinutes', 'avgDurationMinutes', 'abandonedCount', 'avgRating'];
    for (const key of prevKeys) {
      expect(result.previousPeriod).toHaveProperty(key);
    }
  });

  it('rejects non-admin/support roles', async () => {
    const caller = statsRouter.createCaller({
      user: {
        id: 'u1',
        partnerId: 'p1',
        role: 'agent' as const,
        isPlatformOperator: false,
        departments: [],
      },
    } as unknown as Parameters<typeof statsRouter.createCaller>[0]);

    await expect(caller.getGlobalStats({
      dateFrom: '2026-01-01',
      dateTo: '2026-01-02',
    })).rejects.toThrow();
  });

  it('rejects date range exceeding 365 days', async () => {
    const caller = statsRouter.createCaller({
      user: {
        id: 'u1',
        partnerId: 'p1',
        role: 'admin' as const,
        isPlatformOperator: false,
        departments: [],
      },
    } as unknown as Parameters<typeof statsRouter.createCaller>[0]);

    // The catch-all in getGlobalStats wraps all errors as INTERNAL_SERVER_ERROR
    await expect(caller.getGlobalStats({
      dateFrom: '2024-01-01',
      dateTo: '2025-06-01',
    })).rejects.toThrow();
  });
});
