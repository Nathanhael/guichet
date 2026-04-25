import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ─────────────────────────────────────────────────────────

const {
  dbSelectMock,
  limitMock,
  eqMock,
  andMock,
  sqlMock,
  capturedConditions,
} = vi.hoisted(() => {
  const capturedConditions: unknown[] = [];
  const dbSelectMock = vi.fn();
  const fromMock = vi.fn();
  const leftJoinMock = vi.fn();
  const whereMock = vi.fn();
  const orderByMock = vi.fn();
  const limitMock = vi.fn();

  dbSelectMock.mockReturnValue({ from: fromMock });
  fromMock.mockReturnValue({ leftJoin: leftJoinMock });
  leftJoinMock.mockReturnValue({ where: whereMock });
  whereMock.mockReturnValue({ orderBy: orderByMock });
  orderByMock.mockReturnValue({ limit: limitMock });
  limitMock.mockResolvedValue([]);

  // eq returns a tagged marker we can inspect
  const eqMock = vi.fn((col: unknown, val: unknown) => ({ __op: 'eq', col, val }));
  const andMock = vi.fn((...args: unknown[]) => {
    // When called by the router, capture the conditions array we received.
    capturedConditions.push(args);
    return { __op: 'and', args };
  });
  const sqlMock = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    __op: 'sql',
    strings: Array.from(strings),
    values,
  }));
  const descMock = vi.fn((col: unknown) => ({ __op: 'desc', col }));
  const gteMock = vi.fn((col: unknown, val: unknown) => ({ __op: 'gte', col, val }));
  const lteMock = vi.fn((col: unknown, val: unknown) => ({ __op: 'lte', col, val }));

  return {
    dbSelectMock,
    fromMock,
    leftJoinMock,
    whereMock,
    orderByMock,
    limitMock,
    eqMock,
    andMock,
    sqlMock,
    descMock,
    gteMock,
    lteMock,
    capturedConditions,
  };
});

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('../../db.js', () => ({
  db: { select: dbSelectMock },
}));

vi.mock('../../db/schema.js', () => ({
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
  users: { id: { name: 'id' }, name: { name: 'name' } },
}));

vi.mock('drizzle-orm', async () => {
  const actual = await vi.importActual<typeof import('drizzle-orm')>('drizzle-orm');
  return {
    ...actual,
    eq: eqMock,
    and: andMock,
    sql: sqlMock,
    desc: (col: unknown) => ({ __op: 'desc', col }),
    gte: (col: unknown, val: unknown) => ({ __op: 'gte', col, val }),
    lte: (col: unknown, val: unknown) => ({ __op: 'lte', col, val }),
  };
});

vi.mock('../../services/roles.js', () => ({
  isPlatformAdmin: vi.fn((v: boolean) => v),
  isTenantAdmin: vi.fn((role: string) => role === 'admin'),
}));

vi.mock('../../utils/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../config.js', () => ({
  default: { JWT_SECRET: 'test-secret-key-that-is-long-enough-for-hs256' },
}));

vi.mock('../../constants.js', () => ({
  DISABLED_FEATURES: [],
}));

// ── Import router AFTER mocks ────────────────────────────────────────────

import { partnerAuditRouter } from './partner/audit.js';
import { auditLog } from '../../db/schema.js';

type CallerCtx = Parameters<typeof partnerAuditRouter.createCaller>[0];

function makeCaller(overrides: Partial<{ partnerId: string | null; role: string; isPlatformOperator: boolean }> = {}) {
  return partnerAuditRouter.createCaller({
    user: {
      id: 'u1',
      partnerId: overrides.partnerId === undefined ? 'p-tenant-a' : overrides.partnerId,
      role: (overrides.role ?? 'admin') as 'admin',
      isPlatformOperator: overrides.isPlatformOperator ?? false,
      departments: [],
    },
  } as unknown as CallerCtx);
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('partnerAuditRouter.getAuditLog — tenant isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedConditions.length = 0;
    limitMock.mockResolvedValue([]);
  });

  it('always force-scopes by ctx.user.partnerId (first condition is eq(auditLog.partnerId, ctx.partnerId))', async () => {
    const caller = makeCaller({ partnerId: 'p-tenant-a' });
    await caller.getAuditLog({ limit: 50 });

    // Router called `and(...conditions)` exactly once per query (inside where()).
    // First captured condition list must start with the partnerId eq() against ctx value.
    const firstCall = capturedConditions[0] as unknown[];
    expect(firstCall).toBeDefined();
    const first = firstCall[0] as { __op: string; col: unknown; val: unknown };
    expect(first.__op).toBe('eq');
    expect(first.col).toBe(auditLog.partnerId);
    expect(first.val).toBe('p-tenant-a');
  });

  it('uses a DIFFERENT partnerId when called by a different tenant (proves scope is per-ctx)', async () => {
    await makeCaller({ partnerId: 'p-tenant-a' }).getAuditLog({ limit: 50 });
    await makeCaller({ partnerId: 'p-tenant-b' }).getAuditLog({ limit: 50 });

    const aPartner = (capturedConditions[0] as unknown[])[0] as { val: string };
    const bPartner = (capturedConditions[1] as unknown[])[0] as { val: string };
    expect(aPartner.val).toBe('p-tenant-a');
    expect(bPartner.val).toBe('p-tenant-b');
  });

  it('rejects input that tries to inject a partnerId field (strict Zod schema)', async () => {
    const caller = makeCaller({ partnerId: 'p-tenant-a' });
    // Zod input schema does not declare partnerId. Passing an unknown field
    // is ignored silently (Zod default), but we prove the ctx value wins anyway:
    // even if extra props slip through, the query still filters by ctx.user.partnerId.
    await caller.getAuditLog({ limit: 50, ...({ partnerId: 'p-tenant-b' } as object) } as never);
    const first = (capturedConditions[0] as unknown[])[0] as { val: string };
    expect(first.val).toBe('p-tenant-a');
    expect(first.val).not.toBe('p-tenant-b');
  });

  it('rejects non-admin callers (agent role → FORBIDDEN)', async () => {
    const caller = makeCaller({ role: 'agent' });
    await expect(caller.getAuditLog({ limit: 50 })).rejects.toThrow();
  });

  it('rejects callers with no active partner context (partnerId = null)', async () => {
    const caller = makeCaller({ partnerId: null });
    await expect(caller.getAuditLog({ limit: 50 })).rejects.toThrow();
  });
});

describe('partnerAuditRouter.getAuditLog — wasExternal filter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedConditions.length = 0;
    limitMock.mockResolvedValue([]);
  });

  it('does NOT add a sql() metadata condition when wasExternal is omitted', async () => {
    await makeCaller().getAuditLog({ limit: 50 });
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('does NOT add a sql() metadata condition when wasExternal is false', async () => {
    await makeCaller().getAuditLog({ limit: 50, wasExternal: false });
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('adds sql() condition querying metadata->>wasExternal when wasExternal=true', async () => {
    await makeCaller().getAuditLog({ limit: 50, wasExternal: true });

    // Exactly one sql() call for the wasExternal filter (cursor wasn't provided).
    expect(sqlMock).toHaveBeenCalledTimes(1);
    const call = sqlMock.mock.calls[0];
    const [strings] = call;
    const joined = (strings as TemplateStringsArray).join('||');
    expect(joined).toContain("->>'wasExternal' = 'true'");
  });

  it('wasExternal filter is appended AFTER the partnerId scope (never replaces it)', async () => {
    await makeCaller({ partnerId: 'p-tenant-a' }).getAuditLog({ limit: 50, wasExternal: true });

    const conditions = capturedConditions[0] as unknown[];
    const first = conditions[0] as { __op: string; val: unknown };
    expect(first.__op).toBe('eq');
    expect(first.val).toBe('p-tenant-a');

    // sql() wasExternal condition must be somewhere in the list (after partnerId).
    const hasWasExternal = conditions.some((c) => {
      const cc = c as { __op: string };
      return cc.__op === 'sql';
    });
    expect(hasWasExternal).toBe(true);
  });
});

describe('partnerAuditRouter.exportAuditLog — tenant isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedConditions.length = 0;
    limitMock.mockResolvedValue([]);
  });

  it('force-scopes by ctx.user.partnerId on export as well', async () => {
    await makeCaller({ partnerId: 'p-tenant-c' }).exportAuditLog({});
    const first = (capturedConditions[0] as unknown[])[0] as { __op: string; val: unknown };
    expect(first.__op).toBe('eq');
    expect(first.val).toBe('p-tenant-c');
  });

  it('export respects wasExternal filter', async () => {
    await makeCaller().exportAuditLog({ wasExternal: true });
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });

  it('rejects non-admin on export', async () => {
    const caller = makeCaller({ role: 'support' });
    await expect(caller.exportAuditLog({})).rejects.toThrow();
  });
});

describe('partnerAuditRouter.listActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the PARTNER_ACTIONS allow-list as an array of strings', async () => {
    const result = await makeCaller().listActions();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain('member.removed');
    expect(result).toContain('sso.membership_revoked');
    // Should NOT contain actions outside the partner scope (e.g. platform-level).
    expect(result).not.toContain('partner.created');
    expect(result).not.toContain('platform.user_deleted');
  });

  it('rejects non-admin on listActions', async () => {
    const caller = makeCaller({ role: 'agent' });
    await expect(caller.listActions()).rejects.toThrow();
  });
});

describe('partnerAuditRouter.getAuditLog — targetType filter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedConditions.length = 0;
    limitMock.mockResolvedValue([]);
  });

  it('does NOT add an eq(targetType) condition when omitted', async () => {
    await makeCaller().getAuditLog({ limit: 50 });
    const conditions = capturedConditions[0] as { __op: string; col?: unknown }[];
    // Only the partnerId eq() should be present (no action/actorId/targetType/etc.)
    expect(conditions.filter(c => c.__op === 'eq')).toHaveLength(1);
  });

  it('adds eq(auditLog.targetType, input.targetType) when provided', async () => {
    await makeCaller().getAuditLog({ limit: 50, targetType: 'webhook' });

    const conditions = capturedConditions[0] as { __op: string; col?: unknown; val?: unknown }[];
    const match = conditions.find(c => c.__op === 'eq' && c.col === auditLog.targetType);
    expect(match).toBeDefined();
    expect(match?.val).toBe('webhook');
  });

  it('targetType filter NEVER replaces the partnerId scope', async () => {
    await makeCaller({ partnerId: 'p-tenant-z' }).getAuditLog({ limit: 50, targetType: 'membership' });
    const conditions = capturedConditions[0] as { __op: string; col?: unknown; val?: unknown }[];
    // partnerId must still be the FIRST condition — tenant isolation is non-negotiable
    expect(conditions[0].__op).toBe('eq');
    expect(conditions[0].col).toBe(auditLog.partnerId);
    expect(conditions[0].val).toBe('p-tenant-z');
  });
});

describe('partnerAuditRouter.getAuditLog — targetId filter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedConditions.length = 0;
    limitMock.mockResolvedValue([]);
  });

  it('does NOT add eq(targetId) when omitted', async () => {
    await makeCaller().getAuditLog({ limit: 50 });
    const conditions = capturedConditions[0] as { __op: string; col?: unknown }[];
    const targetIdConds = conditions.filter(
      (c) => c.__op === 'eq' && c.col === auditLog.targetId,
    );
    expect(targetIdConds).toHaveLength(0);
  });

  it('adds eq(auditLog.targetId, input.targetId) when provided', async () => {
    await makeCaller().getAuditLog({ limit: 50, targetId: 'user-42' });
    const conditions = capturedConditions[0] as { __op: string; col?: unknown; val?: unknown }[];
    const match = conditions.find((c) => c.__op === 'eq' && c.col === auditLog.targetId);
    expect(match).toBeDefined();
    expect(match?.val).toBe('user-42');
  });

  it('targetId filter does not replace the partnerId scope (tenant isolation preserved)', async () => {
    await makeCaller({ partnerId: 'p-tenant-q' }).getAuditLog({ limit: 50, targetId: 'user-42' });
    const conditions = capturedConditions[0] as { __op: string; col?: unknown; val?: unknown }[];
    expect(conditions[0].__op).toBe('eq');
    expect(conditions[0].col).toBe(auditLog.partnerId);
    expect(conditions[0].val).toBe('p-tenant-q');
  });
});

describe('partnerAuditRouter.listTargetTypes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the partner-scoped target-type allow-list', async () => {
    const result = await makeCaller().listTargetTypes();
    expect(Array.isArray(result)).toBe(true);
    expect(result).toContain('webhook');
    expect(result).toContain('membership');
    expect(result).toContain('user');
  });

  it('rejects non-admin on listTargetTypes', async () => {
    const caller = makeCaller({ role: 'agent' });
    await expect(caller.listTargetTypes()).rejects.toThrow();
  });
});
