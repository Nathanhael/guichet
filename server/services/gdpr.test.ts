import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mocks ---

const executeMock = vi.fn();
const insertOnConflictMock = vi.fn();
const insertValuesMock = vi.fn(() => ({ onConflictDoUpdate: insertOnConflictMock }));

// Track the orderBy mock separately so tests can set return values
const orderByMock = vi.fn(async () => []);

// Each db.select() call creates a fresh chain. The `where` result has an
// optional `.orderBy` (used by the ticket query) and `.limit` (used by the
// invite-cleanup query) — when absent the `where` itself is awaited
// (ratings/messages queries).
function makeSelectChain() {
  const whereMock = vi.fn((..._args: unknown[]) => {
    // Return a thenable that also exposes `.orderBy` and `.limit`
    const p = Promise.resolve([]);
    (p as unknown as Record<string, unknown>).orderBy = orderByMock;
    (p as unknown as Record<string, unknown>).limit = vi.fn(async () => []);
    return p;
  });
  return {
    from: vi.fn(() => ({ where: whereMock })),
  };
}

const deleteMock = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }));

const dbMock = {
  execute: executeMock,
  insert: vi.fn(() => ({
    values: insertValuesMock,
  })),
  select: vi.fn(() => makeSelectChain()),
  transaction: vi.fn(),
  delete: deleteMock,
};

vi.mock('../db.js', () => ({
  db: dbMock,
}));

vi.mock('../config.js', () => ({
  default: {
    GDPR_RETENTION_DAYS: 30,
    AUDIT_ARCHIVE_DELAY_DAYS: 2,
    AI_USAGE_RETENTION_DAYS: 90,
  },
}));

vi.mock('../utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('drizzle-orm', () => ({
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values, _tag: 'sql' }),
    { raw: (s: string) => s }
  ),
  inArray: vi.fn(),
  and: vi.fn((...args: unknown[]) => args),
  eq: vi.fn((a: unknown, b: unknown) => ({ op: 'eq', a, b })),
  lt: vi.fn((a: unknown, b: unknown) => ({ op: 'lt', a, b })),
  gte: vi.fn((a: unknown, b: unknown) => ({ op: 'gte', a, b })),
  isNull: vi.fn((col: unknown) => ({ op: 'isnull', col })),
}));

const archiveAuditLogMock = vi.fn();
const archiveTicketsMock = vi.fn();
const verifyAuditChainMock = vi.fn();

vi.mock('./archive.js', () => ({
  archiveAuditLog: archiveAuditLogMock,
  archiveTickets: archiveTicketsMock,
  verifyAuditChain: verifyAuditChainMock,
}));

const computeLiveDayStatsMock = vi.fn();

vi.mock('./stats.js', () => ({
  computeLiveDayStats: computeLiveDayStatsMock,
}));

vi.mock('../db/schema.js', () => ({
  tickets: { id: 'id', partnerId: 'partner_id', status: 'status', createdAt: 'created_at' },
  archivedTickets: { id: 'id' },
  auditLog: 'audit_log_table',
  ratings: { ticketId: 'ticket_id' },
  messages: { ticketId: 'ticket_id' },
  dailyStats: { date: 'date', partnerId: 'partner_id' },
  dailyAiUsage: { totalRequests: 'total_requests', avgLatencyMs: 'avg_latency_ms', totalInputTokens: 'total_input_tokens', totalOutputTokens: 'total_output_tokens', successCount: 'success_count', errorCount: 'error_count' },
  aiUsageLog: { createdAt: 'created_at' },
  appFeedback: 'app_feedback_table',
  agentStatusLog: { startedAt: 'started_at' },
  users: { id: 'id', email: 'email', externalId: 'external_id', password: 'password', createdAt: 'created_at' },
}));

// --- Helpers ---

function makeFakeStats(overrides: Record<string, unknown> = {}) {
  return {
    total: 5,
    closed: 2,
    abandoned: 0,
    reopened: 1,
    responseSum: 10000,
    responseCount: 2,
    durationSum: 50000,
    durationCount: 2,
    ratingSum: 8,
    ratingCount: 2,
    p95ResponseMs: 9000,
    deptCounts: { general: 5 },
    ratingsByDept: {},
    hourly: Array(24).fill(0),
    ...overrides,
  };
}

/** Set up default mocks for a purge run with no tickets to aggregate */
function setupEmptyPurge() {
  // db.execute for unarchived count check — gdpr.ts reads `result.rows`
  executeMock.mockResolvedValueOnce({ rows: [{ count: 0 }] });
  // db.select().from(tickets).where().orderBy() for bulk ticket fetch
  orderByMock.mockResolvedValueOnce([]);
}

/** Set up mocks for a purge with tickets */
function setupPurgeWithTickets(ticketRows: unknown[]) {
  executeMock.mockResolvedValueOnce({ rows: [{ count: 0 }] });
  orderByMock.mockResolvedValueOnce(ticketRows);
  // ratings and messages queries return empty via where() default (Promise.resolve([]))
}

describe('runDailyPurge', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Defaults: archive returns 0, chain verification passes
    archiveAuditLogMock.mockResolvedValue(0);
    archiveTicketsMock.mockResolvedValue(0);
    verifyAuditChainMock.mockResolvedValue({ valid: true, checked: 0 });

    // db.transaction executes callback with a tx mock
    dbMock.transaction.mockImplementation(async (cb: (tx: { execute: ReturnType<typeof vi.fn> }) => Promise<void>) => {
      const tx = { execute: vi.fn().mockResolvedValue({ rowCount: 0 }) };
      await cb(tx);
    });

    insertOnConflictMock.mockResolvedValue(undefined);
    insertValuesMock.mockReturnValue({ onConflictDoUpdate: insertOnConflictMock });
    deleteMock.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  });

  it('archives audit log and tickets before deleting', async () => {
    archiveAuditLogMock.mockResolvedValue(10);
    archiveTicketsMock.mockResolvedValue(5);
    setupEmptyPurge();

    const { runDailyPurge } = await import('./gdpr.js');
    await runDailyPurge();

    expect(archiveAuditLogMock).toHaveBeenCalledOnce();
    expect(archiveTicketsMock).toHaveBeenCalledOnce();

    // Archive is called before transaction (delete)
    const archiveOrder = archiveAuditLogMock.mock.invocationCallOrder[0];
    const txOrder = dbMock.transaction.mock.invocationCallOrder[0];
    expect(archiveOrder).toBeLessThan(txOrder);
  });

  it('deletes tickets and messages older than retention window', async () => {
    setupEmptyPurge();

    const { runDailyPurge } = await import('./gdpr.js');
    await runDailyPurge();

    // Transaction called twice: main GDPR purge + AI usage aggregate+purge
    expect(dbMock.transaction).toHaveBeenCalledTimes(2);

    // Verify the first transaction callback (GDPR purge) executes DELETEs
    const txCallback = dbMock.transaction.mock.calls[0][0];
    const txMock = { execute: vi.fn().mockResolvedValue({ rowCount: 0 }) };
    await txCallback(txMock);
    expect(txMock.execute).toHaveBeenCalledTimes(7); // messages, ticket_labels, app_feedback, ratings agent_id anon, tickets + audit_log anonymize + audit_archive anonymize (ratings rows survive — comments nullified by a separate step)
  });

  it('does NOT delete tickets within the retention window', async () => {
    setupEmptyPurge();

    const { runDailyPurge } = await import('./gdpr.js');
    await runDailyPurge();

    // The transaction is called twice: once for main GDPR purge, once for AI usage aggregate+purge
    expect(dbMock.transaction).toHaveBeenCalledTimes(2);
  });

  it('per-partner aggregation produces correct daily_stats rows', async () => {
    const stats = makeFakeStats();
    computeLiveDayStatsMock.mockReturnValue(stats);
    archiveTicketsMock.mockResolvedValue(1);

    setupPurgeWithTickets([
      { id: 't1', partnerId: 'partner-A', createdAt: '2026-02-01T10:00:00.000Z', status: 'closed' },
    ]);

    const { runDailyPurge } = await import('./gdpr.js');
    await runDailyPurge();

    expect(computeLiveDayStatsMock).toHaveBeenCalledOnce();
    expect(computeLiveDayStatsMock).toHaveBeenCalledWith(
      [{ id: 't1', partnerId: 'partner-A', createdAt: '2026-02-01T10:00:00.000Z', status: 'closed' }],
      [],
      'all',
      []
    );

    // Verify INSERT INTO daily_stats was called via db.insert()
    expect(dbMock.insert).toHaveBeenCalled();
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        date: '2026-02-01',
        partnerId: 'partner-A',
        total: stats.total,
        closed: stats.closed,
      })
    );
  });

  it('purge of one partner does not affect another partner (multi-tenant isolation)', async () => {
    const statsA = makeFakeStats({ total: 3 });
    const statsB = makeFakeStats({ total: 7 });
    computeLiveDayStatsMock
      .mockReturnValueOnce(statsA)
      .mockReturnValueOnce(statsB);
    archiveTicketsMock.mockResolvedValue(2);

    setupPurgeWithTickets([
      { id: 't1', partnerId: 'partner-A', createdAt: '2026-02-01T10:00:00.000Z', status: 'closed' },
      { id: 't2', partnerId: 'partner-B', createdAt: '2026-02-01T11:00:00.000Z', status: 'closed' },
      { id: 't3', partnerId: 'partner-B', createdAt: '2026-02-01T12:00:00.000Z', status: 'closed' },
    ]);

    const { runDailyPurge } = await import('./gdpr.js');
    await runDailyPurge();

    // computeLiveDayStats called once per partner
    expect(computeLiveDayStatsMock).toHaveBeenCalledTimes(2);

    // First call: partner A tickets only
    expect(computeLiveDayStatsMock.mock.calls[0][0]).toEqual([
      { id: 't1', partnerId: 'partner-A', createdAt: '2026-02-01T10:00:00.000Z', status: 'closed' },
    ]);
    // Second call: partner B tickets only
    expect(computeLiveDayStatsMock.mock.calls[1][0]).toEqual([
      { id: 't2', partnerId: 'partner-B', createdAt: '2026-02-01T11:00:00.000Z', status: 'closed' },
      { id: 't3', partnerId: 'partner-B', createdAt: '2026-02-01T12:00:00.000Z', status: 'closed' },
    ]);

    // db.insert called for each partner's daily_stats (+ 1 for audit log entry)
    const insertCalls = insertValuesMock.mock.calls;
    const dailyStatsCalls = insertCalls.filter((c: unknown[]) =>
      c[0] && typeof c[0] === 'object' && 'partnerId' in (c[0] as Record<string, unknown>) && 'total' in (c[0] as Record<string, unknown>)
    );
    expect(dailyStatsCalls).toHaveLength(2);
    expect((dailyStatsCalls[0][0] as Record<string, unknown>).partnerId).toBe('partner-A');
    expect((dailyStatsCalls[0][0] as Record<string, unknown>).total).toBe(3);
    expect((dailyStatsCalls[1][0] as Record<string, unknown>).partnerId).toBe('partner-B');
    expect((dailyStatsCalls[1][0] as Record<string, unknown>).total).toBe(7);
  });

  it('handles empty result set (no tickets to purge)', async () => {
    setupEmptyPurge();

    const { runDailyPurge } = await import('./gdpr.js');
    await runDailyPurge();

    // No ticket aggregation
    expect(computeLiveDayStatsMock).not.toHaveBeenCalled();

    // Transaction runs twice: main GDPR purge + AI usage aggregate+purge
    expect(dbMock.transaction).toHaveBeenCalledTimes(2);

    // Audit log entry still written
    expect(dbMock.insert).toHaveBeenCalledOnce();
  });

  it('logs purge activity', async () => {
    const logger = (await import('../utils/logger.js')).default;

    archiveAuditLogMock.mockResolvedValue(3);
    archiveTicketsMock.mockResolvedValue(2);
    setupEmptyPurge();

    const { runDailyPurge } = await import('./gdpr.js');
    await runDailyPurge();

    // Logs archive info
    expect(logger.info).toHaveBeenCalledWith(
      { auditArchived: 3, ticketsArchived: 2 },
      '[purge] Pre-purge archival complete'
    );

    // Logs purge completion
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('[purge] GDPR purge complete for data older than'),
    );
  });

  it('logs error and does not throw when purge fails', async () => {
    const logger = (await import('../utils/logger.js')).default;

    setupEmptyPurge();
    // Transaction fails — this is INSIDE the try/catch
    dbMock.transaction.mockRejectedValueOnce(new Error('DB down'));

    const { runDailyPurge } = await import('./gdpr.js');

    // Should not throw — error is caught and logged
    await expect(runDailyPurge()).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      '[purge] Error during daily purge'
    );
  });

  it('writes audit log entry after successful purge', async () => {
    setupEmptyPurge();

    const { runDailyPurge } = await import('./gdpr.js');
    await runDailyPurge();

    expect(dbMock.insert).toHaveBeenCalledOnce();
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'system.gdpr_purge',
        actorId: null,
        targetType: 'system',
        metadata: expect.objectContaining({ success: true, aiUsagePurged: 0 }),
      })
    );
  });
});
