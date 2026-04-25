import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ─────────────────────────────────────────────────────────

const {
  dbSelectMock,
  dbInsertMock,
  dbTransactionMock,
  limitMock,
  insertValuesMock,
  txDeleteWhereMock,
  txUpdateSetWhereMock,
  txRemainingLimitMock,
  insertedAuditRows,
} = vi.hoisted(() => {
  const insertedAuditRows: unknown[] = [];

  // Top-level db.select(...).from(...).where(...).limit(n)
  const dbSelectMock = vi.fn();
  const fromMock = vi.fn();
  const whereMock = vi.fn();
  const limitMock = vi.fn();
  dbSelectMock.mockReturnValue({ from: fromMock });
  fromMock.mockReturnValue({ where: whereMock });
  whereMock.mockReturnValue({ limit: limitMock });

  // Top-level db.insert(...).values(...)
  const insertValuesMock = vi.fn().mockImplementation((row: unknown) => {
    insertedAuditRows.push(row);
    return Promise.resolve(undefined);
  });
  const dbInsertMock = vi.fn().mockReturnValue({ values: insertValuesMock });

  // Transaction: tx.delete/select/update
  const txDeleteWhereMock = vi.fn().mockResolvedValue(undefined);
  const txUpdateSetWhereMock = vi.fn().mockResolvedValue(undefined);
  const txRemainingLimitMock = vi.fn();

  const dbTransactionMock = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      delete: vi.fn().mockReturnValue({ where: txDeleteWhereMock }),
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ limit: txRemainingLimitMock }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({ where: txUpdateSetWhereMock }),
      }),
    };
    return cb(tx);
  });

  return {
    dbSelectMock,
    dbInsertMock,
    dbTransactionMock,
    limitMock,
    insertValuesMock,
    txDeleteWhereMock,
    txUpdateSetWhereMock,
    txRemainingLimitMock,
    insertedAuditRows,
  };
});

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('../../../db.js', () => ({
  db: {
    select: dbSelectMock,
    insert: dbInsertMock,
    transaction: dbTransactionMock,
  },
}));

vi.mock('../../../db/schema.js', () => ({
  users: {
    id: { name: 'id' },
    email: { name: 'email' },
    isExternal: { name: 'isExternal' },
    externalId: { name: 'externalId' },
    deletedAt: { name: 'deletedAt' },
  },
  memberships: {
    id: { name: 'id' },
    userId: { name: 'userId' },
    partnerId: { name: 'partnerId' },
    role: { name: 'role' },
  },
  partners: { id: { name: 'id' }, name: { name: 'name' } },
  auditLog: {
    id: { name: 'id' },
    action: { name: 'action' },
    actorId: { name: 'actorId' },
    partnerId: { name: 'partnerId' },
    targetType: { name: 'targetType' },
    targetId: { name: 'targetId' },
    metadata: { name: 'metadata' },
  },
}));

vi.mock('drizzle-orm', async () => {
  const actual = await vi.importActual<typeof import('drizzle-orm')>('drizzle-orm');
  return {
    ...actual,
    eq: vi.fn((col: unknown, val: unknown) => ({ __op: 'eq', col, val })),
    and: vi.fn((...args: unknown[]) => ({ __op: 'and', args })),
    desc: vi.fn((col: unknown) => ({ __op: 'desc', col })),
    isNull: vi.fn((col: unknown) => ({ __op: 'isNull', col })),
    sql: vi.fn(),
    inArray: vi.fn((col: unknown, vals: unknown) => ({ __op: 'inArray', col, vals })),
  };
});

vi.mock('../../../services/roles.js', () => ({
  isPlatformAdmin: vi.fn((v: boolean) => v),
  isTenantAdmin: vi.fn((role: string) => role === 'admin'),
}));

vi.mock('../../../services/sessionRevocation.js', () => ({
  revokeUserSessions: vi.fn().mockResolvedValue(undefined),
  isRevoked: vi.fn().mockResolvedValue(false),
}));

vi.mock('../../../utils/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../config.js', () => ({
  default: { JWT_SECRET: 'test-secret-key-that-is-long-enough-for-hs256' },
}));

vi.mock('../../../constants.js', () => ({
  DISABLED_FEATURES: [],
}));

vi.mock('crypto', async () => {
  const actual = await vi.importActual<typeof import('crypto')>('crypto');
  return { ...actual, randomUUID: () => 'fixed-uuid-1234' };
});

// ── Import router AFTER mocks ────────────────────────────────────────────

import { platformUsersRouter } from './users.js';

type CallerCtx = Parameters<typeof platformUsersRouter.createCaller>[0];

function makeCaller(opts: { isPlatformOperator?: boolean; userId?: string } = {}) {
  return platformUsersRouter.createCaller({
    user: {
      id: opts.userId ?? 'operator-1',
      partnerId: null,
      role: 'admin',
      isPlatformOperator: opts.isPlatformOperator ?? true,
      departments: [],
    },
  } as unknown as CallerCtx);
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('platformUsersRouter.revokePendingInvite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertedAuditRows.length = 0;
    // Rewire defaults (cleared above)
    insertValuesMock.mockImplementation((row: unknown) => {
      insertedAuditRows.push(row);
      return Promise.resolve(undefined);
    });
    txDeleteWhereMock.mockResolvedValue(undefined);
    txUpdateSetWhereMock.mockResolvedValue(undefined);
  });

  it('rejects non-platform-operator callers (FORBIDDEN)', async () => {
    const caller = makeCaller({ isPlatformOperator: false });
    await expect(caller.revokePendingInvite({ membershipId: 'm1' })).rejects.toThrow();
    // Nothing should have been touched
    expect(dbTransactionMock).not.toHaveBeenCalled();
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it('throws NOT_FOUND when membership does not exist', async () => {
    limitMock.mockResolvedValueOnce([]); // membership lookup → empty

    await expect(
      makeCaller().revokePendingInvite({ membershipId: 'missing' }),
    ).rejects.toThrow(/Membership not found/);

    expect(dbTransactionMock).not.toHaveBeenCalled();
  });

  it('throws NOT_FOUND when user does not exist', async () => {
    limitMock
      .mockResolvedValueOnce([{ id: 'm1', userId: 'u-gone', partnerId: 'p1', role: 'admin' }])
      .mockResolvedValueOnce([]); // user lookup → empty

    await expect(
      makeCaller().revokePendingInvite({ membershipId: 'm1' }),
    ).rejects.toThrow(/User not found/);

    expect(dbTransactionMock).not.toHaveBeenCalled();
  });

  it('rejects BAD_REQUEST when user is not external (regular staff member)', async () => {
    limitMock
      .mockResolvedValueOnce([{ id: 'm1', userId: 'u1', partnerId: 'p1', role: 'admin' }])
      .mockResolvedValueOnce([{ id: 'u1', email: 'staff@acme.io', isExternal: false, externalId: null }]);

    await expect(
      makeCaller().revokePendingInvite({ membershipId: 'm1' }),
    ).rejects.toThrow(/Not a pending invite/);

    expect(dbTransactionMock).not.toHaveBeenCalled();
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it('rejects BAD_REQUEST when user already linked to Entra (externalId set)', async () => {
    limitMock
      .mockResolvedValueOnce([{ id: 'm1', userId: 'u1', partnerId: 'p1', role: 'admin' }])
      .mockResolvedValueOnce([{ id: 'u1', email: 'guest@vendor.io', isExternal: true, externalId: 'azure-oid-abc' }]);

    await expect(
      makeCaller().revokePendingInvite({ membershipId: 'm1' }),
    ).rejects.toThrow(/Not a pending invite/);

    expect(dbTransactionMock).not.toHaveBeenCalled();
  });

  it('revokes membership without soft-deleting user when other memberships remain', async () => {
    limitMock
      .mockResolvedValueOnce([{ id: 'm1', userId: 'u1', partnerId: 'p-tenant-a', role: 'admin' }])
      .mockResolvedValueOnce([{ id: 'u1', email: 'guest@vendor.io', isExternal: true, externalId: null }]);
    // Other membership(s) still exist → not orphaned
    txRemainingLimitMock.mockResolvedValueOnce([{ id: 'm2' }]);

    const res = await makeCaller().revokePendingInvite({ membershipId: 'm1' });

    expect(res).toEqual({ success: true, userSoftDeleted: false });
    expect(txDeleteWhereMock).toHaveBeenCalledTimes(1);
    expect(txUpdateSetWhereMock).not.toHaveBeenCalled();

    expect(insertedAuditRows).toHaveLength(1);
    const audit = insertedAuditRows[0] as {
      action: string;
      partnerId: string;
      targetId: string;
      metadata: Record<string, unknown>;
    };
    expect(audit.action).toBe('member.removed');
    expect(audit.partnerId).toBe('p-tenant-a');
    expect(audit.targetId).toBe('u1');
    expect(audit.metadata).toMatchObject({
      membershipId: 'm1',
      role: 'admin',
      wasExternal: true,
      reason: 'pending_invite_revoked',
      email: 'guest@vendor.io',
      userSoftDeleted: false,
    });
  });

  it('soft-deletes the user when the revoked membership was their last one', async () => {
    limitMock
      .mockResolvedValueOnce([{ id: 'm1', userId: 'u1', partnerId: 'p-tenant-a', role: 'support' }])
      .mockResolvedValueOnce([{ id: 'u1', email: 'lonely@vendor.io', isExternal: true, externalId: null }]);
    // No remaining memberships → orphan → soft-delete
    txRemainingLimitMock.mockResolvedValueOnce([]);

    const res = await makeCaller().revokePendingInvite({ membershipId: 'm1' });

    expect(res).toEqual({ success: true, userSoftDeleted: true });
    expect(txDeleteWhereMock).toHaveBeenCalledTimes(1);
    expect(txUpdateSetWhereMock).toHaveBeenCalledTimes(1);

    const audit = insertedAuditRows[0] as { metadata: Record<string, unknown> };
    expect(audit.metadata).toMatchObject({
      wasExternal: true,
      reason: 'pending_invite_revoked',
      userSoftDeleted: true,
    });
  });

  it('attributes the audit entry to the calling operator (actorId = ctx.user.id)', async () => {
    limitMock
      .mockResolvedValueOnce([{ id: 'm1', userId: 'u1', partnerId: 'p1', role: 'admin' }])
      .mockResolvedValueOnce([{ id: 'u1', email: 'g@v.io', isExternal: true, externalId: null }]);
    txRemainingLimitMock.mockResolvedValueOnce([{ id: 'm2' }]);

    await makeCaller({ userId: 'platform-bart' }).revokePendingInvite({ membershipId: 'm1' });

    const audit = insertedAuditRows[0] as { actorId: string };
    expect(audit.actorId).toBe('platform-bart');
  });

  it('wraps unexpected errors (from the transaction) as INTERNAL_SERVER_ERROR', async () => {
    limitMock
      .mockResolvedValueOnce([{ id: 'm1', userId: 'u1', partnerId: 'p1', role: 'admin' }])
      .mockResolvedValueOnce([{ id: 'u1', email: 'g@v.io', isExternal: true, externalId: null }]);
    txDeleteWhereMock.mockRejectedValueOnce(new Error('db went boom'));

    await expect(
      makeCaller().revokePendingInvite({ membershipId: 'm1' }),
    ).rejects.toThrow(/An internal error occurred/);

    // Audit must not be written when the tx fails
    expect(insertValuesMock).not.toHaveBeenCalled();
  });
});
