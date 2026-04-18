/**
 * Behavioural rate-limit test for verifyAuditChain.
 *
 * The source-level test (verifyAuditChainRateLimit.test.ts) proves the right
 * constants and code paths exist. This test proves the guard actually blocks
 * a second call — i.e. given a Redis mock that simulates a real INCR counter
 * and TTL, two back-to-back mutations by the same operator:
 *   1. the first succeeds and persists a record
 *   2. the second throws TRPCError { code: 'TOO_MANY_REQUESTS' }
 *
 * We also cover:
 *   - Fails open when Redis returns null (unavailable)
 *   - Two different operators do NOT collide (limiter keyed by userId)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ─────────────────────────────────────────────────────────

const {
  redisStore,
  pubClientMock,
  dbSelectMock,
  dbInsertMock,
  valuesMock,
  onConflictDoUpdateMock,
  verifyAuditChainServiceMock,
} = vi.hoisted(() => {
  // A tiny in-memory Redis that supports incr/expire/ttl the way real Redis
  // does: INCR returns the new value; EXPIRE sets a TTL that TTL reports back.
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

  // db.select().from().where().limit()
  const limitMock = vi.fn().mockResolvedValue([{ name: 'Test Operator' }]);
  const whereMock = vi.fn().mockReturnValue({ limit: limitMock });
  const fromMock = vi.fn().mockReturnValue({ where: whereMock });
  const dbSelectMock = vi.fn().mockReturnValue({ from: fromMock });

  // db.insert().values().onConflictDoUpdate()
  const onConflictDoUpdateMock = vi.fn().mockResolvedValue(undefined);
  const valuesMock = vi.fn().mockReturnValue({ onConflictDoUpdate: onConflictDoUpdateMock });
  const dbInsertMock = vi.fn().mockReturnValue({ values: valuesMock });

  // The actual chain-scanner — we don't care about its internals here.
  const verifyAuditChainServiceMock = vi.fn().mockResolvedValue({
    valid: true,
    checked: 42,
  });

  return {
    redisStore,
    pubClientMock,
    dbSelectMock,
    dbInsertMock,
    valuesMock,
    onConflictDoUpdateMock,
    verifyAuditChainServiceMock,
  };
});

// ── Mocks ──────────────────────────────────────────────────────────────────

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

vi.mock('../../../config.js', () => ({
  default: { JWT_SECRET: 'test-secret-key-that-is-long-enough-for-hs256' },
}));

vi.mock('../../../constants.js', () => ({
  DISABLED_FEATURES: [],
}));

// ── Import router AFTER mocks ────────────────────────────────────────────

import { platformAuditRouter } from '../platform/audit.js';
import { TRPCError } from '@trpc/server';

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

describe('verifyAuditChain — behavioural rate limit', () => {
  beforeEach(() => {
    redisStore.clear();
    pubClientMock.incr.mockClear();
    pubClientMock.expire.mockClear();
    pubClientMock.ttl.mockClear();
    verifyAuditChainServiceMock.mockClear();
    onConflictDoUpdateMock.mockClear();
    valuesMock.mockClear();
  });

  it('first call succeeds and persists a record', async () => {
    const caller = makeCaller('op-1');
    const result = await caller.verifyAuditChain();

    expect(result.valid).toBe(true);
    expect(result.checked).toBe(42);
    expect(result.ranBy).toBe('op-1');
    expect(result.ranByName).toBe('Test Operator');
    expect(typeof result.ranAt).toBe('string');

    // Persisted via insert().values().onConflictDoUpdate() twice — once for
    // the latest-run singleton (audit_chain_last_verify) and once for the
    // rolling history (audit_chain_verify_history).
    expect(valuesMock).toHaveBeenCalledTimes(2);
    expect(onConflictDoUpdateMock).toHaveBeenCalledTimes(2);
    const keys = valuesMock.mock.calls.map(c => (c[0] as { key: string }).key);
    expect(keys).toContain('audit_chain_last_verify');
    expect(keys).toContain('audit_chain_verify_history');

    // Scanner ran exactly once.
    expect(verifyAuditChainServiceMock).toHaveBeenCalledTimes(1);

    // Redis: INCR set counter to 1, EXPIRE set the TTL.
    expect(pubClientMock.incr).toHaveBeenCalledWith('rate:verify-audit-chain:op-1');
    expect(pubClientMock.expire).toHaveBeenCalledWith('rate:verify-audit-chain:op-1', 60);
  });

  it('second call by the same operator within the window is blocked with TOO_MANY_REQUESTS', async () => {
    const caller = makeCaller('op-1');
    await caller.verifyAuditChain();

    let thrown: unknown = null;
    try {
      await caller.verifyAuditChain();
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(TRPCError);
    expect((thrown as TRPCError).code).toBe('TOO_MANY_REQUESTS');
    expect((thrown as TRPCError).message).toMatch(/retry in \d+s/i);

    // The expensive scan must NOT have been invoked a second time.
    expect(verifyAuditChainServiceMock).toHaveBeenCalledTimes(1);
    // No additional persist writes beyond the first run's two (last_verify +
    // history). The second (rate-limited) call must short-circuit before any
    // db.insert().values() fires.
    expect(valuesMock).toHaveBeenCalledTimes(2);
  });

  it('two different operators do not collide — limiter is keyed by userId', async () => {
    const a = makeCaller('op-A');
    const b = makeCaller('op-B');

    await a.verifyAuditChain();
    await b.verifyAuditChain(); // different key, should also succeed

    expect(verifyAuditChainServiceMock).toHaveBeenCalledTimes(2);
    expect(pubClientMock.incr).toHaveBeenCalledWith('rate:verify-audit-chain:op-A');
    expect(pubClientMock.incr).toHaveBeenCalledWith('rate:verify-audit-chain:op-B');
  });

  it('fails open when Redis is unavailable (pubClient is null)', async () => {
    // Temporarily shadow the redis module for this one call.
    const redisModule = await import('../../../utils/redis.js');
    const spy = vi.spyOn(redisModule, 'getRedisClients').mockReturnValueOnce({
      pubClient: null,
    } as unknown as ReturnType<typeof redisModule.getRedisClients>);

    const caller = makeCaller('op-alone');
    const result = await caller.verifyAuditChain();

    expect(result.valid).toBe(true);
    expect(verifyAuditChainServiceMock).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('fails open when Redis INCR throws — platform ops never get locked out by infra', async () => {
    pubClientMock.incr.mockImplementationOnce(async () => {
      throw new Error('ECONNREFUSED');
    });

    const caller = makeCaller('op-resilient');
    const result = await caller.verifyAuditChain();

    // The chain scan still ran; the rate-limit check failed open.
    expect(result.valid).toBe(true);
    expect(verifyAuditChainServiceMock).toHaveBeenCalledTimes(1);
  });
});
