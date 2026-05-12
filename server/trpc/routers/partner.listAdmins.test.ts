/**
 * Behavior test for partner.listAdmins.
 *
 * The endpoint must:
 *   1. Return the admin roster for an internal admin caller.
 *   2. Return the admin roster for a platform operator caller (operator bypass).
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

vi.mock('../../services/sessionRevocation.js', () => ({
  revokeUserSessions: vi.fn(),
}));

vi.mock('../../services/refreshToken.js', () => ({
  revokeAllUserRefreshTokens: vi.fn(),
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

vi.mock('../../utils/security.js', () => ({
  escapeLikePattern: (s: string) => s,
}));

vi.mock('../../config.js', () => ({
  default: { JWT_SECRET: 'test-secret-key-that-is-long-enough-for-hs256' },
}));

vi.mock('../../constants.js', () => ({
  DISABLED_FEATURES: [],
}));

// ── Import router AFTER mocks ────────────────────────────────────────────

import { partnerMembersRouter } from './partner/members.js';

type CallerCtx = Parameters<typeof partnerMembersRouter.createCaller>[0];

const ROSTER = [
  {
    membershipId: 'm-1',
    userId: 'u-alice',
    name: 'Alice Admin',
    email: 'alice@internal.test',
    lastActiveAt: null,
  },
  {
    membershipId: 'm-2',
    userId: 'u-bob',
    name: 'Bob Admin',
    email: 'bob@internal.test',
    lastActiveAt: null,
  },
];

function makeCaller(overrides: Partial<{
  id: string;
  partnerId: string | null;
  role: string;
  isPlatformOperator: boolean;
}> = {}) {
  return partnerMembersRouter.createCaller({
    user: {
      id: overrides.id ?? 'caller-id',
      partnerId: overrides.partnerId === undefined ? 'p-tenant-a' : overrides.partnerId,
      role: (overrides.role ?? 'admin') as 'admin',
      isPlatformOperator: overrides.isPlatformOperator ?? false,
      departments: [],
    },
  } as unknown as CallerCtx);
}

/** Roster select() call: .from(memberships).innerJoin(...).where(...).orderBy(...) */
function mockRosterQuery(rows: typeof ROSTER) {
  dbSelectMock.mockImplementationOnce(() => ({
    from: () => ({
      innerJoin: () => ({
        where: () => ({
          orderBy: () => Promise.resolve(rows),
        }),
      }),
    }),
  }));
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('partner.listAdmins', () => {
  beforeEach(() => {
    dbSelectMock.mockReset();
  });

  it('returns the admin roster for an internal admin caller', async () => {
    mockRosterQuery(ROSTER);

    const caller = makeCaller({
      id: 'caller-internal-admin',
      role: 'admin',
      isPlatformOperator: false,
    });
    const result = await caller.listAdmins();

    expect(result).toEqual(ROSTER);
  });

  it('returns the admin roster for a platform operator caller (operator bypass)', async () => {
    mockRosterQuery(ROSTER);

    const caller = makeCaller({
      id: 'caller-operator',
      role: 'support',
      isPlatformOperator: true,
    });
    const result = await caller.listAdmins();

    expect(result).toEqual(ROSTER);
  });
});
