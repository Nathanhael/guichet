/**
 * Behavior test for partner.updateMemberDepartments.
 *
 * Contract:
 *   1. Valid call: updates memberships.departments + writes audit row.
 *   2. Role gate: BAD_REQUEST when target is admin or agent (only support
 *      members carry department assignments).
 *   3. Department validation: BAD_REQUEST when any id is not in the partner's
 *      `partners.departments` JSONB.
 *   4. Tenant isolation: NOT_FOUND when membership belongs to another partner.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { dbSelectMock, dbUpdateMock, dbInsertMock } = vi.hoisted(() => ({
  dbSelectMock: vi.fn(),
  dbUpdateMock: vi.fn(),
  dbInsertMock: vi.fn(),
}));

vi.mock('../../db.js', () => ({
  db: { select: dbSelectMock, update: dbUpdateMock, insert: dbInsertMock },
}));

vi.mock('../../db/schema.js', () => ({
  users: {
    id: { name: 'id' },
    name: { name: 'name' },
    email: { name: 'email' },
    lastActiveAt: { name: 'lastActiveAt' },
    externalId: { name: 'externalId' },
  },
  memberships: {
    id: { name: 'id' },
    userId: { name: 'userId' },
    partnerId: { name: 'partnerId' },
    role: { name: 'role' },
    departments: { name: 'departments' },
    source: { name: 'source' },
    createdAt: { name: 'createdAt' },
  },
  partners: { id: { name: 'id' }, departments: { name: 'departments' } },
  auditLog: {
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
    eq: vi.fn(() => ({ __op: 'eq' })),
    and: vi.fn(() => ({ __op: 'and' })),
    or: vi.fn(() => ({ __op: 'or' })),
    ne: vi.fn(() => ({ __op: 'ne' })),
    ilike: vi.fn(() => ({ __op: 'ilike' })),
    sql: Object.assign(vi.fn(() => ({ __op: 'sql' })), { raw: vi.fn() }),
  };
});

vi.mock('../../services/roles.js', () => ({
  isPlatformAdmin: vi.fn((v: boolean) => v),
  isTenantAdmin: vi.fn((role: string) => role === 'admin'),
  canAssignTenantRole: vi.fn(() => true),
}));

vi.mock('../../utils/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../utils/security.js', () => ({
  escapeLikePattern: (s: string) => s,
}));

vi.mock('../../config.js', () => ({
  default: { JWT_SECRET: 'test-secret-key-that-is-long-enough-for-hs256' },
}));

import { partnerMembersRouter } from './partner/members.js';

type CallerCtx = Parameters<typeof partnerMembersRouter.createCaller>[0];

function makeCaller(overrides: Partial<{
  id: string;
  partnerId: string | null;
  role: string;
  isPlatformOperator: boolean;
}> = {}) {
  return partnerMembersRouter.createCaller({
    user: {
      id: overrides.id ?? 'admin-1',
      partnerId: overrides.partnerId === undefined ? 'p-tenant-a' : overrides.partnerId,
      role: (overrides.role ?? 'admin') as 'admin',
      isPlatformOperator: overrides.isPlatformOperator ?? false,
      departments: [],
    },
  } as unknown as CallerCtx);
}

function mockMembershipLookup(rows: Array<{ id: string; role: string; userId: string }>) {
  dbSelectMock.mockImplementationOnce(() => ({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(rows),
      }),
    }),
  }));
}

function mockPartnerDepartmentsLookup(deptIds: string[]) {
  dbSelectMock.mockImplementationOnce(() => ({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve([{ departments: deptIds.map(id => ({ id, name: id })) }]),
      }),
    }),
  }));
}

describe('partner.updateMemberDepartments', () => {
  let updateSet: ReturnType<typeof vi.fn>;
  let updateWhere: ReturnType<typeof vi.fn>;
  let insertValues: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    dbSelectMock.mockReset();
    dbUpdateMock.mockReset();
    dbInsertMock.mockReset();

    updateWhere = vi.fn().mockResolvedValue(undefined);
    updateSet = vi.fn(() => ({ where: updateWhere }));
    dbUpdateMock.mockReturnValue({ set: updateSet });

    insertValues = vi.fn().mockResolvedValue(undefined);
    dbInsertMock.mockReturnValue({ values: insertValues });
  });

  it('updates departments + writes audit row for a support member', async () => {
    mockMembershipLookup([{ id: 'm-1', role: 'support', userId: 'u-target' }]);
    mockPartnerDepartmentsLookup(['sales', 'tech']);

    const caller = makeCaller({ id: 'admin-1' });
    const result = await caller.updateMemberDepartments({
      membershipId: 'm-1',
      departments: ['sales'],
    });

    expect(result).toEqual({ success: true });
    expect(updateSet).toHaveBeenCalledWith({ departments: ['sales'] });
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      action: 'member.updated',
      actorId: 'admin-1',
      partnerId: 'p-tenant-a',
      targetType: 'user',
      targetId: 'u-target',
      metadata: { departments: ['sales'] },
    }));
  });

  it('throws BAD_REQUEST when target is admin', async () => {
    mockMembershipLookup([{ id: 'm-1', role: 'admin', userId: 'u-target' }]);

    const caller = makeCaller();
    await expect(
      caller.updateMemberDepartments({ membershipId: 'm-1', departments: ['sales'] }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(updateSet).not.toHaveBeenCalled();
    expect(insertValues).not.toHaveBeenCalled();
  });

  it('throws BAD_REQUEST when target is agent', async () => {
    mockMembershipLookup([{ id: 'm-1', role: 'agent', userId: 'u-target' }]);

    const caller = makeCaller();
    await expect(
      caller.updateMemberDepartments({ membershipId: 'm-1', departments: ['sales'] }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(updateSet).not.toHaveBeenCalled();
  });

  it('throws BAD_REQUEST for unknown department id', async () => {
    mockMembershipLookup([{ id: 'm-1', role: 'support', userId: 'u-target' }]);
    mockPartnerDepartmentsLookup(['sales', 'tech']);

    const caller = makeCaller();
    await expect(
      caller.updateMemberDepartments({
        membershipId: 'm-1',
        departments: ['sales', 'unknown-dept'],
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(updateSet).not.toHaveBeenCalled();
  });

  it('throws NOT_FOUND when membership is in another partner', async () => {
    mockMembershipLookup([]);

    const caller = makeCaller();
    await expect(
      caller.updateMemberDepartments({ membershipId: 'm-cross', departments: ['sales'] }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(updateSet).not.toHaveBeenCalled();
  });

  it('rejects empty department list at input layer', async () => {
    const caller = makeCaller();
    await expect(
      caller.updateMemberDepartments({ membershipId: 'm-1', departments: [] }),
    ).rejects.toThrow();
    expect(dbSelectMock).not.toHaveBeenCalled();
  });
});
