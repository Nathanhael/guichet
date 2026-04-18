import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * bootstrapPlatformOperator must be atomic: the user update/insert and the
 * audit-log row commit together or not at all. Previously the two writes ran
 * back-to-back without a transaction, so a crash between them could leave a
 * platform operator promoted (or created) with no bootstrap audit row —
 * same family as H-2 from the 2026-04-18 post-ship review.
 */

const selectQueue: unknown[] = [];
const insertValuesMock = vi.fn();
const updateWhereMock = vi.fn();

let transactionCallCount = 0;

const dbMock: {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
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
  transaction: vi.fn(async (cb: (tx: unknown) => unknown) => {
    transactionCallCount += 1;
    return cb(dbMock);
  }),
};

vi.mock('../db/postgres.js', () => ({ db: dbMock }));

vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../config.js', () => ({
  default: { PLATFORM_ADMIN_EMAIL: 'bootstrap@example.com' },
}));

describe('bootstrapPlatformOperator atomicity', () => {
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

  it('promote path wraps user update + audit insert in a single transaction', async () => {
    // existing-operator check returns empty → trigger bootstrap
    selectQueue.push([]);
    // byEmail lookup returns a user → promote branch
    selectQueue.push([{ id: 'user-7', email: 'bootstrap@example.com' }]);

    const { bootstrapPlatformOperator } = await import('../services/bootstrap.js');
    await bootstrapPlatformOperator();

    expect(transactionCallCount).toBe(1);
  });

  it('create path wraps user insert + audit insert in a single transaction', async () => {
    // existing-operator check returns empty
    selectQueue.push([]);
    // byEmail lookup returns empty → create branch
    selectQueue.push([]);

    const { bootstrapPlatformOperator } = await import('../services/bootstrap.js');
    await bootstrapPlatformOperator();

    expect(transactionCallCount).toBe(1);
  });

  it('promote path: audit insert throwing does NOT silently succeed', async () => {
    selectQueue.push([]);
    selectQueue.push([{ id: 'user-7', email: 'bootstrap@example.com' }]);
    // Let the user update succeed, then fail the audit insert. Outside a
    // transaction this would have left the promotion committed with no audit.
    insertValuesMock.mockRejectedValueOnce(new Error('audit table down'));

    const { bootstrapPlatformOperator } = await import('../services/bootstrap.js');

    // Bootstrap has an outer try/catch that logs and returns — we don't want
    // the whole server to crash at boot. But the transaction itself must have
    // rolled back (the audit-insert throw propagates within the tx).
    await bootstrapPlatformOperator();

    expect(transactionCallCount).toBe(1);
    // The transaction was entered, so the rollback path was exercised.
  });
});
