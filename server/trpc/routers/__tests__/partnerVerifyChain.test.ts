/**
 * Behavioural test for partnerAuditRouter.verifyChain.
 *
 * Covers the three load-bearing invariants:
 *  1. Per-(partner+user) rate limit with a TOO_MANY_REQUESTS retry hint.
 *  2. Chain walk is always full-scan (hash chain is global) but the returned
 *     shape is scoped to the caller's partner — partnerChecked + brokenInScope
 *     are the only numbers the operator sees.
 *  3. When the broken row lives OUTSIDE the caller's scope, `brokenAt` is
 *     nulled out to prevent cross-tenant row-id disclosure.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { redisStore, pubClientMock, verifyAuditChainMock } = vi.hoisted(() => {
  const redisStore = new Map<string, { count: number; ttl: number }>();
  const pubClientMock = {
    incr: vi.fn(async (key: string) => {
      const cur = redisStore.get(key) ?? { count: 0, ttl: -1 };
      cur.count += 1;
      redisStore.set(key, cur);
      return cur.count;
    }),
    expire: vi.fn(async (key: string, secs: number) => {
      const cur = redisStore.get(key);
      if (cur) cur.ttl = secs;
    }),
    ttl: vi.fn(async (key: string) => redisStore.get(key)?.ttl ?? -2),
  };
  return { redisStore, pubClientMock, verifyAuditChainMock: vi.fn() };
});

vi.mock('../../../utils/redis.js', () => ({
  getRedisClients: () => ({ pubClient: pubClientMock }),
}));

vi.mock('../../../utils/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../db.js', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
          }),
        }),
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
      }),
    }),
  },
}));

vi.mock('../../../db/schema.js', () => ({
  auditLog: {
    id: { name: 'id' },
    action: { name: 'action' },
    actorId: { name: 'actorId' },
    partnerId: { name: 'partnerId' },
    targetType: { name: 'targetType' },
    targetId: { name: 'targetId' },
    metadata: { name: 'metadata' },
    createdAt: { name: 'createdAt' },
  },
  users: { id: { name: 'id' }, name: { name: 'name' } },
}));

vi.mock('drizzle-orm', async () => {
  const actual = await vi.importActual<typeof import('drizzle-orm')>('drizzle-orm');
  return {
    ...actual,
    eq: vi.fn((col: unknown, val: unknown) => ({ __op: 'eq', col, val })),
    and: vi.fn((...args: unknown[]) => ({ __op: 'and', args })),
    desc: vi.fn((col: unknown) => ({ __op: 'desc', col })),
    gte: vi.fn((col: unknown, val: unknown) => ({ __op: 'gte', col, val })),
    lte: vi.fn((col: unknown, val: unknown) => ({ __op: 'lte', col, val })),
    sql: Object.assign(
      vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ __op: 'sql', strings, values })),
      { raw: vi.fn() },
    ),
  };
});

vi.mock('../../../services/archive.js', () => ({
  verifyAuditChain: verifyAuditChainMock,
}));

vi.mock('../../../services/roles.js', () => ({
  isPlatformAdmin: vi.fn((v: boolean) => v),
  isTenantAdmin: vi.fn((role: string) => role === 'admin'),
}));

vi.mock('../../../config.js', () => ({
  default: { JWT_SECRET: 'test-secret-key-that-is-long-enough-for-hs256' },
}));

vi.mock('../../../constants.js', () => ({
  DISABLED_FEATURES: [],
}));

import { partnerAuditRouter } from '../partner/audit.js';

type CallerCtx = Parameters<typeof partnerAuditRouter.createCaller>[0];

function makeCaller(opts: { userId?: string; partnerId?: string | null; role?: string } = {}) {
  return partnerAuditRouter.createCaller({
    user: {
      id: opts.userId ?? 'u-admin',
      partnerId: opts.partnerId === undefined ? 'p-tenant-a' : opts.partnerId,
      role: (opts.role ?? 'admin') as 'admin',
      isPlatformOperator: false,
      departments: [],
    },
  } as unknown as CallerCtx);
}

describe('partner.audit.verifyChain — scope + rate limit', () => {
  beforeEach(() => {
    redisStore.clear();
    pubClientMock.incr.mockClear();
    pubClientMock.expire.mockClear();
    pubClientMock.ttl.mockClear();
    verifyAuditChainMock.mockReset();
  });

  it('passes ctx.user.partnerId to verifyAuditChain so the walk knows its scope', async () => {
    verifyAuditChainMock.mockResolvedValueOnce({
      valid: true,
      checked: 100,
      partnerChecked: 12,
    });

    await makeCaller({ partnerId: 'p-tenant-a' }).verifyChain();

    expect(verifyAuditChainMock).toHaveBeenCalledWith({ partnerId: 'p-tenant-a' });
  });

  it('returns the partner-scoped slice (partnerChecked, brokenInScope, ranAt) — never the global checked count', async () => {
    verifyAuditChainMock.mockResolvedValueOnce({
      valid: true,
      checked: 9999,
      partnerChecked: 42,
    });

    const result = await makeCaller().verifyChain();

    expect(result.valid).toBe(true);
    expect(result.partnerChecked).toBe(42);
    expect(result.brokenInScope).toBe(false);
    expect(result.brokenAt).toBeNull();
    expect(typeof result.ranAt).toBe('string');
    // Global checked count is not exposed — the UI only shows partnerChecked.
    expect(result).not.toHaveProperty('checked');
  });

  it('break outside caller scope: brokenAt is nulled out (cross-tenant leak prevention)', async () => {
    verifyAuditChainMock.mockResolvedValueOnce({
      valid: false,
      checked: 50,
      partnerChecked: 10,
      brokenAt: 'other-tenants-row-id',
      brokenPartnerId: 'p-tenant-OTHER',
      brokenInPartnerScope: false,
    });

    const result = await makeCaller({ partnerId: 'p-tenant-a' }).verifyChain();

    // Global valid=false is surfaced so the operator knows SOMETHING is wrong,
    // but the offending row id stays out of their response — leaking it would
    // disclose another tenant's audit_archive primary key.
    expect(result.valid).toBe(false);
    expect(result.brokenInScope).toBe(false);
    expect(result.brokenAt).toBeNull();
  });

  it('break inside caller scope: brokenAt is returned so the admin can investigate', async () => {
    verifyAuditChainMock.mockResolvedValueOnce({
      valid: false,
      checked: 50,
      partnerChecked: 10,
      brokenAt: 'my-row-id',
      brokenPartnerId: 'p-tenant-a',
      brokenInPartnerScope: true,
    });

    const result = await makeCaller({ partnerId: 'p-tenant-a' }).verifyChain();

    expect(result.valid).toBe(false);
    expect(result.brokenInScope).toBe(true);
    expect(result.brokenAt).toBe('my-row-id');
  });

  it('service-level error is propagated as the `error` field (operator sees infra problem, not a silent pass)', async () => {
    verifyAuditChainMock.mockResolvedValueOnce({
      valid: false,
      checked: 0,
      error: 'archive read timeout',
    });

    const result = await makeCaller().verifyChain();

    expect(result.error).toBe('archive read timeout');
    expect(result.valid).toBe(false);
  });

  it('rate-limits a second click within the window — TOO_MANY_REQUESTS with retry hint', async () => {
    verifyAuditChainMock.mockResolvedValue({ valid: true, checked: 1, partnerChecked: 0 });
    // Seed the counter past the limit and a non-negative ttl.
    redisStore.set('rate:verify-audit-chain:partner:p-tenant-a:u-admin', { count: 5, ttl: 42 });

    await expect(makeCaller({ partnerId: 'p-tenant-a' }).verifyChain()).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
    });

    // Verify was NEVER called — the guard fires before the expensive scan.
    expect(verifyAuditChainMock).not.toHaveBeenCalled();
  });

  it('rate-limit key namespaces by partnerId AND userId (one partner\'s admin cannot stampede another partner)', async () => {
    verifyAuditChainMock.mockResolvedValue({ valid: true, checked: 1, partnerChecked: 0 });

    await makeCaller({ partnerId: 'p-tenant-a', userId: 'u-a' }).verifyChain();
    await makeCaller({ partnerId: 'p-tenant-b', userId: 'u-a' }).verifyChain();

    // Both calls succeed — different partner keys, independent buckets.
    expect(verifyAuditChainMock).toHaveBeenCalledTimes(2);
    const keys = pubClientMock.incr.mock.calls.map((c) => c[0]);
    expect(keys).toContain('rate:verify-audit-chain:partner:p-tenant-a:u-a');
    expect(keys).toContain('rate:verify-audit-chain:partner:p-tenant-b:u-a');
  });

  it('rate-limit fails OPEN when Redis is unavailable — a broken Redis must not lock a tenant out of their own audit', async () => {
    verifyAuditChainMock.mockResolvedValueOnce({ valid: true, checked: 1, partnerChecked: 0 });
    pubClientMock.incr.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const result = await makeCaller().verifyChain();

    // Scan still happened and returned a valid record.
    expect(verifyAuditChainMock).toHaveBeenCalledTimes(1);
    expect(result.valid).toBe(true);
  });

  it('rejects non-admin callers (agent → FORBIDDEN)', async () => {
    const caller = makeCaller({ role: 'agent' });
    await expect(caller.verifyChain()).rejects.toThrow();
  });

  it('rejects callers with no active partner (partnerId=null)', async () => {
    const caller = makeCaller({ partnerId: null });
    await expect(caller.verifyChain()).rejects.toThrow();
  });
});
