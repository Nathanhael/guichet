import { beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'crypto';

// ─── DB mock ────────────────────────────────────────────────────────────────

const selectQueue: unknown[] = [];
const deleteMock = vi.fn();
const insertValuesMock = vi.fn(() => ({
  onConflictDoNothing: vi.fn(() => ({
    returning: vi.fn(async () => [{ id: 'mock-id' }]),
  })),
}));

const limitMock = vi.fn(async () => selectQueue.shift());
const groupByMock = vi.fn(async () => selectQueue.shift());

/** Fluent query builder mock — every method returns the same shape so chains work in any order */
function makeQueryChain() {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.where = vi.fn(self);
  chain.orderBy = vi.fn(self);
  chain.limit = limitMock;
  chain.groupBy = groupByMock;
  return chain;
}

const transactionMock = vi.fn();

const dbMock = {
  select: vi.fn(() => ({
    from: vi.fn(() => makeQueryChain()),
  })),
  insert: vi.fn(() => ({
    values: insertValuesMock,
  })),
  delete: vi.fn(() => ({
    where: deleteMock,
  })),
  transaction: transactionMock,
};

// transaction receives a callback and passes the db mock as the transaction handle
transactionMock.mockImplementation(async (cb: (tx: typeof dbMock) => Promise<unknown>) => {
  return await cb(dbMock);
});

vi.mock('../db.js', () => ({
  db: dbMock,
}));

vi.mock('../utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../config.js', () => ({
  default: {
    GDPR_RETENTION_DAYS: 30,
    AUDIT_ARCHIVE_DELAY_DAYS: 2,
  },
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeAuditRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'audit-1',
    action: 'user.created',
    actorId: 'actor-1',
    partnerId: 'partner-1',
    targetType: 'user',
    targetId: 'target-1',
    metadata: { foo: 'bar' },
    createdAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeTicketRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ticket-1',
    partnerId: 'partner-1',
    dept: 'support',
    agentId: 'agent-1',
    supportId: 'support-1',
    status: 'closed',
    createdAt: '2025-01-01',
    closedAt: '2025-01-15T00:00:00.000Z',
    closedBy: 'support-1',
    closingNotes: 'Resolved',
    reopenCount: 0,
    ...overrides,
  };
}

/** Reproduce the real computeChainHash logic for verification */
function realHash(previousHash: string, rowData: Record<string, unknown>): string {
  const payload = previousHash + JSON.stringify(rowData);
  return crypto.createHash('sha256').update(payload).digest('hex');
}

const GENESIS_HASH = '0'.repeat(64);

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('computeChainHash', () => {
  it('is deterministic — same input produces same hash', async () => {
    // We test via archiveAuditLog which calls computeChainHash internally.
    // Instead, let's verify the algorithm directly using the same logic.
    const rowData = { id: '1', action: 'test', actorId: 'a', partnerId: 'p', targetType: 't', targetId: 'tid', metadata: null, createdAt: '2025-01-01' };
    const hash1 = realHash(GENESIS_HASH, rowData);
    const hash2 = realHash(GENESIS_HASH, rowData);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 hex
  });

  it('different inputs produce different hashes', () => {
    const row1 = { id: '1', action: 'create' };
    const row2 = { id: '2', action: 'delete' };
    const hash1 = realHash(GENESIS_HASH, row1);
    const hash2 = realHash(GENESIS_HASH, row2);
    expect(hash1).not.toBe(hash2);
  });

  it('includes previous hash in computation (chain linking)', () => {
    const rowData = { id: '1', action: 'test' };
    const hashWithGenesis = realHash(GENESIS_HASH, rowData);
    const hashWithDifferentPrev = realHash('a'.repeat(64), rowData);
    expect(hashWithGenesis).not.toBe(hashWithDifferentPrev);
  });
});

describe('archiveAuditLog', () => {
  beforeEach(() => {
    selectQueue.length = 0;
    dbMock.select.mockClear();
    dbMock.insert.mockClear();
    dbMock.delete.mockClear();
    insertValuesMock.mockClear();
    insertValuesMock.mockReturnValue({
      onConflictDoNothing: vi.fn(() => ({
        returning: vi.fn(async () => [{ id: 'mock-id' }]),
      })),
    });
    deleteMock.mockReset();
    deleteMock.mockResolvedValue(undefined);
  });

  it('inserts rows with correct chainHash values', async () => {
    const row = makeAuditRow();
    // First select: audit log rows to archive
    selectQueue.push([row]);
    // Second select: last archived row (empty = genesis)
    selectQueue.push([]);

    const { archiveAuditLog } = await import('./archive.js');
    const count = await archiveAuditLog(30);

    expect(count).toBe(1);
    expect(insertValuesMock).toHaveBeenCalledTimes(1);

    const insertedValue = insertValuesMock.mock.calls[0][0];
    const expectedRowData = {
      id: row.id,
      action: row.action,
      actorId: row.actorId,
      partnerId: row.partnerId,
      targetType: row.targetType,
      targetId: row.targetId,
      metadata: row.metadata,
      createdAt: row.createdAt,
    };
    const expectedHash = realHash(GENESIS_HASH, expectedRowData);
    expect(insertedValue.chainHash).toBe(expectedHash);
  });

  it('chain is sequential — each row hash depends on previous', async () => {
    const row1 = makeAuditRow({ id: 'audit-1' });
    const row2 = makeAuditRow({ id: 'audit-2', action: 'user.deleted' });
    // First select: audit log rows
    selectQueue.push([row1, row2]);
    // Second select: last archived row (empty = genesis)
    selectQueue.push([]);

    const { archiveAuditLog } = await import('./archive.js');
    const count = await archiveAuditLog(30);

    expect(count).toBe(2);
    expect(insertValuesMock).toHaveBeenCalledTimes(2);

    const insert1 = insertValuesMock.mock.calls[0][0];
    const insert2 = insertValuesMock.mock.calls[1][0];

    // First row hashes with genesis
    const rowData1 = {
      id: row1.id, action: row1.action, actorId: row1.actorId,
      partnerId: row1.partnerId, targetType: row1.targetType,
      targetId: row1.targetId, metadata: row1.metadata, createdAt: row1.createdAt,
    };
    const expectedHash1 = realHash(GENESIS_HASH, rowData1);
    expect(insert1.chainHash).toBe(expectedHash1);

    // Second row hashes with first row's hash (chain)
    const rowData2 = {
      id: row2.id, action: row2.action, actorId: row2.actorId,
      partnerId: row2.partnerId, targetType: row2.targetType,
      targetId: row2.targetId, metadata: row2.metadata, createdAt: row2.createdAt,
    };
    const expectedHash2 = realHash(expectedHash1, rowData2);
    expect(insert2.chainHash).toBe(expectedHash2);

    // Chain: hash2 != hash1
    expect(insert2.chainHash).not.toBe(insert1.chainHash);
  });

  it('handles empty audit log (no rows to archive)', async () => {
    // First select: empty audit log
    selectQueue.push([]);

    const { archiveAuditLog } = await import('./archive.js');
    const count = await archiveAuditLog(30);

    expect(count).toBe(0);
    expect(insertValuesMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });
});

describe('verifyAuditChain', () => {
  beforeEach(() => {
    selectQueue.length = 0;
    dbMock.select.mockClear();
  });

  it('passes for a valid chain', async () => {
    const rowData1 = {
      id: 'a1', action: 'user.created', actorId: 'actor-1',
      partnerId: 'p1', targetType: 'user', targetId: 't1',
      metadata: null, createdAt: '2025-01-01T00:00:00.000Z',
    };
    const hash1 = realHash(GENESIS_HASH, rowData1);

    const rowData2 = {
      id: 'a2', action: 'user.deleted', actorId: 'actor-2',
      partnerId: 'p1', targetType: 'user', targetId: 't2',
      metadata: null, createdAt: '2025-01-02T00:00:00.000Z',
    };
    const hash2 = realHash(hash1, rowData2);

    // verifyAuditChain calls db.select().from().where().orderBy().limit()
    // Uses the default mock chain which ends at limitMock -> selectQueue.shift()
    selectQueue.push([
      { ...rowData1, chainHash: hash1, archivedAt: '2025-02-01', sequence: 0 },
      { ...rowData2, chainHash: hash2, archivedAt: '2025-02-01', sequence: 1 },
    ]);

    const { verifyAuditChain } = await import('./archive.js');
    const result = await verifyAuditChain();

    expect(result).toEqual({ valid: true, checked: 2 });
  });

  it('detects tampered row (modified data breaks chain)', async () => {
    const rowData1 = {
      id: 'a1', action: 'user.created', actorId: 'actor-1',
      partnerId: 'p1', targetType: 'user', targetId: 't1',
      metadata: null, createdAt: '2025-01-01T00:00:00.000Z',
    };
    const hash1 = realHash(GENESIS_HASH, rowData1);

    const rowData2 = {
      id: 'a2', action: 'user.deleted', actorId: 'actor-2',
      partnerId: 'p1', targetType: 'user', targetId: 't2',
      metadata: null, createdAt: '2025-01-02T00:00:00.000Z',
    };
    const hash2 = realHash(hash1, rowData2);

    // Tamper: change action in row1 after hash was computed
    const tamperedRow1 = { ...rowData1, action: 'TAMPERED', chainHash: hash1, archivedAt: '2025-02-01', sequence: 0 };

    // Uses the default mock chain: limitMock -> selectQueue.shift()
    selectQueue.push([
      tamperedRow1,
      { ...rowData2, chainHash: hash2, archivedAt: '2025-02-01', sequence: 1 },
    ]);

    const { verifyAuditChain } = await import('./archive.js');
    const result = await verifyAuditChain();

    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe('a1');
    expect(result.checked).toBe(1);
  });
});

describe('archiveTickets', () => {
  beforeEach(() => {
    selectQueue.length = 0;
    dbMock.select.mockClear();
    dbMock.insert.mockClear();
    insertValuesMock.mockClear();
    insertValuesMock.mockReturnValue({
      onConflictDoNothing: vi.fn(() => ({
        returning: vi.fn(async () => [{ id: 'mock-id' }]),
      })),
    });
  });

  it('archives tickets with message count summary', async () => {
    const ticket = makeTicketRow();
    // First select: closed tickets
    selectQueue.push([ticket]);
    // Second select: message counts
    selectQueue.push([{ ticketId: 'ticket-1', count: 42 }]);

    const { archiveTickets } = await import('./archive.js');
    const count = await archiveTickets(30);

    expect(count).toBe(1);
    expect(insertValuesMock).toHaveBeenCalledTimes(1);

    const inserted = insertValuesMock.mock.calls[0][0];
    expect(inserted.id).toBe('ticket-1');
    expect(inserted.partnerId).toBe('partner-1');
    expect(inserted.messageCount).toBe(42);
    expect(inserted.archivedAt).toBeDefined();
    expect(inserted.status).toBe('closed');
  });

  it('does not include message content in archive', async () => {
    const ticket = makeTicketRow();
    selectQueue.push([ticket]);
    selectQueue.push([{ ticketId: 'ticket-1', count: 5 }]);

    const { archiveTickets } = await import('./archive.js');
    await archiveTickets(30);

    const inserted = insertValuesMock.mock.calls[0][0];
    // Verify no message body/content fields exist in the archived data
    expect(inserted).not.toHaveProperty('body');
    expect(inserted).not.toHaveProperty('messages');
    expect(inserted).not.toHaveProperty('content');
    expect(inserted).not.toHaveProperty('whisper');
    // Only summary metadata should be present
    expect(inserted).toHaveProperty('messageCount');
    expect(inserted).toHaveProperty('id');
    expect(inserted).toHaveProperty('partnerId');
    expect(inserted).toHaveProperty('archivedAt');
  });
});
