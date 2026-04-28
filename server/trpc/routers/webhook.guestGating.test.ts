/**
 * Behavior test for the webhook router's B2B-guest gate.
 *
 * After Bundle A slice 6 (issue #71), the webhook router's destructive ops
 * (`create`, `update`, `regenerateSecret`, `delete`, `test`) drop the
 * `gatedPartnerAdminNoGuests` wrapper and instead resolve the gate inline via
 * `trpcActor(ctx, { capability: 'destructive_admin' })`. This test pins the
 * runtime FORBIDDEN behavior so the rule can't silently regress under future
 * refactors.
 *
 * Three callers per destructive op:
 *   1. internal admin (`isExternal=false`)        → succeeds
 *   2. platform operator (`isPlatformOperator=true`) → succeeds (operator bypass)
 *   3. B2B guest admin (`isExternal=true`)        → throws TRPCError FORBIDDEN
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ─────────────────────────────────────────────────────────

const { dbInsertMock, dbSelectMock, dbUpdateMock, dbDeleteMock } = vi.hoisted(() => ({
  dbInsertMock: vi.fn(),
  dbSelectMock: vi.fn(),
  dbUpdateMock: vi.fn(),
  dbDeleteMock: vi.fn(),
}));

vi.mock('../../db.js', () => ({
  db: {
    insert: dbInsertMock,
    select: dbSelectMock,
    update: dbUpdateMock,
    delete: dbDeleteMock,
  },
}));

vi.mock('../../db/schema.js', () => ({
  webhooks: {
    id: { name: 'id' },
    partnerId: { name: 'partnerId' },
    url: { name: 'url' },
    secret: { name: 'secret' },
    events: { name: 'events' },
    description: { name: 'description' },
    active: { name: 'active' },
    createdBy: { name: 'createdBy' },
    createdAt: { name: 'createdAt' },
    updatedAt: { name: 'updatedAt' },
  },
  webhookLogs: {
    id: { name: 'id' },
    webhookId: { name: 'webhookId' },
    event: { name: 'event' },
    statusCode: { name: 'statusCode' },
    error: { name: 'error' },
    durationMs: { name: 'durationMs' },
    createdAt: { name: 'createdAt' },
  },
}));

vi.mock('drizzle-orm', async () => {
  const actual = await vi.importActual<typeof import('drizzle-orm')>('drizzle-orm');
  return {
    ...actual,
    eq: vi.fn(() => ({ __op: 'eq' })),
    and: vi.fn(() => ({ __op: 'and' })),
    desc: vi.fn(() => ({ __op: 'desc' })),
  };
});

vi.mock('../../services/roles.js', () => ({
  isPlatformAdmin: vi.fn((v: boolean) => v),
  isTenantAdmin: vi.fn((role: string) => role === 'admin'),
  isSupportLike: vi.fn(() => false),
  canUseSupportWorkflows: vi.fn(() => false),
  canManageTenant: vi.fn(() => false),
  canExportTickets: vi.fn(() => false),
}));

vi.mock('../../services/encryption.js', () => ({
  encrypt: vi.fn((v: string) => `enc:${v}`),
}));

vi.mock('../../services/webhookDispatch.js', () => ({
  validateWebhookUrl: vi.fn().mockResolvedValue(undefined),
  deliverWebhookTest: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../utils/trpcErrors.js', async () => {
  const actual = await vi.importActual<typeof import('../../utils/trpcErrors.js')>(
    '../../utils/trpcErrors.js',
  );
  return actual;
});

vi.mock('../../config.js', () => ({
  default: { JWT_SECRET: 'test-secret-key-that-is-long-enough-for-hs256' },
}));

vi.mock('../../constants.js', () => ({
  DISABLED_FEATURES: [],
}));

// ── Import router AFTER mocks ────────────────────────────────────────────

import { webhookRouter } from './webhook.js';

type CallerCtx = Parameters<typeof webhookRouter.createCaller>[0];

function makeCaller(overrides: Partial<{
  id: string;
  partnerId: string | null;
  role: string;
  isPlatformOperator: boolean;
  isExternal: boolean;
}> = {}) {
  return webhookRouter.createCaller({
    user: {
      id: overrides.id ?? 'caller-id',
      partnerId: overrides.partnerId === undefined ? 'p-tenant-a' : overrides.partnerId,
      role: (overrides.role ?? 'admin') as 'admin',
      isPlatformOperator: overrides.isPlatformOperator ?? false,
      isExternal: overrides.isExternal ?? false,
      departments: [],
    },
  } as unknown as CallerCtx);
}

/** db.insert(webhooks).values({...}) — terminal Promise. */
function mockInsertOk() {
  dbInsertMock.mockImplementationOnce(() => ({
    values: () => Promise.resolve(undefined),
  }));
}

const VALID_CREATE_INPUT = {
  url: 'https://hooks.example.test/inbox',
  events: ['ticket.created' as const],
  description: 'pin guest gate',
};

// ── Tests ─────────────────────────────────────────────────────────────────

describe('webhook.create — guest gating', () => {
  beforeEach(() => {
    dbInsertMock.mockReset();
    dbSelectMock.mockReset();
  });

  it('succeeds for an internal admin caller (isExternal=false)', async () => {
    mockInsertOk();

    const caller = makeCaller({ id: 'caller-internal', role: 'admin', isExternal: false });
    const result = await caller.create(VALID_CREATE_INPUT);

    expect(result).toMatchObject({ id: expect.any(String), secret: expect.any(String) });
    expect(dbInsertMock).toHaveBeenCalledTimes(1);
  });

  it('succeeds for a platform operator caller (operator bypass)', async () => {
    mockInsertOk();

    const caller = makeCaller({
      id: 'caller-operator',
      role: 'support',
      isPlatformOperator: true,
    });
    const result = await caller.create(VALID_CREATE_INPUT);

    expect(result).toMatchObject({ id: expect.any(String), secret: expect.any(String) });
    expect(dbInsertMock).toHaveBeenCalledTimes(1);
  });

  it('throws FORBIDDEN for a B2B guest admin caller (isExternal=true)', async () => {
    const caller = makeCaller({
      id: 'caller-guest',
      role: 'admin',
      isPlatformOperator: false,
      isExternal: true,
    });

    await expect(caller.create(VALID_CREATE_INPUT)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // Critical: gate must short-circuit before any DB write happens.
    expect(dbInsertMock).not.toHaveBeenCalled();
  });
});

describe('webhook.delete — guest gating', () => {
  beforeEach(() => {
    dbDeleteMock.mockReset();
  });

  it('throws FORBIDDEN for a B2B guest admin caller', async () => {
    const caller = makeCaller({
      id: 'caller-guest',
      role: 'admin',
      isPlatformOperator: false,
      isExternal: true,
    });

    await expect(caller.delete({ id: 'wh-1' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(dbDeleteMock).not.toHaveBeenCalled();
  });
});

describe('webhook.regenerateSecret — guest gating', () => {
  beforeEach(() => {
    dbSelectMock.mockReset();
    dbUpdateMock.mockReset();
  });

  it('throws FORBIDDEN for a B2B guest admin caller', async () => {
    const caller = makeCaller({
      id: 'caller-guest',
      role: 'admin',
      isPlatformOperator: false,
      isExternal: true,
    });

    await expect(caller.regenerateSecret({ id: 'wh-1' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(dbSelectMock).not.toHaveBeenCalled();
    expect(dbUpdateMock).not.toHaveBeenCalled();
  });
});
