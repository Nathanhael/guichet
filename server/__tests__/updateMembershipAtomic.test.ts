import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * updateMembership must be atomic: a failure in any of the three writes
 * (membership role, audit log, isPlatformOperator flag) must roll back the
 * other two. Previously the audit insert was in a silent try/catch, so a
 * platform_operator promotion could complete with no audit trail — and a
 * crash between writes left the user-flag inconsistent with the role.
 * Source: post-ship review 2026-04-18 H-2.
 */

const selectQueue: unknown[] = [];
const insertValuesMock = vi.fn();
const updateWhereMock = vi.fn();

let transactionCallCount = 0;

const dbMock: {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  transaction: ReturnType<typeof vi.fn>;
} = {
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => selectQueue.shift()),
      })),
    })),
  })),
  insert: vi.fn(() => ({
    values: insertValuesMock,
  })),
  update: vi.fn(() => ({
    set: vi.fn(() => ({
      where: updateWhereMock,
    })),
  })),
  delete: vi.fn(() => ({
    where: vi.fn(),
  })),
  transaction: vi.fn(async (cb: (tx: unknown) => unknown) => {
    transactionCallCount += 1;
    return cb(dbMock);
  }),
};

vi.mock('../db.js', () => ({ db: dbMock }));

vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../utils/redis.js', () => ({
  getRedisClients: vi.fn(() => ({ pubClient: null })),
}));

vi.mock('../socket/handlers.js', () => ({
  broadcastPartnerDeactivation: vi.fn(),
}));

describe('updateMembership atomicity (H-2)', () => {
  beforeEach(() => {
    selectQueue.length = 0;
    transactionCallCount = 0;
    dbMock.select.mockClear();
    dbMock.insert.mockClear();
    dbMock.update.mockClear();
    dbMock.transaction.mockClear();
    insertValuesMock.mockReset();
    insertValuesMock.mockResolvedValue(undefined);
    updateWhereMock.mockReset();
    updateWhereMock.mockResolvedValue(undefined);
  });

  it('wraps all three writes in a single db.transaction', async () => {
    // memBefore lookup
    selectQueue.push([{ id: 'mem-1', userId: 'user-2', partnerId: 'tenant-a', role: 'support' }]);
    // otherPlatformMemberships lookup inside tx
    selectQueue.push([]);

    const { platformRouter } = await import('../trpc/routers/platform/index.js');
    const caller = platformRouter.createCaller({
      user: { id: 'platform-1', role: 'admin', isPlatformOperator: true },
    } as any);

    await caller.updateMembership({
      id: 'mem-1',
      data: { role: 'admin', departments: [] },
    });

    expect(transactionCallCount).toBe(1);
  });

  it('rolls back when the audit insert throws (no silent catch)', async () => {
    selectQueue.push([{ id: 'mem-1', userId: 'user-2', partnerId: 'tenant-a', role: 'support' }]);
    // The audit insert is the second operation inside the transaction; make
    // it throw. Without a surrounding transaction, the role change would
    // have committed while the audit row silently disappeared (old bug).
    insertValuesMock.mockRejectedValueOnce(new Error('audit table down'));

    const { platformRouter } = await import('../trpc/routers/platform/index.js');
    const caller = platformRouter.createCaller({
      user: { id: 'platform-1', role: 'admin', isPlatformOperator: true },
    } as any);

    await expect(caller.updateMembership({
      id: 'mem-1',
      data: { role: 'admin', departments: [] },
    })).rejects.toThrow(/audit table down/);

    // Transaction was entered — the failed audit inserted must roll back the
    // role change, which means the caller throws rather than swallowing.
    expect(transactionCallCount).toBe(1);
  });
});
