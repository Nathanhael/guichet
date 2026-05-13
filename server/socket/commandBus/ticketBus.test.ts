/**
 * Boundary tests for the ticket-domain dispatch on the SocketCommandBus.
 *
 * Verifies the bus's contract for ticket commands: scope checks, capability
 * gates, lifecycle invocation, error code mapping, and the post-commit
 * effects/callerJoins/callerLeaves bookkeeping. Tests never touch a real
 * socket.io server.
 *
 * What stays covered upstream:
 *   - Real lifecycle behavior: services/ticketLifecycle/*.test.ts (PGLite)
 *   - Handler-level parse/auth: socket/handlers/ticket.test.ts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  findTicketForCloseMock: vi.fn(),
  findTicketForTransferMock: vi.fn(),
  findTicketPartnerMock: vi.fn(),
  findPartnerLabelsMock: vi.fn(),
  replaceTicketLabelsMock: vi.fn(),
  findPartnerConfigMock: vi.fn(),
  getBusinessHoursStatusMock: vi.fn(() => ({ isOpen: false, message: 'Closed' })),
}));

vi.mock('../../services/ticketQueries.js', () => ({
  findTicketForClose: h.findTicketForCloseMock,
  findTicketForTransfer: h.findTicketForTransferMock,
  findPartnerLabels: h.findPartnerLabelsMock,
  replaceTicketLabels: h.replaceTicketLabelsMock,
  findTicketPartner: h.findTicketPartnerMock,
}));

vi.mock('../../services/partnerQueries.js', () => ({
  findPartnerConfig: h.findPartnerConfigMock,
}));

vi.mock('../../services/businessHours.js', () => ({
  getBusinessHoursStatus: h.getBusinessHoursStatusMock,
}));

vi.mock('../../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { dispatchTicketCommand } from './ticketBus.js';
import type { SocketCommand } from './types.js';
import type { TicketLifecycle } from '../../services/ticketLifecycle/index.js';

function makeActor(overrides: { role?: 'agent' | 'support' | 'admin'; isPlatformOperator?: boolean } = {}) {
  return {
    userId: 'u_a',
    partnerId: 'p_a',
    role: (overrides.role ?? 'support') as 'agent' | 'support' | 'admin',
    name: 'A',
    lang: 'en',
    isPlatformOperator: overrides.isPlatformOperator ?? false,
  };
}

function makeLifecycle(overrides: Partial<TicketLifecycle> = {}): TicketLifecycle {
  return {
    create: vi.fn(async () => ({ ok: true as const, data: { ticket: { id: 't_new' }, firstMessage: null }, effects: [] })),
    close: vi.fn(async () => ({ ok: true as const, effects: [] })),
    transfer: vi.fn(async () => ({ ok: true as const, effects: [] })),
    returnToQueue: vi.fn(async () => ({ ok: true as const, effects: [] })),
    ...overrides,
  } as unknown as TicketLifecycle;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ticketBus — ticket:new', () => {
  it('returns ticket:created:self reply and a callerJoins for the new ticket room on success', async () => {
    const lifecycle = makeLifecycle({
      create: vi.fn(async () => ({
        ok: true as const,
        data: { ticket: { id: 't_x', partnerId: 'p_a' }, firstMessage: { id: 'm1' } },
        effects: [{ type: 'emit', rooms: ['partner:p_a'], event: 'ticket:new', payload: { id: 't_x' } }],
      })),
    } as Partial<TicketLifecycle>);

    const cmd: SocketCommand = {
      type: 'ticket:new',
      partnerId: 'p_a',
      actor: makeActor({ role: 'agent' }),
      dept: 'general',
      agentLang: 'en',
    };
    const result = await dispatchTicketCommand({ ticketLifecycle: lifecycle }, cmd);

    expect(result.reply).toMatchObject({
      event: 'ticket:created:self',
      payload: { ticket: expect.objectContaining({ id: 't_x', participants: [], labels: [] }), message: { id: 'm1' } },
    });
    expect(result.callerJoins).toEqual(['ticket:t_x']);
    expect(result.effects).toHaveLength(1);
  });

  it('emits hours:closed with re-evaluated status when lifecycle rejects BUSINESS_HOURS_CLOSED', async () => {
    const lifecycle = makeLifecycle({
      create: vi.fn(async () => ({ ok: false as const, code: 'BUSINESS_HOURS_CLOSED' as const })),
    } as Partial<TicketLifecycle>);
    h.findPartnerConfigMock.mockResolvedValueOnce({ businessHoursSchedule: null });
    h.getBusinessHoursStatusMock.mockReturnValueOnce({ isOpen: false, message: 'Outside hours' });

    const cmd: SocketCommand = {
      type: 'ticket:new', partnerId: 'p_a', actor: makeActor({ role: 'agent' }), dept: 'general', agentLang: 'en',
    };
    const result = await dispatchTicketCommand({ ticketLifecycle: lifecycle }, cmd);

    expect(result.reply).toMatchObject({
      event: 'hours:closed',
      payload: {
        code: 'BUSINESS_HOURS_CLOSED',
        message: 'Outside hours',
        status: expect.objectContaining({ isOpen: false }),
      },
    });
    expect(h.findPartnerConfigMock).toHaveBeenCalledWith('p_a');
  });

  it('rejects with "Missing required fields" when dept or agentLang are empty', async () => {
    const lifecycle = makeLifecycle();
    const cmd: SocketCommand = {
      type: 'ticket:new', partnerId: 'p_a', actor: makeActor({ role: 'agent' }), dept: '', agentLang: 'en',
    };
    const result = await dispatchTicketCommand({ ticketLifecycle: lifecycle }, cmd);
    expect(result.reply).toEqual({ event: 'error', payload: { message: 'Missing required fields' } });
    expect(lifecycle.create).not.toHaveBeenCalled();
  });

  it('maps NOT_AUTHORIZED → "Only agents can create tickets"', async () => {
    const lifecycle = makeLifecycle({
      create: vi.fn(async () => ({ ok: false as const, code: 'NOT_AUTHORIZED' as const })),
    } as Partial<TicketLifecycle>);
    const cmd: SocketCommand = {
      type: 'ticket:new', partnerId: 'p_a', actor: makeActor({ role: 'support' }), dept: 'general', agentLang: 'en',
    };
    const result = await dispatchTicketCommand({ ticketLifecycle: lifecycle }, cmd);
    expect(result.reply).toEqual({ event: 'error', payload: { message: 'Only agents can create tickets' } });
  });
});

describe('ticketBus — ticket:close', () => {
  it('rejects cross-tenant with Not authorized; lifecycle never called', async () => {
    h.findTicketForCloseMock.mockResolvedValueOnce({ partnerId: 'p_other' });
    const lifecycle = makeLifecycle();
    const result = await dispatchTicketCommand(
      { ticketLifecycle: lifecycle },
      { type: 'ticket:close', partnerId: 'p_a', actor: makeActor(), ticketId: 't1' },
    );
    expect(result.reply).toEqual({ event: 'error', payload: { message: 'Not authorized' } });
    expect(lifecycle.close).not.toHaveBeenCalled();
  });

  it('returns lifecycle effects on success', async () => {
    h.findTicketForCloseMock.mockResolvedValueOnce({ partnerId: 'p_a' });
    const lifecycle = makeLifecycle({
      close: vi.fn(async () => ({
        ok: true as const,
        effects: [{ type: 'emit', rooms: ['ticket:t1'], event: 'ticket:closed', payload: {} }],
      })),
    } as Partial<TicketLifecycle>);
    const result = await dispatchTicketCommand(
      { ticketLifecycle: lifecycle },
      { type: 'ticket:close', partnerId: 'p_a', actor: makeActor(), ticketId: 't1' },
    );
    expect(result.effects).toHaveLength(1);
    expect(result.reply).toBeUndefined();
  });

  it('TICKET_ALREADY_CLOSED → silent (idempotent)', async () => {
    h.findTicketForCloseMock.mockResolvedValueOnce({ partnerId: 'p_a' });
    const lifecycle = makeLifecycle({
      close: vi.fn(async () => ({ ok: false as const, code: 'TICKET_ALREADY_CLOSED' as const })),
    } as Partial<TicketLifecycle>);
    const result = await dispatchTicketCommand(
      { ticketLifecycle: lifecycle },
      { type: 'ticket:close', partnerId: 'p_a', actor: makeActor(), ticketId: 't1' },
    );
    expect(result.reply).toEqual({ silent: true });
  });

  it('NOT_AUTHORIZED → "Only support staff can close tickets"', async () => {
    h.findTicketForCloseMock.mockResolvedValueOnce({ partnerId: 'p_a' });
    const lifecycle = makeLifecycle({
      close: vi.fn(async () => ({ ok: false as const, code: 'NOT_AUTHORIZED' as const })),
    } as Partial<TicketLifecycle>);
    const result = await dispatchTicketCommand(
      { ticketLifecycle: lifecycle },
      { type: 'ticket:close', partnerId: 'p_a', actor: makeActor({ role: 'agent' }), ticketId: 't1' },
    );
    expect(result.reply).toEqual({ event: 'error', payload: { message: 'Only support staff can close tickets' } });
  });
});

describe('ticketBus — ticket:transfer', () => {
  it('rejects non-support role with "Only support staff can transfer tickets"', async () => {
    const lifecycle = makeLifecycle();
    const result = await dispatchTicketCommand(
      { ticketLifecycle: lifecycle },
      { type: 'ticket:transfer', partnerId: 'p_a', actor: makeActor({ role: 'agent' }), ticketId: 't1', departmentId: 'd2' },
    );
    expect(result.reply).toEqual({ event: 'error', payload: { message: 'Only support staff can transfer tickets' } });
    expect(lifecycle.transfer).not.toHaveBeenCalled();
  });

  it('rejects cross-tenant with Not authorized', async () => {
    h.findTicketForTransferMock.mockResolvedValueOnce({ partnerId: 'p_other', supportId: 'u_b' });
    const lifecycle = makeLifecycle();
    const result = await dispatchTicketCommand(
      { ticketLifecycle: lifecycle },
      { type: 'ticket:transfer', partnerId: 'p_a', actor: makeActor(), ticketId: 't1', departmentId: 'd2' },
    );
    expect(result.reply).toEqual({ event: 'error', payload: { message: 'Not authorized' } });
  });

  it('department-change branch: calls lifecycle.transfer and returns its effects', async () => {
    h.findTicketForTransferMock.mockResolvedValueOnce({ partnerId: 'p_a', supportId: 'u_b' });
    const lifecycle = makeLifecycle({
      transfer: vi.fn(async () => ({
        ok: true as const,
        effects: [{ type: 'emit', rooms: ['ticket:t1'], event: 'ticket:transferred', payload: { ticketId: 't1' } }],
      })),
    } as Partial<TicketLifecycle>);
    const result = await dispatchTicketCommand(
      { ticketLifecycle: lifecycle },
      { type: 'ticket:transfer', partnerId: 'p_a', actor: makeActor(), ticketId: 't1', departmentId: 'd2' },
    );
    expect(lifecycle.transfer).toHaveBeenCalledTimes(1);
    expect(result.effects).toHaveLength(1);
    expect(result.callerLeaves).toBeUndefined();
  });

  it('same-department branch: returnToQueue + appends ticket:transferred emit + broadcastQueue + callerLeaves', async () => {
    h.findTicketForTransferMock.mockResolvedValueOnce({ partnerId: 'p_a', supportId: 'u_supp' });
    const lifecycle = makeLifecycle({
      returnToQueue: vi.fn(async () => ({
        ok: true as const,
        effects: [{ type: 'emit', rooms: ['ticket:t1'], event: 'message:new', payload: { id: 'sys1' } }],
      })),
    } as Partial<TicketLifecycle>);

    const result = await dispatchTicketCommand(
      { ticketLifecycle: lifecycle },
      { type: 'ticket:transfer', partnerId: 'p_a', actor: makeActor(), ticketId: 't1' },
    );

    expect(lifecycle.returnToQueue).toHaveBeenCalledTimes(1);
    // Lifecycle effects + the transfer broadcast + the queue rebroadcast.
    expect(result.effects).toHaveLength(3);
    const transferEffect = result.effects.find((e) => e.type === 'emit' && e.event === 'ticket:transferred');
    expect(transferEffect).toBeDefined();
    expect(result.effects.some((e) => e.type === 'broadcastQueue')).toBe(true);
    expect(result.callerLeaves).toEqual(['ticket:t1']);
  });

  it('same-department branch: ticket has no support → silent no-op (already unassigned)', async () => {
    h.findTicketForTransferMock.mockResolvedValueOnce({ partnerId: 'p_a', supportId: null });
    const lifecycle = makeLifecycle();
    const result = await dispatchTicketCommand(
      { ticketLifecycle: lifecycle },
      { type: 'ticket:transfer', partnerId: 'p_a', actor: makeActor(), ticketId: 't1' },
    );
    expect(result.reply).toEqual({ silent: true });
    expect(lifecycle.returnToQueue).not.toHaveBeenCalled();
  });

  it('same-department branch: TICKET_ALREADY_REASSIGNED → silent (race lost, no broadcasts)', async () => {
    h.findTicketForTransferMock.mockResolvedValueOnce({ partnerId: 'p_a', supportId: 'u_supp' });
    const lifecycle = makeLifecycle({
      returnToQueue: vi.fn(async () => ({ ok: false as const, code: 'TICKET_ALREADY_REASSIGNED' as const })),
    } as Partial<TicketLifecycle>);

    const result = await dispatchTicketCommand(
      { ticketLifecycle: lifecycle },
      { type: 'ticket:transfer', partnerId: 'p_a', actor: makeActor(), ticketId: 't1' },
    );

    expect(result.reply).toEqual({ silent: true });
    expect(result.effects).toEqual([]);
    expect(result.callerLeaves).toBeUndefined();
  });
});

describe('ticketBus — ticket:labels:update', () => {
  it('rejects role=agent (no support workflows)', async () => {
    const result = await dispatchTicketCommand(
      { ticketLifecycle: makeLifecycle() },
      { type: 'ticket:labels:update', partnerId: 'p_a', actor: makeActor({ role: 'agent' }), ticketId: 't1', labels: ['l1'] },
    );
    expect(result.reply).toEqual({ event: 'error', payload: { message: 'Not authorized to update labels' } });
    expect(h.replaceTicketLabelsMock).not.toHaveBeenCalled();
  });

  it('allows role=support and emits ticket:labels:updated effect', async () => {
    h.findTicketPartnerMock.mockResolvedValueOnce({ partnerId: 'p_a' });
    h.findPartnerLabelsMock.mockResolvedValueOnce([{ id: 'l1' }]);
    h.replaceTicketLabelsMock.mockResolvedValueOnce(undefined);

    const result = await dispatchTicketCommand(
      { ticketLifecycle: makeLifecycle() },
      { type: 'ticket:labels:update', partnerId: 'p_a', actor: makeActor({ role: 'support' }), ticketId: 't1', labels: ['l1'] },
    );

    expect(h.replaceTicketLabelsMock).toHaveBeenCalledWith('t1', ['l1']);
    expect(result.effects).toHaveLength(1);
    expect(result.effects[0]).toMatchObject({
      type: 'emit',
      rooms: ['ticket:t1'],
      event: 'ticket:labels:updated',
      payload: { ticketId: 't1', labels: ['l1'] },
    });
  });

  it('allows platform operator (role=agent + isPlatformOperator=true)', async () => {
    h.findTicketPartnerMock.mockResolvedValueOnce({ partnerId: 'p_a' });
    h.findPartnerLabelsMock.mockResolvedValueOnce([{ id: 'l1' }]);
    h.replaceTicketLabelsMock.mockResolvedValueOnce(undefined);

    const result = await dispatchTicketCommand(
      { ticketLifecycle: makeLifecycle() },
      {
        type: 'ticket:labels:update',
        partnerId: 'p_a',
        actor: makeActor({ role: 'agent', isPlatformOperator: true }),
        ticketId: 't1',
        labels: ['l1'],
      },
    );

    expect(result.effects).toHaveLength(1);
    expect(h.replaceTicketLabelsMock).toHaveBeenCalled();
  });

  it('rejects cross-tenant with Not authorized; does not write', async () => {
    h.findTicketPartnerMock.mockResolvedValueOnce({ partnerId: 'p_other' });
    const result = await dispatchTicketCommand(
      { ticketLifecycle: makeLifecycle() },
      { type: 'ticket:labels:update', partnerId: 'p_a', actor: makeActor(), ticketId: 't1', labels: ['l1'] },
    );
    expect(result.reply).toEqual({ event: 'error', payload: { message: 'Not authorized' } });
    expect(h.replaceTicketLabelsMock).not.toHaveBeenCalled();
  });

  it('rejects labels not owned by the partner with "Invalid label IDs"', async () => {
    h.findTicketPartnerMock.mockResolvedValueOnce({ partnerId: 'p_a' });
    // Caller asked for l1 + l2 but only l1 exists in partner labels.
    h.findPartnerLabelsMock.mockResolvedValueOnce([{ id: 'l1' }]);

    const result = await dispatchTicketCommand(
      { ticketLifecycle: makeLifecycle() },
      { type: 'ticket:labels:update', partnerId: 'p_a', actor: makeActor(), ticketId: 't1', labels: ['l1', 'l2'] },
    );

    expect(result.reply).toEqual({ event: 'error', payload: { message: 'Invalid label IDs' } });
    expect(h.replaceTicketLabelsMock).not.toHaveBeenCalled();
  });

  it('empty labels list clears existing assignments and emits the broadcast', async () => {
    h.findTicketPartnerMock.mockResolvedValueOnce({ partnerId: 'p_a' });
    h.replaceTicketLabelsMock.mockResolvedValueOnce(undefined);

    const result = await dispatchTicketCommand(
      { ticketLifecycle: makeLifecycle() },
      { type: 'ticket:labels:update', partnerId: 'p_a', actor: makeActor(), ticketId: 't1', labels: [] },
    );

    expect(h.findPartnerLabelsMock).not.toHaveBeenCalled();
    expect(h.replaceTicketLabelsMock).toHaveBeenCalledWith('t1', []);
    expect(result.effects[0]).toMatchObject({
      type: 'emit',
      payload: { ticketId: 't1', labels: [] },
    });
  });
});
