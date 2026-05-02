/**
 * testFixtures auth boundary — every procedure rejects unauthenticated callers.
 *
 * Production-mode rejection is exercised by the boundary test
 * (testFixtures.boundary.test.ts) which asserts the file panics on import in
 * prod. This file covers the orthogonal axis: when imported successfully and
 * called without a valid user context, the procedures throw UNAUTHORIZED.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted lightweight mocks so the router can be createCaller'd without
// touching real DB / Redis.
const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => []) })) })),
    })),
    insert: vi.fn(() => ({ values: vi.fn() })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) })),
    delete: vi.fn(() => ({ where: vi.fn() })),
    transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb({})),
  },
}));

vi.mock('../../db.js', () => ({ db: dbMock }));
vi.mock('../../utils/redis.js', () => ({
  getRedisClients: vi.fn(() => ({ pubClient: null })),
}));
vi.mock('../../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { testFixturesRouter } from './testFixtures.js';

type CallerCtx = Parameters<typeof testFixturesRouter.createCaller>[0];

function unauthCaller() {
  // protectedProcedure narrows on ctx.user being truthy; passing null forces
  // the UNAUTHORIZED throw at the middleware before the procedure body runs.
  return testFixturesRouter.createCaller({ user: null } as unknown as CallerCtx);
}

describe('testFixtures — auth boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('createPartner rejects unauthenticated callers with UNAUTHORIZED', async () => {
    await expect(
      unauthCaller().createPartner({}),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('deletePartner rejects unauthenticated callers with UNAUTHORIZED', async () => {
    await expect(
      unauthCaller().deletePartner({ partnerId: 'test-abc123' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('createUser rejects unauthenticated callers with UNAUTHORIZED', async () => {
    await expect(
      unauthCaller().createUser({ partnerId: 'test-abc123' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('deleteUser rejects unauthenticated callers with UNAUTHORIZED', async () => {
    await expect(
      unauthCaller().deleteUser({ userId: 'test-user-abc123' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('createTicket rejects unauthenticated callers with UNAUTHORIZED', async () => {
    await expect(
      unauthCaller().createTicket({ partnerId: 'acme' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('cleanup rejects unauthenticated callers with UNAUTHORIZED', async () => {
    await expect(
      unauthCaller().cleanup({ ticketIds: ['t-1'] }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('resetAgentStatus rejects unauthenticated callers with UNAUTHORIZED', async () => {
    await expect(
      unauthCaller().resetAgentStatus({ userId: 'u-1', partnerId: 'acme' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('createPartner does not touch the DB when caller is unauth', async () => {
    await expect(
      unauthCaller().createPartner({}),
    ).rejects.toThrow();
    expect(dbMock.transaction).not.toHaveBeenCalled();
    expect(dbMock.insert).not.toHaveBeenCalled();
  });

  it('deletePartner does not touch the DB when caller is unauth', async () => {
    await expect(
      unauthCaller().deletePartner({ partnerId: 'test-abc123' }),
    ).rejects.toThrow();
    expect(dbMock.delete).not.toHaveBeenCalled();
  });

  it('createUser does not touch the DB when caller is unauth', async () => {
    await expect(
      unauthCaller().createUser({ partnerId: 'test-abc123' }),
    ).rejects.toThrow();
    expect(dbMock.transaction).not.toHaveBeenCalled();
    expect(dbMock.insert).not.toHaveBeenCalled();
    expect(dbMock.select).not.toHaveBeenCalled();
  });

  it('deleteUser does not touch the DB when caller is unauth', async () => {
    await expect(
      unauthCaller().deleteUser({ userId: 'test-user-abc123' }),
    ).rejects.toThrow();
    expect(dbMock.delete).not.toHaveBeenCalled();
  });

  it('createTicket does not touch the DB when caller is unauth', async () => {
    await expect(
      unauthCaller().createTicket({ partnerId: 'acme' }),
    ).rejects.toThrow();
    expect(dbMock.select).not.toHaveBeenCalled();
    expect(dbMock.insert).not.toHaveBeenCalled();
    expect(dbMock.transaction).not.toHaveBeenCalled();
  });
});
