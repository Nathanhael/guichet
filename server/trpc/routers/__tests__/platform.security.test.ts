import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ─────────────────────────────────────────────────────────

const {
  dbSelectMock,
  dbInsertMock,
  insertedAuditRows,
  upsertedSettings,
  selectLimitMock,
  insertValuesMock,
  insertOnConflictMock,
  selectQueueByKey,
} = vi.hoisted(() => {
  const insertedAuditRows: Array<Record<string, unknown>> = [];
  const upsertedSettings: Array<{ key: string; value: unknown }> = [];

  // Per-key resolution queue: tests prime which rows the next select returns
  // for { ai_pii_redaction_default, ai_audit_verbosity_default }.
  // Default (no priming) = empty (defaults branch).
  const selectQueueByKey: Record<string, unknown[][]> = {};

  // Track currently-bound key on the chain so .limit() resolves the right queue
  let lastWhereKey: string | undefined;

  const selectLimitMock = vi.fn(async () => {
    const k = lastWhereKey;
    if (!k) return [];
    const queue = selectQueueByKey[k];
    if (!queue || queue.length === 0) return [];
    return queue.shift()!;
  });

  const selectWhereMock = vi.fn((cond: { __op: string; col?: unknown; val?: unknown }) => {
    // We mock eq() to pass { __op:'eq', col, val }, so capture val as the key being searched
    lastWhereKey = typeof cond?.val === 'string' ? cond.val : undefined;
    return { limit: selectLimitMock };
  });

  const selectFromMock = vi.fn(() => ({ where: selectWhereMock }));
  const dbSelectMock = vi.fn(() => ({ from: selectFromMock }));

  // Insert chain: db.insert(table).values(row).onConflictDoUpdate({...}) OR a plain audit insert
  // For audit_log inserts, .values(row) just resolves. For systemSettings upserts,
  // .values(row).onConflictDoUpdate({ set }) resolves.
  const insertOnConflictMock = vi.fn(async (cfg: { set: Record<string, unknown> }) => {
    // The values() call captured the (key, value) row separately via insertValuesMock
    // When this runs we already pushed the upsert row. The onConflict path means
    // we replace the same key — for our purposes the latest values() row is "the truth".
    void cfg;
    return undefined;
  });

  const insertValuesMock = vi.fn((row: Record<string, unknown>) => {
    if (typeof row?.key === 'string' && 'value' in row) {
      // system_settings upsert
      upsertedSettings.push({ key: row.key as string, value: row.value });
      return { onConflictDoUpdate: insertOnConflictMock };
    }
    // audit_log row
    insertedAuditRows.push(row);
    return Promise.resolve(undefined);
  });

  const dbInsertMock = vi.fn(() => ({ values: insertValuesMock }));

  return {
    dbSelectMock,
    dbInsertMock,
    insertedAuditRows,
    upsertedSettings,
    selectLimitMock,
    insertValuesMock,
    insertOnConflictMock,
    selectQueueByKey,
  };
});

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('../../../db.js', () => ({
  db: {
    select: dbSelectMock,
    insert: dbInsertMock,
  },
}));

vi.mock('../../../db/schema.js', () => ({
  systemSettings: {
    key: { name: 'key' },
    value: { name: 'value' },
    updatedAt: { name: 'updated_at' },
  },
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
    sql: vi.fn(),
  };
});

vi.mock('../../../services/roles.js', () => ({
  isPlatformAdmin: vi.fn((v: boolean) => v),
  isTenantAdmin: vi.fn((role: string) => role === 'admin'),
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

// ── Import router AFTER mocks ────────────────────────────────────────────

import { platformSecurityRouter } from '../platform/security.js';

type CallerCtx = Parameters<typeof platformSecurityRouter.createCaller>[0];

function makeCaller(opts: { isPlatformOperator?: boolean; userId?: string } = {}) {
  return platformSecurityRouter.createCaller({
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

describe('platformSecurityRouter.getAiSecurityDefaults', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertedAuditRows.length = 0;
    upsertedSettings.length = 0;
    Object.keys(selectQueueByKey).forEach(k => delete selectQueueByKey[k]);
    // Re-wire defaults after clearAllMocks
    insertValuesMock.mockImplementation((row: Record<string, unknown>) => {
      if (typeof row?.key === 'string' && 'value' in row) {
        upsertedSettings.push({ key: row.key as string, value: row.value });
        return { onConflictDoUpdate: insertOnConflictMock };
      }
      insertedAuditRows.push(row);
      return Promise.resolve(undefined);
    });
    selectLimitMock.mockImplementation(async () => {
      // Default fallback — see hoisted block above
      // (pull last where-bound key from closure)
      // Reading from selectQueueByKey directly here.
      // We can't access lastWhereKey from outside; emulate by walking queues.
      // Simpler: every call shifts the next non-empty queue.
      const allKeys = Object.keys(selectQueueByKey);
      for (const k of allKeys) {
        const q = selectQueueByKey[k];
        if (q && q.length > 0) return q.shift()!;
      }
      return [];
    });
  });

  it('returns safe defaults (on / metadata) when system_settings is empty', async () => {
    const result = await makeCaller().getAiSecurityDefaults();
    expect(result).toEqual({ piiRedaction: 'on', auditVerbosity: 'metadata' });
  });

  it('returns the saved values when system_settings has both keys', async () => {
    selectQueueByKey['ai_pii_redaction_default'] = [[{ value: 'off' }]];
    selectQueueByKey['ai_audit_verbosity_default'] = [[{ value: 'full' }]];

    const result = await makeCaller().getAiSecurityDefaults();
    expect(result).toEqual({ piiRedaction: 'off', auditVerbosity: 'full' });
  });

  it('rejects non-platform-operator callers (FORBIDDEN)', async () => {
    const caller = makeCaller({ isPlatformOperator: false });
    await expect(caller.getAiSecurityDefaults()).rejects.toThrow();
  });
});

describe('platformSecurityRouter.setAiSecurityDefaults', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertedAuditRows.length = 0;
    upsertedSettings.length = 0;
    Object.keys(selectQueueByKey).forEach(k => delete selectQueueByKey[k]);
    insertValuesMock.mockImplementation((row: Record<string, unknown>) => {
      if (typeof row?.key === 'string' && 'value' in row) {
        upsertedSettings.push({ key: row.key as string, value: row.value });
        return { onConflictDoUpdate: insertOnConflictMock };
      }
      insertedAuditRows.push(row);
      return Promise.resolve(undefined);
    });
    selectLimitMock.mockImplementation(async () => {
      const allKeys = Object.keys(selectQueueByKey);
      for (const k of allKeys) {
        const q = selectQueueByKey[k];
        if (q && q.length > 0) return q.shift()!;
      }
      return [];
    });
  });

  it('rejects non-platform-operator callers (FORBIDDEN)', async () => {
    const caller = makeCaller({ isPlatformOperator: false });
    await expect(
      caller.setAiSecurityDefaults({ piiRedaction: 'on', auditVerbosity: 'metadata' }),
    ).rejects.toThrow();
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it('upserts both system_settings keys with the supplied values', async () => {
    // Prime the BEFORE read (used to compute diff) — both keys empty so before is {on, metadata}
    const result = await makeCaller().setAiSecurityDefaults({
      piiRedaction: 'off',
      auditVerbosity: 'full',
    });

    expect(result).toEqual({ ok: true });

    const piiUpsert = upsertedSettings.find(s => s.key === 'ai_pii_redaction_default');
    const auditUpsert = upsertedSettings.find(s => s.key === 'ai_audit_verbosity_default');
    expect(piiUpsert).toBeDefined();
    expect(auditUpsert).toBeDefined();
    expect(piiUpsert!.value).toBe('off');
    expect(auditUpsert!.value).toBe('full');
  });

  it('writes an audit_log row with action "platform.ai_security_updated" containing the diff', async () => {
    // Prime BEFORE read to non-default current values so the diff is non-empty.
    selectQueueByKey['ai_pii_redaction_default'] = [[{ value: 'on' }]];
    selectQueueByKey['ai_audit_verbosity_default'] = [[{ value: 'metadata' }]];

    await makeCaller({ userId: 'operator-bart' }).setAiSecurityDefaults({
      piiRedaction: 'off',
      auditVerbosity: 'full',
    });

    expect(insertedAuditRows).toHaveLength(1);
    const row = insertedAuditRows[0] as {
      action: string;
      actorId: string;
      targetType: string;
      metadata: { before: Record<string, unknown>; after: Record<string, unknown> };
    };
    expect(row.action).toBe('platform.ai_security_updated');
    expect(row.actorId).toBe('operator-bart');
    expect(row.metadata.before).toMatchObject({ piiRedaction: 'on', auditVerbosity: 'metadata' });
    expect(row.metadata.after).toMatchObject({ piiRedaction: 'off', auditVerbosity: 'full' });
  });
});
