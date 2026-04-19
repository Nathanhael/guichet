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

  const tableMarkers = { tickets: Symbol('tickets'), slaBreaches: Symbol('slaBreaches') };

  function makeTicketsUpdateChain() {
    const chain: Rec = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    chain.set = (patch: Rec) => { ticketsSetCalls.push(patch); return chain as any; };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    chain.where = (clause: unknown) => { ticketsWhereCalls.push(clause); return chain as any; };
    chain.returning = async () => ticketsUpdateReturnQueue.shift() ?? [];
    return chain;
  }

  function makeBreachesUpdateChain() {
    const chain: Rec = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    chain.set = (patch: Rec) => { breachesSetCalls.push(patch); return chain as any; };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  const dbMock = { update: updateMock };

  const resolutionsIncMock = vi.fn();
  const firstResponseObserveMock = vi.fn();

  return {
    ticketsUpdateReturnQueue,
    breachesUpdateReturnQueue,
    ticketsSetCalls,
    breachesSetCalls,
    ticketsWhereCalls,
    breachesWhereCalls,
    tableMarkers,
    dbMock,
    updateMock,
    resolutionsIncMock,
    firstResponseObserveMock,
  };
});

vi.mock('../db.js', () => ({ db: h.dbMock }));

vi.mock('../db/schema.js', () => ({
  tickets: { __marker: h.tableMarkers.tickets, id: 'id', partnerId: 'partner_id', dept: 'dept', createdAt: 'created_at', firstStaffResponseAt: 'first_staff_response_at' },
  slaBreaches: { __marker: h.tableMarkers.slaBreaches, id: 'id', ticketId: 'ticket_id', resolvedAt: 'resolved_at', resolvedReason: 'resolved_reason' },
}));

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ op: 'and', args }),
  eq: (a: unknown, b: unknown) => ({ op: 'eq', a, b }),
  isNull: (a: unknown) => ({ op: 'isNull', a }),
}));

vi.mock('../utils/metrics.js', () => ({
  slaResolutionsTotal: { inc: h.resolutionsIncMock },
  slaFirstResponseMinutes: { observe: h.firstResponseObserveMock },
  // keep other exports harmless in case the service imports more later
  slaBreachesTotal: { inc: vi.fn() },
  slaSweepRunsTotal: { inc: vi.fn() },
  slaSweepDurationSeconds: { observe: vi.fn() },
}));

vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── Imports under test ─────────────────────────────────────────────────────

import { computeSlaState, markFirstStaffResponse, type ComputeSlaInput } from './sla.js';
import type { BusinessHoursSchedule } from './businessHours.js';
import type { DepartmentSlaConfig } from './sla.js';

beforeEach(() => {
  h.ticketsUpdateReturnQueue.length = 0;
  h.breachesUpdateReturnQueue.length = 0;
  h.ticketsSetCalls.length = 0;
  h.breachesSetCalls.length = 0;
  h.ticketsWhereCalls.length = 0;
  h.breachesWhereCalls.length = 0;
  h.resolutionsIncMock.mockClear();
  h.firstResponseObserveMock.mockClear();
  h.updateMock.mockClear();
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
    // first-response histogram observation is always recorded on stamp.
    expect(h.firstResponseObserveMock).toHaveBeenCalledWith(
      { partner_id: PARTNER_ID, department: DEPT },
      20,
    );
  });

  it('ignores whisper messages', async () => {
    const result = await markFirstStaffResponse({ ticketId: TICKET_ID, at: '2026-04-20T10:00:00Z', senderRole: 'support', isWhisper: true });

    expect(result.stamped).toBe(false);
    expect(result.resolvedBreach).toBe(false);
    expect(h.updateMock).not.toHaveBeenCalled();
    expect(h.firstResponseObserveMock).not.toHaveBeenCalled();
    expect(h.resolutionsIncMock).not.toHaveBeenCalled();
  });

  it('ignores agent (non-staff) messages', async () => {
    const result = await markFirstStaffResponse({ ticketId: TICKET_ID, at: '2026-04-20T10:00:00Z', senderRole: 'agent', isWhisper: false });

    expect(result.stamped).toBe(false);
    expect(result.resolvedBreach).toBe(false);
    expect(h.updateMock).not.toHaveBeenCalled();
    expect(h.firstResponseObserveMock).not.toHaveBeenCalled();
    expect(h.resolutionsIncMock).not.toHaveBeenCalled();
  });

  it('returns stamped=false and does not emit metrics when ticket already has first_staff_response_at', async () => {
    // Guarded UPDATE returns zero rows (row's first_staff_response_at is not null).
    h.ticketsUpdateReturnQueue.push([]);

    const result = await markFirstStaffResponse({ ticketId: TICKET_ID, at: '2026-04-20T10:00:00Z', senderRole: 'admin', isWhisper: false });

    expect(result.stamped).toBe(false);
    expect(result.resolvedBreach).toBe(false);
    expect(h.firstResponseObserveMock).not.toHaveBeenCalled();
    expect(h.resolutionsIncMock).not.toHaveBeenCalled();
    // breaches update should NOT be attempted when ticket update stamped nothing.
    expect(h.breachesSetCalls).toHaveLength(0);
  });

  it('resolves existing sla_breach row and increments resolutions counter', async () => {
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
    expect(h.resolutionsIncMock).toHaveBeenCalledWith({ partner_id: PARTNER_ID, department: DEPT });
    expect(h.firstResponseObserveMock).toHaveBeenCalledWith(
      { partner_id: PARTNER_ID, department: DEPT },
      40,
    );
  });

  it('accepts platform_operator as staff role', async () => {
    h.ticketsUpdateReturnQueue.push([{ partnerId: PARTNER_ID, dept: DEPT, createdAt: CREATED_AT }]);
    h.breachesUpdateReturnQueue.push([]);

    const at = '2026-04-20T10:05:00Z';
    const result = await markFirstStaffResponse({ ticketId: TICKET_ID, at, senderRole: 'platform_operator', isWhisper: false });

    expect(result.stamped).toBe(true);
    expect(h.ticketsSetCalls).toHaveLength(1);
    expect(h.ticketsSetCalls[0]).toEqual({ firstStaffResponseAt: at });
    expect(h.firstResponseObserveMock).toHaveBeenCalledWith(
      { partner_id: PARTNER_ID, department: DEPT },
      5,
    );
  });
});
