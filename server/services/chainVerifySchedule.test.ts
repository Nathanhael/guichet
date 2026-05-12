/**
 * Behavioural tests for services/chainVerifySchedule.ts.
 *
 * The shared runner owns persistence, so both the operator-triggered mutation
 * and the daily scheduler must land identical records in system_settings.
 * These tests lock that contract — if the record shape ever drifts, the
 * Platform System Health tile and verify-history panel would start rendering
 * mismatched data depending on which actor triggered the last run.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  dbSelectMock,
  dbInsertMock,
  valuesMock,
  onConflictDoUpdateMock,
  selectLimitMock,
  verifyAuditChainMock,
} = vi.hoisted(() => {
  const onConflictDoUpdateMock = vi.fn().mockResolvedValue(undefined);
  const valuesMock = vi.fn().mockReturnValue({ onConflictDoUpdate: onConflictDoUpdateMock });
  const dbInsertMock = vi.fn().mockReturnValue({ values: valuesMock });

  const selectLimitMock = vi.fn().mockResolvedValue([]);
  const whereMock = vi.fn().mockReturnValue({ limit: selectLimitMock });
  const fromMock = vi.fn().mockReturnValue({ where: whereMock });
  const dbSelectMock = vi.fn().mockReturnValue({ from: fromMock });

  return {
    dbSelectMock,
    dbInsertMock,
    valuesMock,
    onConflictDoUpdateMock,
    selectLimitMock,
    verifyAuditChainMock: vi.fn(),
  };
});

vi.mock('../db.js', () => ({
  db: { select: dbSelectMock, insert: dbInsertMock },
}));

vi.mock('../db/schema.js', () => ({
  auditLog: { id: { name: 'id' } },
  systemSettings: { key: { name: 'key' }, value: { name: 'value' }, updatedAt: { name: 'updatedAt' } },
}));

vi.mock('drizzle-orm', async () => {
  const actual = await vi.importActual<typeof import('drizzle-orm')>('drizzle-orm');
  return {
    ...actual,
    eq: vi.fn((col: unknown, val: unknown) => ({ __op: 'eq', col, val })),
  };
});

vi.mock('../utils/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('./archive.js', () => ({
  verifyAuditChain: verifyAuditChainMock,
}));

import {
  runChainVerify,
  scheduleDailyChainVerify,
  LAST_VERIFY_KEY,
  VERIFY_HISTORY_KEY,
  SCHEDULER_ACTOR_ID,
  SCHEDULER_ACTOR_NAME,
} from './chainVerifySchedule.js';

describe('runChainVerify — persistence + return shape', () => {
  beforeEach(() => {
    verifyAuditChainMock.mockReset();
    valuesMock.mockClear();
    onConflictDoUpdateMock.mockClear();
    selectLimitMock.mockReset();
    selectLimitMock.mockResolvedValue([]);
  });

  it('happy path: upserts LAST_VERIFY_KEY and prepends to VERIFY_HISTORY_KEY', async () => {
    verifyAuditChainMock.mockResolvedValueOnce({ valid: true, checked: 42 });

    const record = await runChainVerify({ id: 'op-1', name: 'Operator One' });

    expect(record.valid).toBe(true);
    expect(record.checked).toBe(42);
    expect(record.ranBy).toBe('op-1');
    expect(record.ranByName).toBe('Operator One');
    expect(record.brokenAt).toBeNull();
    expect(record.error).toBeNull();
    // ISO timestamp, not a Date object — clients on the verify-history panel
    // consume it as a plain string so they can format without reparsing.
    expect(typeof record.ranAt).toBe('string');
    expect(() => new Date(record.ranAt).toISOString()).not.toThrow();

    // Two writes: latest + history. No audit_log / webhook on the happy path.
    expect(valuesMock).toHaveBeenCalledTimes(2);
    const latest = valuesMock.mock.calls[0][0] as { key: string; value: unknown };
    const history = valuesMock.mock.calls[1][0] as { key: string; value: unknown[] };
    expect(latest.key).toBe(LAST_VERIFY_KEY);
    expect(history.key).toBe(VERIFY_HISTORY_KEY);
    expect(Array.isArray(history.value)).toBe(true);
    expect(history.value).toHaveLength(1);

    // No audit rows on success
    expect(dbInsertMock).toHaveBeenCalledTimes(2);
  });

  it('broken chain: writes audit_log system.chain_broken_detected with critical severity', async () => {
    verifyAuditChainMock.mockResolvedValueOnce({ valid: false, checked: 7, brokenAt: 'row-xyz' });

    const record = await runChainVerify({ id: 'op-2', name: 'Op Two' });

    expect(record.valid).toBe(false);
    expect(record.brokenAt).toBe('row-xyz');

    // 3 writes: last, history, audit_log
    expect(valuesMock).toHaveBeenCalledTimes(3);
    const auditRow = valuesMock.mock.calls.find(
      (c) => (c[0] as { action?: string }).action === 'system.chain_broken_detected',
    );
    expect(auditRow).toBeDefined();
    const audit = auditRow![0] as {
      action: string;
      actorId: string;
      targetType: string;
      targetId: string;
      metadata: { severity: string; scheduled: boolean; brokenAt: string };
    };
    expect(audit.actorId).toBe('op-2');
    expect(audit.targetType).toBe('system');
    expect(audit.targetId).toBe('row-xyz');
    expect(audit.metadata.severity).toBe('critical');
    expect(audit.metadata.scheduled).toBe(false);
  });

  it('service error: severity=warn, audit row=system.chain_verify_error', async () => {
    verifyAuditChainMock.mockResolvedValueOnce({
      valid: false,
      checked: 0,
      error: 'archive read timeout',
    });

    const record = await runChainVerify({ id: 'op-3', name: null });

    expect(record.error).toBe('archive read timeout');

    const auditRow = valuesMock.mock.calls.find(
      (c) => (c[0] as { action?: string }).action === 'system.chain_verify_error',
    );
    expect(auditRow).toBeDefined();
    const audit = auditRow![0] as { metadata: { severity: string } };
    expect(audit.metadata.severity).toBe('warn');
  });

  it('scheduler-identity: actor=SCHEDULER_ACTOR_ID stamps metadata.scheduled=true', async () => {
    verifyAuditChainMock.mockResolvedValueOnce({ valid: false, checked: 1, brokenAt: 'r' });

    await runChainVerify({ id: SCHEDULER_ACTOR_ID, name: SCHEDULER_ACTOR_NAME });

    const auditRow = valuesMock.mock.calls.find(
      (c) => (c[0] as { action?: string }).action === 'system.chain_broken_detected',
    );
    const audit = auditRow![0] as { metadata: { scheduled: boolean } };
    // The `scheduled` flag lets operators filter audit rows by run origin
    // without having to remember the synthetic actor id.
    expect(audit.metadata.scheduled).toBe(true);
  });

  it('history is capped — returns existing entries plus the new one at the head', async () => {
    verifyAuditChainMock.mockResolvedValueOnce({ valid: true, checked: 3 });
    // Simulate existing history with 50 entries (the cap) in system_settings.
    const existing = Array.from({ length: 50 }, (_, i) => ({ ranAt: `old-${i}` }));
    selectLimitMock.mockResolvedValueOnce([{ value: existing }]);

    await runChainVerify({ id: 'op', name: null });

    const historyCall = valuesMock.mock.calls.find(
      (c) => (c[0] as { key?: string }).key === VERIFY_HISTORY_KEY,
    );
    const history = (historyCall![0] as { value: unknown[] }).value;
    // New record at head; total still 50 (oldest dropped).
    expect(history).toHaveLength(50);
    const firstEntry = history[0] as { ranBy: string };
    expect(firstEntry.ranBy).toBe('op');
    // Oldest existing entry dropped off — last item is what was previously
    // at index 48 (49 was the tail and fell off).
    const lastEntry = history[history.length - 1] as { ranAt: string };
    expect(lastEntry.ranAt).toBe('old-48');
  });

  it('malformed existing history (not an array) is treated as empty', async () => {
    verifyAuditChainMock.mockResolvedValueOnce({ valid: true, checked: 0 });
    // An earlier bug wrote a plain object — the runner must not crash.
    selectLimitMock.mockResolvedValueOnce([{ value: { broken: 'shape' } }]);

    await runChainVerify({ id: 'op', name: null });

    const historyCall = valuesMock.mock.calls.find(
      (c) => (c[0] as { key?: string }).key === VERIFY_HISTORY_KEY,
    );
    const history = (historyCall![0] as { value: unknown[] }).value;
    expect(history).toHaveLength(1);
  });
});

describe('scheduleDailyChainVerify — arming + cancellation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    verifyAuditChainMock.mockReset();
    valuesMock.mockClear();
    selectLimitMock.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a cancel fn that stops the timer before the first tick fires', async () => {
    verifyAuditChainMock.mockResolvedValue({ valid: true, checked: 1 });
    const stop = scheduleDailyChainVerify();

    // Startup delay is 10–40 min. Cancel immediately — no tick should run.
    stop();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000); // 1h

    expect(verifyAuditChainMock).not.toHaveBeenCalled();
  });

  it('first tick runs with the synthetic scheduler actor identity', async () => {
    verifyAuditChainMock.mockResolvedValueOnce({ valid: true, checked: 5 });
    const stop = scheduleDailyChainVerify();

    // Max startup delay is 40 min — advance past it.
    await vi.advanceTimersByTimeAsync(41 * 60 * 1000);

    expect(verifyAuditChainMock).toHaveBeenCalledTimes(1);
    const latest = valuesMock.mock.calls.find(
      (c) => (c[0] as { key?: string }).key === LAST_VERIFY_KEY,
    );
    const value = (latest![0] as { value: { ranBy: string; ranByName: string | null } }).value;
    expect(value.ranBy).toBe(SCHEDULER_ACTOR_ID);
    expect(value.ranByName).toBe(SCHEDULER_ACTOR_NAME);

    stop();
  });
});

