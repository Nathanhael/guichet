/**
 * Behavior test for partner.audit.* guest gating.
 *
 * Both `getAuditLog` and `getForTicket` left-join `users.name` for the actor.
 * If a platform operator has acted on this partner (via `/enter-partner`),
 * their name appears in the result. A B2B guest admin must not see this —
 * the gate is `partnerInternalAdminReadProcedure`.
 *
 * Three cases per endpoint, mirrored from partner.listAdmins.test.ts:
 *   1. Internal admin (isExternal=false) → returns audit rows.
 *   2. Platform operator (isPlatformOperator=true) → returns rows (operator bypass).
 *   3. B2B guest admin (isExternal=true) → throws FORBIDDEN.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ─────────────────────────────────────────────────────────

const { dbSelectMock } = vi.hoisted(() => ({
  dbSelectMock: vi.fn(),
}));

vi.mock('../../db.js', () => ({
  db: { select: dbSelectMock },
}));

vi.mock('../../db/schema.js', () => ({
  users: {
    id: { name: 'id' },
    name: { name: 'name' },
    isExternal: { name: 'isExternal' },
  },
  auditLog: {
    id: { name: 'id' },
    action: { name: 'action' },
    actorId: { name: 'actorId' },
    partnerId: { name: 'partnerId' },
    targetType: { name: 'targetType' },
    targetId: { name: 'targetId' },
    metadata: { name: 'metadata' },
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
    gte: vi.fn(() => ({ __op: 'gte' })),
    lte: vi.fn(() => ({ __op: 'lte' })),
    sql: Object.assign(vi.fn(() => ({ __op: 'sql' })), { raw: vi.fn() }),
  };
});

vi.mock('../../services/roles.js', () => ({
  isPlatformAdmin: vi.fn((v: boolean) => v),
  isTenantAdmin: vi.fn((role: string) => role === 'admin'),
}));

vi.mock('../../utils/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../utils/redis.js', () => ({
  getRedisClients: () => ({ pubClient: null }),
}));

vi.mock('../../services/archive.js', () => ({
  verifyAuditChain: vi.fn(),
}));

vi.mock('../../config.js', () => ({
  default: { JWT_SECRET: 'test-secret-key-that-is-long-enough-for-hs256' },
}));

vi.mock('../../constants.js', () => ({
  DISABLED_FEATURES: [],
}));

// ── Import router AFTER mocks ────────────────────────────────────────────

import { partnerAuditRouter } from './partner/audit.js';

type CallerCtx = Parameters<typeof partnerAuditRouter.createCaller>[0];

const ROW = {
  id: 'a-1',
  action: 'member.invited',
  actorId: 'u-actor',
  actorName: 'Operator Olivia',
  partnerId: 'p-tenant-a',
  targetType: 'user',
  targetId: 'u-target',
  metadata: {},
  createdAt: '2026-04-25T12:00:00Z',
};

function makeCaller(overrides: Partial<{
  id: string;
  partnerId: string | null;
  role: string;
  isPlatformOperator: boolean;
  isExternal: boolean;
}> = {}) {
  return partnerAuditRouter.createCaller({
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

/** Audit query: .from(auditLog).leftJoin(...).where(...).orderBy(...).limit(...) */
function mockAuditQuery(rows: Array<typeof ROW>) {
  dbSelectMock.mockImplementationOnce(() => ({
    from: () => ({
      leftJoin: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => Promise.resolve(rows),
          }),
        }),
      }),
    }),
  }));
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('partner.audit.getAuditLog — guest gating', () => {
  beforeEach(() => {
    dbSelectMock.mockReset();
  });

  it('returns audit rows for an internal admin caller (isExternal=false)', async () => {
    // Slice #71: blockExternalUsers reads ctx.user.isExternal directly — no DB lookup.
    mockAuditQuery([ROW]);

    const caller = makeCaller({ id: 'caller-internal', role: 'admin', isExternal: false });
    const result = await caller.getAuditLog({ limit: 50 });

    expect(result.items).toEqual([ROW]);
  });

  it('returns audit rows for a platform operator caller (operator bypass)', async () => {
    mockAuditQuery([ROW]);

    const caller = makeCaller({
      id: 'caller-operator',
      role: 'support',
      isPlatformOperator: true,
    });
    const result = await caller.getAuditLog({ limit: 50 });

    expect(result.items).toEqual([ROW]);
  });

  it('throws FORBIDDEN for a B2B guest admin caller (isExternal=true)', async () => {
    const caller = makeCaller({
      id: 'caller-guest',
      role: 'admin',
      isPlatformOperator: false,
      isExternal: true,
    });

    await expect(caller.getAuditLog({ limit: 50 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('partner.audit.getForTicket — guest gating', () => {
  beforeEach(() => {
    dbSelectMock.mockReset();
  });

  it('returns ticket audit rows for an internal admin caller', async () => {
    mockAuditQuery([ROW]);

    const caller = makeCaller({ id: 'caller-internal', role: 'admin', isExternal: false });
    const result = await caller.getForTicket({ ticketId: 't-1', limit: 100 });

    expect(result).toEqual([ROW]);
  });

  it('returns ticket audit rows for a platform operator caller', async () => {
    mockAuditQuery([ROW]);

    const caller = makeCaller({
      id: 'caller-operator',
      role: 'support',
      isPlatformOperator: true,
    });
    const result = await caller.getForTicket({ ticketId: 't-1', limit: 100 });

    expect(result).toEqual([ROW]);
  });

  it('throws FORBIDDEN for a B2B guest admin caller', async () => {
    const caller = makeCaller({
      id: 'caller-guest',
      role: 'admin',
      isPlatformOperator: false,
      isExternal: true,
    });

    await expect(
      caller.getForTicket({ ticketId: 't-1', limit: 100 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
