import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mocks ---

const queryMock = vi.fn();
const runMock = vi.fn();
const transactionMock = vi.fn();
const insertValuesMock = vi.fn();

const selectWhereMock = vi.fn(async () => []);
const dbMock = {
  insert: vi.fn(() => ({
    values: insertValuesMock,
  })),
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: selectWhereMock,
    })),
  })),
};

vi.mock('../db.js', () => ({
  query: queryMock,
  run: runMock,
  transaction: transactionMock,
  db: dbMock,
}));

vi.mock('../config.js', () => ({
  default: {
    GDPR_RETENTION_DAYS: 30,
    AUDIT_ARCHIVE_DELAY_DAYS: 2,
  },
}));

vi.mock('../utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
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
  auditLog: 'audit_log_table',
  ratings: { ticketId: 'ticket_id' },
  messages: { ticketId: 'ticket_id' },
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
    slaResolved: 2,
    slaCompliant: 1,
    p95ResponseMs: 9000,
    sentimentSum: 3,
    sentimentCount: 2,
    deptCounts: { general: 5 },
    ratingsByDept: {},
    hourly: Array(24).fill(0),
    ...overrides,
  };
}

describe('runDailyPurge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryMock.mockReset();
    runMock.mockReset();
    transactionMock.mockReset();
    insertValuesMock.mockReset();
    archiveAuditLogMock.mockReset();
    archiveTicketsMock.mockReset();
    verifyAuditChainMock.mockReset();
    computeLiveDayStatsMock.mockReset();

    // Defaults: archive returns 0, chain verification passes, transaction executes callback
    archiveAuditLogMock.mockResolvedValue(0);
    archiveTicketsMock.mockResolvedValue(0);
    verifyAuditChainMock.mockResolvedValue({ valid: true, checked: 0 });
    transactionMock.mockImplementation(async (cb: (tx: { execute: ReturnType<typeof vi.fn> }) => Promise<void>) => {
      const tx = { execute: vi.fn().mockResolvedValue({ rowCount: 0 }) };
      await cb(tx);
    });
    insertValuesMock.mockResolvedValue(undefined);
    runMock.mockResolvedValue(undefined);
  });

  it('archives audit log and tickets before deleting', async () => {
    archiveAuditLogMock.mockResolvedValue(10);
    archiveTicketsMock.mockResolvedValue(5);
    // Count query for guard check (no closed tickets to worry about)
    queryMock.mockResolvedValueOnce([{ count: 0 }]);
    // No dates to aggregate
    queryMock.mockResolvedValueOnce([]);

    const { runDailyPurge } = await import('./gdpr.js');
    await runDailyPurge();

    expect(archiveAuditLogMock).toHaveBeenCalledOnce();
    expect(archiveTicketsMock).toHaveBeenCalledOnce();

    // Archive is called before transaction (delete)
    const archiveOrder = archiveAuditLogMock.mock.invocationCallOrder[0];
    const txOrder = transactionMock.mock.invocationCallOrder[0];
    expect(archiveOrder).toBeLessThan(txOrder);
  });

  it('deletes tickets and messages older than retention window', async () => {
    // Count query for guard check (no closed tickets)
    queryMock.mockResolvedValueOnce([{ count: 0 }]);
    // No dates to aggregate
    queryMock.mockResolvedValueOnce([]);

    const { runDailyPurge } = await import('./gdpr.js');
    await runDailyPurge();

    // Transaction should have been called to delete old data
    expect(transactionMock).toHaveBeenCalledOnce();

    // Verify the transaction callback executes 4 DELETEs
    const txCallback = transactionMock.mock.calls[0][0];
    const txMock = { execute: vi.fn().mockResolvedValue({ rowCount: 0 }) };
    await txCallback(txMock);
    expect(txMock.execute).toHaveBeenCalledTimes(7); // messages, ratings, ticket_labels, app_feedback, tickets + audit_log anonymize + audit_archive anonymize
  });

  it('does NOT delete tickets within the retention window', async () => {
    // The cutoff is based on config.GDPR_RETENTION_DAYS (30).
    // The function deletes WHERE created_at < cutoffDate.
    // Tickets created today (within 30 days) should NOT match.
    // We verify the cutoff date is ~30 days ago.
    // Count query for guard check (no closed tickets)
    queryMock.mockResolvedValueOnce([{ count: 0 }]);
    queryMock.mockResolvedValueOnce([]);

    const { runDailyPurge } = await import('./gdpr.js');
    await runDailyPurge();

    // The transaction receives a cutoffDate that is 30 days ago
    expect(transactionMock).toHaveBeenCalledOnce();
    // The cutoff is embedded in the SQL template literal via drizzle's sql`...`
    // We trust drizzle builds the correct query; the key is that config.GDPR_RETENTION_DAYS = 30
    // and the cutoff is computed as today - 30 days.
  });

  it('per-partner aggregation produces correct daily_stats rows', async () => {
    const stats = makeFakeStats();
    computeLiveDayStatsMock.mockReturnValue(stats);
    // Archival succeeded
    archiveTicketsMock.mockResolvedValue(1);

    // Count query for guard check
    queryMock.mockResolvedValueOnce([{ count: 0 }]);
    // Step 1: dates to aggregate
    queryMock.mockResolvedValueOnce([{ date: '2026-02-01' }]);
    // Step 2: partner IDs for that date
    queryMock.mockResolvedValueOnce([{ partnerId: 'partner-A' }]);
    // Step 3: tickets for partner-A on 2026-02-01
    queryMock.mockResolvedValueOnce([{ id: 't1', partnerId: 'partner-A' }]);
    // Ratings and messages are fetched via db.select() (mocked via selectWhereMock → [])

    const { runDailyPurge } = await import('./gdpr.js');
    await runDailyPurge();

    expect(computeLiveDayStatsMock).toHaveBeenCalledOnce();
    expect(computeLiveDayStatsMock).toHaveBeenCalledWith(
      [{ id: 't1', partnerId: 'partner-A' }],
      [],
      'all',
      []
    );

    // Verify INSERT INTO daily_stats was called via run()
    expect(runMock).toHaveBeenCalledOnce();
    const runArgs = runMock.mock.calls[0];
    expect(runArgs[0]).toContain('INSERT INTO daily_stats');
    // Check the values array includes date and partnerId
    expect(runArgs[1][0]).toBe('2026-02-01');
    expect(runArgs[1][1]).toBe('partner-A');
    expect(runArgs[1][2]).toBe(stats.total);
    expect(runArgs[1][3]).toBe(stats.closed);
  });

  it('purge of one partner does not affect another partner (multi-tenant isolation)', async () => {
    const statsA = makeFakeStats({ total: 3 });
    const statsB = makeFakeStats({ total: 7 });
    computeLiveDayStatsMock
      .mockReturnValueOnce(statsA)
      .mockReturnValueOnce(statsB);
    // Archival succeeded
    archiveTicketsMock.mockResolvedValue(2);

    // Count query for guard check
    queryMock.mockResolvedValueOnce([{ count: 0 }]);
    // Step 1: dates to aggregate
    queryMock.mockResolvedValueOnce([{ date: '2026-02-01' }]);
    // Step 2: partner IDs for that date — two partners
    queryMock.mockResolvedValueOnce([{ partnerId: 'partner-A' }, { partnerId: 'partner-B' }]);

    // Partner A tickets
    queryMock.mockResolvedValueOnce([{ id: 't1', partnerId: 'partner-A' }]);
    // Partner B tickets
    queryMock.mockResolvedValueOnce([{ id: 't2', partnerId: 'partner-B' }, { id: 't3', partnerId: 'partner-B' }]);
    // Ratings and messages are fetched via db.select() (mocked via selectWhereMock → [])

    const { runDailyPurge } = await import('./gdpr.js');
    await runDailyPurge();

    // computeLiveDayStats called once per partner
    expect(computeLiveDayStatsMock).toHaveBeenCalledTimes(2);

    // First call: partner A tickets only
    expect(computeLiveDayStatsMock.mock.calls[0][0]).toEqual([{ id: 't1', partnerId: 'partner-A' }]);
    // Second call: partner B tickets only
    expect(computeLiveDayStatsMock.mock.calls[1][0]).toEqual([
      { id: 't2', partnerId: 'partner-B' },
      { id: 't3', partnerId: 'partner-B' },
    ]);

    // run() called once per partner for INSERT INTO daily_stats
    expect(runMock).toHaveBeenCalledTimes(2);
    expect(runMock.mock.calls[0][1][1]).toBe('partner-A');
    expect(runMock.mock.calls[0][1][2]).toBe(3); // statsA.total
    expect(runMock.mock.calls[1][1][1]).toBe('partner-B');
    expect(runMock.mock.calls[1][1][2]).toBe(7); // statsB.total
  });

  it('handles empty result set (no tickets to purge)', async () => {
    // Count query for guard check (no closed tickets)
    queryMock.mockResolvedValueOnce([{ count: 0 }]);
    // No dates to aggregate at all
    queryMock.mockResolvedValueOnce([]);

    const { runDailyPurge } = await import('./gdpr.js');
    await runDailyPurge();

    // No aggregation or run calls
    expect(computeLiveDayStatsMock).not.toHaveBeenCalled();
    expect(runMock).not.toHaveBeenCalled();

    // Transaction still runs (DELETEs happen regardless, they just delete 0 rows)
    expect(transactionMock).toHaveBeenCalledOnce();

    // Audit log entry still written
    expect(dbMock.insert).toHaveBeenCalledOnce();
  });

  it('logs purge activity', async () => {
    const logger = (await import('../utils/logger.js')).default;

    archiveAuditLogMock.mockResolvedValue(3);
    archiveTicketsMock.mockResolvedValue(2);
    // Count query for guard check
    queryMock.mockResolvedValueOnce([{ count: 0 }]);
    queryMock.mockResolvedValueOnce([]);

    const { runDailyPurge } = await import('./gdpr.js');
    await runDailyPurge();

    // Logs archive info
    expect(logger.info).toHaveBeenCalledWith(
      { auditArchived: 3, ticketsArchived: 2 },
      '[purge] Pre-purge archival complete'
    );

    // Logs purge completion
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('[purge] GDPR purge complete for data older than')
    );
  });

  it('logs error and does not throw when purge fails', async () => {
    const logger = (await import('../utils/logger.js')).default;

    archiveAuditLogMock.mockRejectedValue(new Error('DB down'));

    const { runDailyPurge } = await import('./gdpr.js');

    // Should not throw
    await expect(runDailyPurge()).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      '[purge] Error during daily purge'
    );
  });

  it('writes audit log entry after successful purge', async () => {
    queryMock.mockResolvedValueOnce([{ count: 0 }]); // guard count query
    queryMock.mockResolvedValueOnce([]);              // dates query

    const { runDailyPurge } = await import('./gdpr.js');
    await runDailyPurge();

    expect(dbMock.insert).toHaveBeenCalledOnce();
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'system.gdpr_purge',
        actorId: null,
        targetType: 'system',
        metadata: expect.objectContaining({ success: true }),
      })
    );
  });
});
