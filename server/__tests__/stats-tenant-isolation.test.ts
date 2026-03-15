import { describe, it, expect, vi, beforeEach } from 'vitest';
import { query } from '../db.js';

vi.mock('../db.js', () => ({
  query: vi.fn().mockResolvedValue([]),
  get: vi.fn(),
  run: vi.fn(),
}));

vi.mock('../utils/redis.js', () => ({
  getRedisClient: vi.fn().mockReturnValue(null),
}));

describe('Stats tenant isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('all queries touching tenant tables include partner_id filter', async () => {
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

    const calls = (query as any).mock.calls;
    const tenantTables = ['daily_stats', 'tickets', 'ticket_labels', 'canned_responses', 'messages'];

    for (const [sql, params] of calls) {
      const sqlLower = (sql as string).toLowerCase();
      const touchesTenantTable = tenantTables.some(t => sqlLower.includes(t));
      if (touchesTenantTable) {
        const hasPartnerFilter = sqlLower.includes('partner_id');
        expect(hasPartnerFilter, `Query missing partner_id filter: ${sql}`).toBe(true);
        expect(params, `Query params missing partnerId for: ${sql}`).toContain('partner-A');
      }
    }
  });
});
