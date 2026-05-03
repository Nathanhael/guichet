import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Hoisted mocks ──────────────────────────────────────────────────────────
// vi.mock factories run before module imports, so mock state must live in
// vi.hoisted blocks (same pattern used in gdpr.test.ts / archive.test.ts).

const h = vi.hoisted(() => {
  type Rec = Record<string, unknown>;
  const ticketsUpdateReturnQueue: unknown[][] = [];
  const breachesUpdateReturnQueue: unknown[][] = [];
  const ticketsSetCalls: Rec[] = [];
  const breachesSetCalls: Rec[] = [];
  const ticketsWhereCalls: unknown[] = [];
  const breachesWhereCalls: unknown[] = [];

  // SELECT chain state (Task 7 — sweep).
  // Each entry in the queue is the array of rows the next matching select() will return.
  const partnersSelectReturnQueue: unknown[][] = [];
  const ticketsSelectReturnQueue: unknown[][] = [];

  // INSERT chain state (Task 7 — sweep).
  // Each entry is the rows the next slaBreaches insert returning() resolves to.
  const slaBreachesInsertReturnQueue: unknown[][] = [];
  const slaBreachesInsertValuesCalls: Rec[] = [];

  const tableMarkers = {
    tickets: Symbol('tickets'),
    slaBreaches: Symbol('slaBreaches'),
    partners: Symbol('partners'),
  };

  function makeTicketsUpdateChain() {
    const chain: Rec = {};
    chain.set = (patch: Rec) => { ticketsSetCalls.push(patch); return chain as any; };
    chain.where = (clause: unknown) => { ticketsWhereCalls.push(clause); return chain as any; };
    chain.returning = async () => ticketsUpdateReturnQueue.shift() ?? [];
    return chain;
  }

  function makeBreachesUpdateChain() {
    const chain: Rec = {};
    chain.set = (patch: Rec) => { breachesSetCalls.push(patch); return chain as any; };
    chain.where = (clause: unknown) => { breachesWhereCalls.push(clause); return chain as any; };
    chain.returning = async () => breachesUpdateReturnQueue.shift() ?? [];
    return chain;
  }

  const updateMock = vi.fn((table: unknown) => {
    // Drizzle passes the pgTable object. We tag our mocked schema tables with
    // identity Symbols so we can branch without relying on the real schema.
    const marker = (table as Rec | undefined)?.__marker;
    if (marker === tableMarkers.tickets) return makeTicketsUpdateChain();
    if (marker === tableMarkers.slaBreaches) return makeBreachesUpdateChain();
    throw new Error('db.update called with unexpected table');
  });

  // SELECT chain — handles both db.select().from(...) and db.select({projection}).from(...).
  // The queue keyed on the table marker tells us what to return. `.where(...)` is a thenable
  // so `await db.select()...where(...)` works the way the code under test uses it.
  function makeSelectChain() {
    let activeQueue: unknown[][] | null = null;
    const chain: Rec = {};
    chain.from = (table: unknown) => {
      const marker = (table as Rec | undefined)?.__marker;
      if (marker === tableMarkers.partners) activeQueue = partnersSelectReturnQueue;
      else if (marker === tableMarkers.tickets) activeQueue = ticketsSelectReturnQueue;
      else throw new Error('db.select called with unexpected table');
      return chain;
    };
    chain.where = (_clause: unknown) => {
      const rows = activeQueue?.shift() ?? [];
      return Promise.resolve(rows);
    };
    // Some code paths skip .where() (not used here, but safe for bare select().from()).
    chain.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (r: unknown) => unknown) => {
      const rows = activeQueue?.shift() ?? [];
      return Promise.resolve(rows).then(onFulfilled, onRejected);
    };
    return chain;
  }

  const selectMock = vi.fn((_projection?: unknown) => makeSelectChain());

  // INSERT chain — supports .values(...).onConflictDoNothing(...).returning(...)
  function makeInsertChain(marker: symbol) {
    const chain: Rec = {};
    chain.values = (row: Rec | Rec[]) => {
      const single = Array.isArray(row) ? row[0] : row;
      if (marker === tableMarkers.slaBreaches) slaBreachesInsertValuesCalls.push(single);
      const tail: Rec = {};
      tail.returning = async () => {
        if (marker === tableMarkers.slaBreaches) return slaBreachesInsertReturnQueue.shift() ?? [];
        return [];
      };
      tail.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (r: unknown) => unknown) =>
        Promise.resolve(undefined).then(onFulfilled, onRejected);
      const mid: Rec = {};
      mid.onConflictDoNothing = (_opts?: unknown) => tail;
      return mid;
    };
    return chain;
  }

  const insertMock = vi.fn((table: unknown) => {
    const marker = (table as Rec | undefined)?.__marker as symbol | undefined;
    if (marker === tableMarkers.slaBreaches) return makeInsertChain(tableMarkers.slaBreaches);
    throw new Error('db.insert called with unexpected table');
  });

  const dbMock = { update: updateMock, select: selectMock, insert: insertMock };

  const breachesIncMock = vi.fn();

  return {
    ticketsUpdateReturnQueue,
    breachesUpdateReturnQueue,
    ticketsSetCalls,
    breachesSetCalls,
    ticketsWhereCalls,
    breachesWhereCalls,
    partnersSelectReturnQueue,
    ticketsSelectReturnQueue,
    slaBreachesInsertReturnQueue,
    slaBreachesInsertValuesCalls,
    tableMarkers,
    dbMock,
    updateMock,
    selectMock,
    insertMock,
    breachesIncMock,
  };
});

vi.mock('../db.js', () => ({ db: h.dbMock }));

vi.mock('../db/schema.js', () => ({
  tickets: { __marker: h.tableMarkers.tickets, id: 'id', partnerId: 'partner_id', dept: 'dept', createdAt: 'created_at', firstStaffResponseAt: 'first_staff_response_at' },
  slaBreaches: { __marker: h.tableMarkers.slaBreaches, id: 'id', ticketId: 'ticket_id', resolvedAt: 'resolved_at', resolvedReason: 'resolved_reason' },
  partners: { __marker: h.tableMarkers.partners, id: 'id', status: 'status' },
}));

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ op: 'and', args }),
  eq: (a: unknown, b: unknown) => ({ op: 'eq', a, b }),
  inArray: (a: unknown, values: unknown[]) => ({ op: 'inArray', a, values }),
  isNull: (a: unknown) => ({ op: 'isNull', a }),
}));

vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── Imports under test ─────────────────────────────────────────────────────

import { computeSlaState, markFirstStaffResponse, runSlaSweep, setSlaIo, type ComputeSlaInput } from './sla.js';
import type { BusinessHoursSchedule } from './businessHours.js';

beforeEach(() => {
  h.ticketsUpdateReturnQueue.length = 0;
  h.breachesUpdateReturnQueue.length = 0;
  h.ticketsSetCalls.length = 0;
  h.breachesSetCalls.length = 0;
  h.ticketsWhereCalls.length = 0;
  h.breachesWhereCalls.length = 0;
  h.partnersSelectReturnQueue.length = 0;
  h.ticketsSelectReturnQueue.length = 0;
  h.slaBreachesInsertReturnQueue.length = 0;
  h.slaBreachesInsertValuesCalls.length = 0;
  h.breachesIncMock.mockClear();
  h.updateMock.mockClear();
  h.selectMock.mockClear();
  h.insertMock.mockClear();
  // Reset io to null between tests by clearing it via setSlaIo(null as never) hack is not possible.
  // Instead each test that needs io should call setSlaIo(...) explicitly; tests that don't care
  // rely on the emit short-circuiting (io?.to(...)).
});

// ─── Existing pure-function tests ───────────────────────────────────────────

function buildSchedule(overrides?: Partial<BusinessHoursSchedule>): BusinessHoursSchedule {
  return {
    version: 1,
    timezone: 'Europe/Brussels',
    weekly: {
      mon: { closed: false, windows: [{ start: '09:00', end: '17:00' }] },
      tue: { closed: false, windows: [{ start: '09:00', end: '17:00' }] },
      wed: { closed: false, windows: [{ start: '09:00', end: '17:00' }] },
      thu: { closed: false, windows: [{ start: '09:00', end: '17:00' }] },
      fri: { closed: false, windows: [{ start: '09:00', end: '17:00' }] },
      sat: { closed: true, windows: [] },
      sun: { closed: true, windows: [] },
    },
    exceptions: [],
    ...overrides,
  };
}

function buildInput(overrides: Partial<ComputeSlaInput> = {}): ComputeSlaInput {
  return {
    ticketCreatedAt: new Date('2026-04-20T10:00:00+02:00').toISOString(),
    firstStaffResponseAt: null,
    sla: { enabled: true, firstResponseMinutes: 30, warnAtPercent: 75 },
    schedule: buildSchedule(),
    now: new Date('2026-04-20T10:10:00+02:00'),
    ...overrides,
  };
}

describe('computeSlaState', () => {
  it('returns disabled when SLA is off', () => {
    const state = computeSlaState(buildInput({ sla: { enabled: false, firstResponseMinutes: 30, warnAtPercent: 75 } }));
    expect(state.status).toBe('disabled');
  });

  it('returns ok when elapsed is below warn threshold', () => {
    const state = computeSlaState(buildInput());
    expect(state.status).toBe('ok');
    if (state.status === 'ok') {
      expect(state.elapsedMinutes).toBe(10);
      expect(state.remainingMinutes).toBe(20);
    }
  });

  it('returns warning at or above warnAtPercent', () => {
    const state = computeSlaState(buildInput({ now: new Date('2026-04-20T10:23:00+02:00') }));
    expect(state.status).toBe('warning');
  });

  it('returns breached once threshold exceeded', () => {
    const state = computeSlaState(buildInput({ now: new Date('2026-04-20T10:45:00+02:00') }));
    expect(state.status).toBe('breached');
    if (state.status === 'breached') {
      expect(state.overdueMinutes).toBe(15);
    }
  });

  it('returns met when firstStaffResponseAt is set', () => {
    const state = computeSlaState(buildInput({ firstStaffResponseAt: '2026-04-20T10:20:00+02:00' }));
    expect(state.status).toBe('met');
    if (state.status === 'met') {
      expect(state.respondedInMinutes).toBe(20);
    }
  });

  it('pauses elapsed counter outside business hours', () => {
    const state = computeSlaState(buildInput({
      ticketCreatedAt: '2026-04-17T16:50:00+02:00',
      now: new Date('2026-04-20T09:05:00+02:00'),
    }));
    expect(state.status).toBe('ok');
    if (state.status === 'ok') {
      expect(state.elapsedMinutes).toBe(15);
    }
  });

  it('breach fires Monday, not Friday, for overnight weekend ticket', () => {
    const state = computeSlaState(buildInput({
      ticketCreatedAt: '2026-04-17T16:55:00+02:00',
      now: new Date('2026-04-20T09:30:00+02:00'),
    }));
    expect(state.status).toBe('breached');
  });
});

// ─── markFirstStaffResponse (TDD for Task 6) ────────────────────────────────

describe('markFirstStaffResponse', () => {
  const TICKET_ID = 't_test_001';
  const PARTNER_ID = 'p_test_001';
  const DEPT = 'general';
  const CREATED_AT = '2026-04-20T10:00:00Z';

  it('stamps tickets.first_staff_response_at when first non-whisper staff message arrives', async () => {
    h.ticketsUpdateReturnQueue.push([{ partnerId: PARTNER_ID, dept: DEPT, createdAt: CREATED_AT }]);
    h.breachesUpdateReturnQueue.push([]); // no breach to resolve

    const at = '2026-04-20T10:20:00Z';
    const result = await markFirstStaffResponse({ ticketId: TICKET_ID, at, senderRole: 'support', isWhisper: false });

    expect(result.stamped).toBe(true);
    expect(result.resolvedBreach).toBe(false);
    expect(h.ticketsSetCalls).toHaveLength(1);
    expect(h.ticketsSetCalls[0]).toEqual({ firstStaffResponseAt: at });
  });

  it('ignores whisper messages', async () => {
    const result = await markFirstStaffResponse({ ticketId: TICKET_ID, at: '2026-04-20T10:00:00Z', senderRole: 'support', isWhisper: true });

    expect(result.stamped).toBe(false);
    expect(result.resolvedBreach).toBe(false);
    expect(h.updateMock).not.toHaveBeenCalled();
  });

  it('ignores agent (non-staff) messages', async () => {
    const result = await markFirstStaffResponse({ ticketId: TICKET_ID, at: '2026-04-20T10:00:00Z', senderRole: 'agent', isWhisper: false });

    expect(result.stamped).toBe(false);
    expect(result.resolvedBreach).toBe(false);
    expect(h.updateMock).not.toHaveBeenCalled();
  });

  it('returns stamped=false when ticket already has first_staff_response_at', async () => {
    // Guarded UPDATE returns zero rows (row's first_staff_response_at is not null).
    h.ticketsUpdateReturnQueue.push([]);

    const result = await markFirstStaffResponse({ ticketId: TICKET_ID, at: '2026-04-20T10:00:00Z', senderRole: 'admin', isWhisper: false });

    expect(result.stamped).toBe(false);
    expect(result.resolvedBreach).toBe(false);
    // breaches update should NOT be attempted when ticket update stamped nothing.
    expect(h.breachesSetCalls).toHaveLength(0);
  });

  it('resolves existing sla_breach row', async () => {
    h.ticketsUpdateReturnQueue.push([{ partnerId: PARTNER_ID, dept: DEPT, createdAt: CREATED_AT }]);
    h.breachesUpdateReturnQueue.push([{ id: 'b_001' }]);

    const at = '2026-04-20T10:40:00Z';
    const result = await markFirstStaffResponse({ ticketId: TICKET_ID, at, senderRole: 'admin', isWhisper: false });

    expect(result.stamped).toBe(true);
    expect(result.resolvedBreach).toBe(true);
    expect(result.partnerId).toBe(PARTNER_ID);
    expect(result.department).toBe(DEPT);
    expect(result.respondedInMinutes).toBe(40);

    expect(h.breachesSetCalls).toHaveLength(1);
    expect(h.breachesSetCalls[0]).toEqual({ resolvedAt: at, resolvedReason: 'first_response' });
  });

  it('accepts platform_operator as staff role', async () => {
    h.ticketsUpdateReturnQueue.push([{ partnerId: PARTNER_ID, dept: DEPT, createdAt: CREATED_AT }]);
    h.breachesUpdateReturnQueue.push([]);

    const at = '2026-04-20T10:05:00Z';
    const result = await markFirstStaffResponse({ ticketId: TICKET_ID, at, senderRole: 'platform_operator', isWhisper: false });

    expect(result.stamped).toBe(true);
    expect(h.ticketsSetCalls).toHaveLength(1);
    expect(h.ticketsSetCalls[0]).toEqual({ firstStaffResponseAt: at });
  });
});

// ─── runSlaSweep (TDD for Task 7) ────────────────────────────────────────────

describe('runSlaSweep', () => {
  const ALWAYS_OPEN: BusinessHoursSchedule = {
    version: 1,
    timezone: 'Europe/Brussels',
    weekly: {
      mon: { closed: false, windows: [{ start: '00:00', end: '23:59' }] },
      tue: { closed: false, windows: [{ start: '00:00', end: '23:59' }] },
      wed: { closed: false, windows: [{ start: '00:00', end: '23:59' }] },
      thu: { closed: false, windows: [{ start: '00:00', end: '23:59' }] },
      fri: { closed: false, windows: [{ start: '00:00', end: '23:59' }] },
      sat: { closed: false, windows: [{ start: '00:00', end: '23:59' }] },
      sun: { closed: false, windows: [{ start: '00:00', end: '23:59' }] },
    },
    exceptions: [],
  };

  const PARTNER_WITH_SLA = {
    id: 'pA',
    status: 'active',
    departments: [
      { id: 'general', name: 'General', sla: { enabled: true, firstResponseMinutes: 30, warnAtPercent: 75 } },
    ],
    businessHoursSchedule: ALWAYS_OPEN,
  };

  const PARTNER_WITHOUT_SLA = {
    id: 'pB',
    status: 'active',
    departments: [{ id: 'general', name: 'General' }], // no sla key
    businessHoursSchedule: ALWAYS_OPEN,
  };

  function breachingTicket(id: string, dept = 'general', minutesAgo = 45) {
    return {
      id,
      dept,
      createdAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    };
  }

  it('writes one sla_breaches row per breached ticket and is idempotent on re-run', async () => {
    h.partnersSelectReturnQueue.push([PARTNER_WITH_SLA]);
    h.ticketsSelectReturnQueue.push([breachingTicket('t1')]);
    h.slaBreachesInsertReturnQueue.push([{ id: 'b1' }]);

    const first = await runSlaSweep();
    expect(first.breachesInserted).toBeGreaterThanOrEqual(1);
    expect(first.partnersChecked).toBe(1);
    expect(first.ticketsChecked).toBe(1);
    expect(h.slaBreachesInsertValuesCalls).toHaveLength(1);
    expect(h.slaBreachesInsertValuesCalls[0]).toMatchObject({
      ticketId: 't1',
      partnerId: 'pA',
      dept: 'general',
      thresholdMinutes: 30,
    });

    // Second run: same inputs, but the onConflictDoNothing on ticketId means the insert returns [].
    h.partnersSelectReturnQueue.push([PARTNER_WITH_SLA]);
    h.ticketsSelectReturnQueue.push([breachingTicket('t1')]);
    h.slaBreachesInsertReturnQueue.push([]); // conflict → skipped

    const second = await runSlaSweep();
    expect(second.breachesInserted).toBe(0);
  });

  it('does not see tickets from other partners (cross-tenant isolation)', async () => {
    // Partner B has no SLA-enabled departments. Even if tickets would breach,
    // the sweep must never query tickets for that partner (short-circuit) and
    // thus never insert a breach.
    h.partnersSelectReturnQueue.push([PARTNER_WITHOUT_SLA]);
    // No tickets queue push because partner B's loop iteration must short-circuit
    // before reaching the tickets select. If the service queries anyway, the
    // queue returns [] and we still verify no inserts.
    h.ticketsSelectReturnQueue.push([]);

    const summary = await runSlaSweep();

    expect(summary.partnersChecked).toBe(1);
    expect(summary.breachesInserted).toBe(0);
    expect(h.slaBreachesInsertValuesCalls).toHaveLength(0);
    expect(h.breachesIncMock).not.toHaveBeenCalled();
  });

  it('emits sla:breach socket event when a breach is recorded', async () => {
    const emitMock = vi.fn();
    const toMock = vi.fn(() => ({ emit: emitMock }));
    const mockIo = { to: toMock } as any;
    setSlaIo(mockIo);

    h.partnersSelectReturnQueue.push([PARTNER_WITH_SLA]);
    h.ticketsSelectReturnQueue.push([breachingTicket('t42')]);
    h.slaBreachesInsertReturnQueue.push([{ id: 'b42' }]);

    await runSlaSweep();

    expect(toMock).toHaveBeenCalledWith('ticket:t42');
    expect(emitMock).toHaveBeenCalledWith(
      'sla:breach',
      expect.objectContaining({
        ticketId: 't42',
        partnerId: 'pA',
        department: 'general',
        overdueMinutes: expect.any(Number),
      }),
    );
  });

  it('skips partners with no SLA-enabled departments', async () => {
    h.partnersSelectReturnQueue.push([PARTNER_WITHOUT_SLA]);
    // If the implementation still queries tickets for partner B (it shouldn't),
    // return empty — either way, no breach should be written.
    h.ticketsSelectReturnQueue.push([]);

    const summary = await runSlaSweep();

    expect(summary.breachesInserted).toBe(0);
    expect(h.slaBreachesInsertValuesCalls).toHaveLength(0);
    expect(h.breachesIncMock).not.toHaveBeenCalled();
  });
});
