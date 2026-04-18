import { beforeEach, describe, expect, it, vi } from 'vitest';

const selectQueue: unknown[] = [];
const insertValuesMock = vi.fn();
const updateWhereMock = vi.fn();
const deleteWhereMock = vi.fn();

const dbMock = {
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
    where: deleteWhereMock,
  })),
};

vi.mock('../../db.js', () => ({
  db: dbMock,
}));

vi.mock('../../utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../utils/redis.js', () => ({
  getRedisClients: vi.fn(() => ({ pubClient: null })),
}));

vi.mock('../../socket/handlers.js', () => ({
  broadcastPartnerDeactivation: vi.fn(),
}));

describe('platform router audit logging', () => {
  beforeEach(() => {
    selectQueue.length = 0;
    dbMock.select.mockClear();
    dbMock.insert.mockClear();
    dbMock.update.mockClear();
    dbMock.delete.mockClear();
    insertValuesMock.mockReset();
    insertValuesMock.mockResolvedValue(undefined);
    updateWhereMock.mockReset();
    updateWhereMock.mockResolvedValue(undefined);
    deleteWhereMock.mockReset();
    deleteWhereMock.mockResolvedValue(undefined);
  });

  it('writes an audit record when removing a membership', async () => {
    selectQueue.push([
      {
        id: 'mem-1',
        userId: 'user-2',
        partnerId: 'tenant-a',
        role: 'support',
      },
    ]);

    const { platformRouter } = await import('./platform/index.js');
    const caller = platformRouter.createCaller({
      user: {
        id: 'platform-1',
        role: 'admin',
        isPlatformOperator: true,
      },
    } as any);

    const result = await caller.removeMembership('mem-1');

    expect(result).toEqual({ success: true });
    expect(deleteWhereMock).toHaveBeenCalled();
    expect(insertValuesMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'member.removed',
      actorId: 'platform-1',
      partnerId: 'tenant-a',
      targetType: 'user',
      targetId: 'user-2',
      metadata: { membershipId: 'mem-1', role: 'support' },
    }));
  });

  it('writes an audit record when updating a membership role', async () => {
    selectQueue.push(
      [
        {
          id: 'mem-1',
          userId: 'user-2',
          partnerId: 'tenant-a',
          role: 'support',
        },
      ],
      [
        {
          id: 'mem-1',
          userId: 'user-2',
          partnerId: 'tenant-a',
          role: 'admin',
        },
      ],
      []
    );

    const { platformRouter } = await import('./platform/index.js');
    const caller = platformRouter.createCaller({
      user: {
        id: 'platform-1',
        role: 'admin',
        isPlatformOperator: true,
      },
    } as any);

    const result = await caller.updateMembership({
      id: 'mem-1',
      data: {
        role: 'admin',
        departments: ['billing'],
      },
    });

    expect(result).toEqual({ success: true });
    expect(updateWhereMock).toHaveBeenCalled();
    expect(insertValuesMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'member.updated',
      actorId: 'platform-1',
      partnerId: 'tenant-a',
      targetType: 'user',
      targetId: 'user-2',
      metadata: {
        membershipId: 'mem-1',
        oldRole: 'support',
        newRole: 'admin',
      },
    }));
  });
});
