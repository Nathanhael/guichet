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
        orderBy: vi.fn(async () => selectQueue.shift()),
      })),
      innerJoin: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(async () => selectQueue.shift()),
        })),
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
  execute: vi.fn(),
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

vi.mock('../../services/mail.js', () => ({
  MailService: {
    sendMail: vi.fn(async () => true),
  },
}));

describe('platform router tenant and sso audit logging', () => {
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

  it('writes an audit record when creating a tenant', async () => {
    const { platformRouter } = await import('./platform/index.js');
    const caller = platformRouter.createCaller({
      user: {
        id: 'platform-1',
        role: 'admin',
        isPlatformOperator: true,
        platformStepUpAt: Math.floor(Date.now() / 1000),
      },
    } as any);

    const result = await caller.createPartner({
      id: 'tenant-a',
      name: 'Tenant A',
      logoUrl: null,
      industry: 'telecom',
      departments: [],
      authMethod: 'sso',
    });

    expect(result).toEqual({ success: true, id: 'tenant-a' });
    expect(insertValuesMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
      id: 'tenant-a',
      name: 'Tenant A',
      authMethod: 'sso',
    }));
    expect(insertValuesMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
      action: 'partner.created',
      actorId: 'platform-1',
      partnerId: 'tenant-a',
      targetType: 'partner',
      targetId: 'tenant-a',
      metadata: expect.objectContaining({
        authMethod: 'sso',
        industry: 'telecom',
      }),
    }));
  });

  it('writes an audit record when deactivating a tenant', async () => {
    const { platformRouter } = await import('./platform/index.js');
    const caller = platformRouter.createCaller({
      user: {
        id: 'platform-1',
        role: 'admin',
        isPlatformOperator: true,
        platformStepUpAt: Math.floor(Date.now() / 1000),
      },
    } as any);

    const result = await caller.deactivatePartner({ partnerId: 'tenant-a' });

    expect(result).toEqual({ success: true });
    expect(insertValuesMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'partner.deactivated',
      actorId: 'platform-1',
      partnerId: 'tenant-a',
      targetType: 'partner',
      targetId: 'tenant-a',
    }));
  });

  it('writes an audit record when adding an SSO group mapping', async () => {
    selectQueue.push([{ authMethod: 'sso' }]);

    const { platformRouter } = await import('./platform/index.js');
    const caller = platformRouter.createCaller({
      user: {
        id: 'platform-1',
        role: 'admin',
        isPlatformOperator: true,
        platformStepUpAt: Math.floor(Date.now() / 1000),
      },
    } as any);

    const result = await caller.addGroupMapping({
      partnerId: 'tenant-a',
      azureGroupId: 'group-1',
      azureGroupName: 'BU-Telecom-Support',
      defaultRole: 'support',
      defaultDepartments: ['billing'],
    });

    expect(result).toEqual(expect.objectContaining({ success: true, id: expect.any(String) }));
    expect(insertValuesMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
      partnerId: 'tenant-a',
      azureGroupId: 'group-1',
      defaultRole: 'support',
    }));
    expect(insertValuesMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
      action: 'sso.group_mapping_added',
      actorId: 'platform-1',
      partnerId: 'tenant-a',
      targetType: 'group_mapping',
      metadata: expect.objectContaining({
        azureGroupId: 'group-1',
        defaultRole: 'support',
      }),
    }));
  });
});
