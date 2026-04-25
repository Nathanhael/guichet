/**
 * Behavioural tests for services/ticketAudit.ts.
 *
 * Two invariants this suite guards:
 *  1. The Prometheus counter (`guichet_ticket_audit_events_total`) ticks BEFORE
 *     the DB write — so Grafana always reflects user-observable lifecycle
 *     reality, even if the audit_log insert is slow or fails.
 *  2. Audit writes are fire-and-forget: a DB failure must NEVER surface to the
 *     caller, because ticketAudit is invoked from the happy path of ticket
 *     create/close/transfer and a broken audit writer can't be allowed to
 *     block the user-facing action.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { dbInsertMock, valuesMock, incMock, loggerErrorMock } = vi.hoisted(() => {
  const valuesMock = vi.fn();
  const dbInsertMock = vi.fn().mockReturnValue({ values: valuesMock });
  const incMock = vi.fn();
  const loggerErrorMock = vi.fn();
  return { dbInsertMock, valuesMock, incMock, loggerErrorMock };
});

vi.mock('../db.js', () => ({
  db: { insert: dbInsertMock },
}));

vi.mock('../db/schema.js', () => ({
  auditLog: { id: { name: 'id' }, action: { name: 'action' } },
}));

vi.mock('../utils/logger.js', () => ({
  default: { error: loggerErrorMock, info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../utils/metrics.js', () => ({
  ticketAuditEventsTotal: { inc: incMock },
}));

import {
  auditTicketCreated,
  auditTicketClosed,
  auditTicketAssigned,
  auditTicketTransferred,
  auditTicketReturnedToQueue,
} from './ticketAudit.js';

const BASE = { ticketId: 't-1', partnerId: 'p-1', actorId: 'u-1' };

async function flush() {
  // All emitters schedule the DB write via `void writeTicketAudit(...)` so we
  // need to drain microtasks before asserting on dbInsertMock.
  await new Promise((r) => setImmediate(r));
}

describe('ticketAudit — Prometheus counter is incremented before DB write', () => {
  beforeEach(() => {
    incMock.mockClear();
    valuesMock.mockReset();
    valuesMock.mockResolvedValue(undefined);
    dbInsertMock.mockClear();
    loggerErrorMock.mockClear();
  });

  it('ticket.created — increments counter with action label and inserts row', async () => {
    auditTicketCreated({ ...BASE, dept: 'billing', reopened: false, reopenCount: 0 });
    await flush();
    expect(incMock).toHaveBeenCalledWith({ action: 'ticket.created' });
    expect(dbInsertMock).toHaveBeenCalledTimes(1);
    const inserted = valuesMock.mock.calls[0][0] as {
      action: string; targetType: string; targetId: string; metadata: { dept: string };
    };
    expect(inserted.action).toBe('ticket.created');
    expect(inserted.targetType).toBe('ticket');
    expect(inserted.targetId).toBe('t-1');
    expect(inserted.metadata.dept).toBe('billing');
  });

  it('ticket.reopened — reopened=true flips the action label', async () => {
    auditTicketCreated({ ...BASE, dept: 'support', reopened: true, reopenCount: 2 });
    await flush();
    expect(incMock).toHaveBeenCalledWith({ action: 'ticket.reopened' });
    const inserted = valuesMock.mock.calls[0][0] as { action: string; metadata: { reopenCount: number } };
    expect(inserted.action).toBe('ticket.reopened');
    expect(inserted.metadata.reopenCount).toBe(2);
  });

  it('ticket.closed — counter + row both stamped', async () => {
    auditTicketClosed({ ...BASE, closedBy: 'support', hadSupport: true });
    await flush();
    expect(incMock).toHaveBeenCalledWith({ action: 'ticket.closed' });
    const inserted = valuesMock.mock.calls[0][0] as { action: string; metadata: { closedBy: string; hadSupport: boolean } };
    expect(inserted.action).toBe('ticket.closed');
    expect(inserted.metadata.closedBy).toBe('support');
    expect(inserted.metadata.hadSupport).toBe(true);
  });

  it('ticket.assigned — stores supportId/supportName in metadata', async () => {
    auditTicketAssigned({ ...BASE, supportId: 's-9', supportName: 'Sam' });
    await flush();
    expect(incMock).toHaveBeenCalledWith({ action: 'ticket.assigned' });
    const md = (valuesMock.mock.calls[0][0] as { metadata: Record<string, unknown> }).metadata;
    expect(md.supportId).toBe('s-9');
    expect(md.supportName).toBe('Sam');
  });

  it('ticket.transferred — records target dept + hasNote flag (not the note itself)', async () => {
    auditTicketTransferred({
      ...BASE,
      toDepartmentId: 'd-2',
      toDepartmentName: 'Billing',
      fromSupportId: 's-1',
      note: 'Please take over',
    });
    await flush();
    expect(incMock).toHaveBeenCalledWith({ action: 'ticket.transferred' });
    const md = (valuesMock.mock.calls[0][0] as { metadata: Record<string, unknown> }).metadata;
    expect(md.toDepartmentId).toBe('d-2');
    expect(md.toDepartmentName).toBe('Billing');
    expect(md.fromSupportId).toBe('s-1');
    // hasNote is a bool, not the raw string — avoids leaking handoff context
    // into a row that may be queryable by analytics without the content scope.
    expect(md.hasNote).toBe(true);
    expect(md).not.toHaveProperty('note');
  });

  it('ticket.transferred — hasNote=false when note is omitted', async () => {
    auditTicketTransferred({
      ...BASE,
      toDepartmentId: 'd-2',
      toDepartmentName: 'Billing',
      fromSupportId: null,
    });
    await flush();
    const md = (valuesMock.mock.calls[0][0] as { metadata: Record<string, unknown> }).metadata;
    expect(md.hasNote).toBe(false);
  });

  it('ticket.returned_to_queue — records origin support', async () => {
    auditTicketReturnedToQueue({ ...BASE, fromSupportId: 's-3' });
    await flush();
    expect(incMock).toHaveBeenCalledWith({ action: 'ticket.returned_to_queue' });
    const md = (valuesMock.mock.calls[0][0] as { metadata: Record<string, unknown> }).metadata;
    expect(md.fromSupportId).toBe('s-3');
  });
});

describe('ticketAudit — metric ticks even when DB write fails', () => {
  beforeEach(() => {
    incMock.mockClear();
    valuesMock.mockReset();
    dbInsertMock.mockClear();
    loggerErrorMock.mockClear();
  });

  it('DB rejection is logged but never surfaces to the caller', async () => {
    valuesMock.mockRejectedValueOnce(new Error('pg down'));

    // Caller treats emitter as void — must not throw.
    expect(() =>
      auditTicketClosed({ ...BASE, closedBy: 'support', hadSupport: false }),
    ).not.toThrow();
    await flush();

    // Metric already incremented — Grafana sees the lifecycle event even
    // though the audit row never landed.
    expect(incMock).toHaveBeenCalledWith({ action: 'ticket.closed' });
    expect(loggerErrorMock).toHaveBeenCalledTimes(1);
    const [payload, msg] = loggerErrorMock.mock.calls[0] as [
      { err: Error; action: string; ticketId: string },
      string,
    ];
    expect(payload.action).toBe('ticket.closed');
    expect(payload.ticketId).toBe('t-1');
    expect(msg).toContain('[ticketAudit]');
  });

  it('metric inc happens BEFORE the db.insert call (ordering invariant)', async () => {
    const order: string[] = [];
    incMock.mockImplementationOnce(() => { order.push('inc'); });
    dbInsertMock.mockImplementationOnce(() => {
      order.push('insert');
      return { values: valuesMock };
    });
    valuesMock.mockResolvedValueOnce(undefined);

    auditTicketAssigned({ ...BASE, supportId: 's-9', supportName: 'Sam' });
    await flush();

    expect(order).toEqual(['inc', 'insert']);
  });
});

describe('ticketAudit — always stamps targetType=ticket so the drawer can query it', () => {
  beforeEach(() => {
    valuesMock.mockReset();
    valuesMock.mockResolvedValue(undefined);
    dbInsertMock.mockClear();
  });

  it('every emitter sets targetType=ticket and targetId=ticketId', async () => {
    auditTicketCreated({ ...BASE, dept: 'x', reopened: false, reopenCount: 0 });
    auditTicketClosed({ ...BASE, closedBy: 'a', hadSupport: false });
    auditTicketAssigned({ ...BASE, supportId: 's', supportName: 'n' });
    auditTicketTransferred({ ...BASE, toDepartmentId: null, toDepartmentName: null, fromSupportId: null });
    auditTicketReturnedToQueue({ ...BASE, fromSupportId: null });
    await flush();

    expect(valuesMock).toHaveBeenCalledTimes(5);
    for (const call of valuesMock.mock.calls) {
      const row = call[0] as { targetType: string; targetId: string; partnerId: string; actorId: string | null };
      expect(row.targetType).toBe('ticket');
      expect(row.targetId).toBe('t-1');
      expect(row.partnerId).toBe('p-1');
      expect(row.actorId).toBe('u-1');
    }
  });
});
