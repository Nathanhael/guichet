/**
 * Behavioural test for the BROKEN-chain path of verifyAuditChain.
 *
 * Covers the branch the "valid: true" test in verifyAuditChainRateLimitBehavioral
 * does not exercise: a chain-integrity failure. The persisted record must
 * carry `valid: false`, `brokenAt`, and `checked`, so operators see exactly
 * where the tamper happened and how far the scan got.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  redisStore,
  pubClientMock,
  dbSelectMock,
  dbInsertMock,
  valuesMock,
  onConflictDoUpdateMock,
  verifyAuditChainServiceMock,
  getRowsMock,
  chainFailuresIncMock,
} = vi.hoisted(() => {
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

  // db.select():
  //   .from(users).where().limit()  → resolves actor name
  //   .from(systemSettings).where().limit()  → resolves last verify record
  // Two distinct `.limit` calls happen — route by call index.
  let selectCount = 0;
  const getRowsMock = vi.fn((): unknown[] => {
    // Call 0: actor name; Call 1+: system_settings reads
    selectCount += 1;
    if (selectCount === 1) return [{ name: 'Op Broken' }];
    return [{ value: {} }];
  });
  const limitMock = vi.fn(async () => getRowsMock());
  const whereMock = vi.fn().mockReturnValue({ limit: limitMock });
  const fromMock = vi.fn().mockReturnValue({ where: whereMock });
  const dbSelectMock = vi.fn().mockReturnValue({ from: fromMock });

  const onConflictDoUpdateMock = vi.fn().mockResolvedValue(undefined);
  const valuesMock = vi.fn().mockReturnValue({ onConflictDoUpdate: onConflictDoUpdateMock });
  const dbInsertMock = vi.fn().mockReturnValue({ values: valuesMock });

  const verifyAuditChainServiceMock = vi.fn();
  const chainFailuresIncMock = vi.fn();

  return {
    redisStore,
    pubClientMock,
    dbSelectMock,
    dbInsertMock,
    valuesMock,
    onConflictDoUpdateMock,
    verifyAuditChainServiceMock,
    getRowsMock,
    chainFailuresIncMock,
  };
});

vi.mock('../../../utils/redis.js', () => ({
  getRedisClients: () => ({ pubClient: pubClientMock }),
}));

vi.mock('../../../utils/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../db.js', () => ({
  db: {
    select: dbSelectMock,
    insert: dbInsertMock,
  },
}));

vi.mock('../../../db/schema.js', () => ({
  auditLog: { id: { name: 'id' }, action: { name: 'action' }, createdAt: { name: 'createdAt' } },
  auditArchive: { id: { name: 'id' }, createdAt: { name: 'createdAt' } },
  archivedTickets: { id: { name: 'id' } },
  users: { id: { name: 'id' }, name: { name: 'name' } },
  systemSettings: { key: { name: 'key' }, value: { name: 'value' }, updatedAt: { name: 'updatedAt' } },
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
    ilike: vi.fn((col: unknown, val: unknown) => ({ __op: 'ilike', col, val })),
    sql: Object.assign(vi.fn(), { raw: vi.fn() }),
  };
});

vi.mock('../../../services/archive.js', () => ({
  verifyAuditChain: verifyAuditChainServiceMock,
  archiveAuditLog: vi.fn(),
  archiveTickets: vi.fn(),
}));

vi.mock('../../../utils/metrics.js', () => ({
  auditChainVerifyFailures: { inc: chainFailuresIncMock },
}));

vi.mock('../../../config.js', () => ({
  default: { JWT_SECRET: 'test-secret-key-that-is-long-enough-for-hs256' },
}));

vi.mock('../../../constants.js', () => ({
  DISABLED_FEATURES: [],
}));

import { platformAuditRouter } from '../platform/audit.js';

type CallerCtx = Parameters<typeof platformAuditRouter.createCaller>[0];

function makeCaller(userId: string) {
  return platformAuditRouter.createCaller({
    user: {
      id: userId,
      partnerId: null,
      role: 'admin',
      isPlatformOperator: true,
      departments: [],
    },
  } as unknown as CallerCtx);
}

describe('verifyAuditChain — broken chain result flows through persist + return', () => {
  beforeEach(() => {
    redisStore.clear();
    pubClientMock.incr.mockClear();
    pubClientMock.expire.mockClear();
    valuesMock.mockClear();
    onConflictDoUpdateMock.mockClear();
    verifyAuditChainServiceMock.mockReset();
    getRowsMock.mockClear();
    chainFailuresIncMock.mockClear();
  });

  it('persists valid:false + brokenAt + checked and returns the full record to the caller', async () => {
    verifyAuditChainServiceMock.mockResolvedValueOnce({
      valid: false,
      checked: 3,
      brokenAt: 'tampered-archive-row-id',
    });

    const caller = makeCaller('op-broken-1');
    const result = await caller.verifyAuditChain();

    // Result propagates verbatim so the mutation's onSuccess invalidator sees
    // the same fields the UI will render (VALID/BROKEN badge + brokenAt cell).
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe('tampered-archive-row-id');
    expect(result.checked).toBe(3);
    expect(result.ranBy).toBe('op-broken-1');
    expect(result.ranByName).toBe('Op Broken');

    // A broken chain results in three writes via insert().values():
    //   1. audit_chain_last_verify      (singleton row with the latest run)
    //   2. audit_chain_verify_history   (rolling history array)
    //   3. audit_log                    (system.chain_broken_detected — the
    //      high-severity trail that PlatformAuditLog surfaces to operators)
    expect(valuesMock).toHaveBeenCalledTimes(3);
    const lastVerifyCall = valuesMock.mock.calls.find(
      c => (c[0] as { key?: string }).key === 'audit_chain_last_verify',
    );
    expect(lastVerifyCall).toBeDefined();
    const persisted = lastVerifyCall![0] as {
      key: string;
      value: { valid: boolean; brokenAt: string; checked: number };
    };
    expect(persisted.value.valid).toBe(false);
    expect(persisted.value.brokenAt).toBe('tampered-archive-row-id');
    expect(persisted.value.checked).toBe(3);

    // The audit_log write marks the incident loudly so existing dashboards +
    // any downstream webhook/alert consumer see it without extra wiring.
    const alertCall = valuesMock.mock.calls.find(
      c => (c[0] as { action?: string }).action === 'system.chain_broken_detected',
    );
    expect(alertCall).toBeDefined();
    const alertPayload = alertCall![0] as {
      action: string;
      targetType: string;
      targetId: string | null;
      metadata: { severity: string; brokenAt: string | null };
    };
    expect(alertPayload.targetType).toBe('system');
    expect(alertPayload.targetId).toBe('tampered-archive-row-id');
    expect(alertPayload.metadata.severity).toBe('critical');
    expect(alertPayload.metadata.brokenAt).toBe('tampered-archive-row-id');

    // Prometheus counter ticks with severity=critical so Grafana can page on
    // actual tamper events separately from transient service errors.
    expect(chainFailuresIncMock).toHaveBeenCalledTimes(1);
    expect(chainFailuresIncMock).toHaveBeenCalledWith({ severity: 'critical' });
  });

  it('listTargetTypes returns the platform-scope allow-list with partner + platform types', async () => {
    const caller = makeCaller('op-lister');
    const types = await caller.listTargetTypes();

    expect(Array.isArray(types)).toBe(true);
    // Platform operators see cross-cutting rows — must include partner-scope
    // target types AND platform-only types.
    expect(types).toContain('partner');
    expect(types).toContain('user');
    expect(types).toContain('group_mapping');
    expect(types).toContain('system');
  });

  it('propagates a service-level error field (e.g. db read failure) through the record', async () => {
    verifyAuditChainServiceMock.mockResolvedValueOnce({
      valid: false,
      checked: 0,
      error: 'archive read timeout',
    });

    const caller = makeCaller('op-broken-2');
    const result = await caller.verifyAuditChain();

    expect(result.valid).toBe(false);
    expect(result.error).toBe('archive read timeout');
    expect(result.checked).toBe(0);

    const lastVerifyCall = valuesMock.mock.calls.find(
      c => (c[0] as { key?: string }).key === 'audit_chain_last_verify',
    );
    expect(lastVerifyCall).toBeDefined();
    const persisted = lastVerifyCall![0] as {
      value: { error?: string; valid: boolean };
    };
    expect(persisted.value.error).toBe('archive read timeout');

    // Service-level failures are marked separately from tampering — a db
    // read timeout is not the same signal as a broken hash chain and
    // should not page the same way.
    const alertCall = valuesMock.mock.calls.find(
      c => (c[0] as { action?: string }).action === 'system.chain_verify_error',
    );
    expect(alertCall).toBeDefined();
    const alertPayload = alertCall![0] as { metadata: { severity: string } };
    expect(alertPayload.metadata.severity).toBe('warn');

    // Service-level errors tick the counter with severity=warn — a lower
    // pager priority than a critical tamper.
    expect(chainFailuresIncMock).toHaveBeenCalledWith({ severity: 'warn' });
  });
});
