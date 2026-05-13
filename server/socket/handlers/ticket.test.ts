/**
 * Handler-shape tests for socket/handlers/ticket.ts.
 *
 * The capability + scope semantics live in the SocketCommandBus — see
 * `commandBus/ticketBus.test.ts` for the canonical coverage of:
 *   - role gates (agent rejected; support/admin/platform_operator allowed)
 *   - cross-tenant rejection
 *   - business-hours-closed re-evaluation
 *   - same-dept transfer broadcast as effect data
 *
 * What remains here: confirm the handler builds the right Command shape
 * from a validated payload, hands it to `bus.dispatch`, and feeds the
 * resulting `CommandResult` through `applyCommandResult` (which lives in
 * the bus module). One representative event per command type is enough —
 * the bus's discriminated union catches drift at compile time.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config.js', () => ({
  default: {
    JWT_SECRET: 'test-secret-key-only-for-unit-tests-padding-to-reach-sixty-four-c!',
  },
}));

vi.mock('../../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../services/sessionRevocation.js', () => ({
  isRevoked: vi.fn(async () => false),
}));

function createMockSocket(data: Record<string, unknown> = {}) {
  const rooms = new Set<string>();
  const emitted: Array<{ event: string; args: unknown[] }> = [];
  const socket: unknown = {
    id: 'socket-1',
    data: { identified: true, ...data },
    rooms,
    handshake: { auth: {} },
    join: vi.fn((room: string) => rooms.add(room)),
    leave: vi.fn((room: string) => rooms.delete(room)),
    emit: vi.fn((event: string, ...args: unknown[]) => emitted.push({ event, args })),
    to: vi.fn(() => ({ emit: vi.fn() })),
    disconnect: vi.fn(),
    on: vi.fn(),
    _emitted: emitted,
  };
  return socket as { id: string; data: Record<string, unknown>; emit: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn>; _emitted: Array<{ event: string; args: unknown[] }> };
}

async function setupHandlers(socketDataOverrides: Record<string, unknown> = {}) {
  const { register } = await import('./ticket.js');
  const io = {
    use: vi.fn(),
    on: vi.fn(),
    to: vi.fn(() => ({ emit: vi.fn() })),
  };
  const socket = createMockSocket({
    userId: 'u1',
    partnerId: 'p1',
    role: 'support',
    name: 'Test',
    isPlatformOperator: false,
    lang: 'en',
    tokenExp: Math.floor(Date.now() / 1000) + 3600,
    ...socketDataOverrides,
  });

  const busDispatch = vi.fn(async () => ({ effects: [] }));
  const ctx = {
    io,
    socketTickets: new Map<string, Set<string>>(),
    viewerKeyPrefix: 'ticket:viewers:',
    bus: { dispatch: busDispatch },
  };

  register(socket as never, ctx as never);

  function handlerFor(event: string) {
    const call = socket.on.mock.calls.find((c) => (c as unknown[])[0] === event);
    return call?.[1] as ((data: unknown) => Promise<void>) | undefined;
  }

  return { socket, busDispatch, handlerFor };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ticket handlers — bus delegation shape', () => {
  it('ticket:new builds a ticket:new command from the validated payload', async () => {
    const { busDispatch, handlerFor } = await setupHandlers({ role: 'agent' });
    const handler = handlerFor('ticket:new');
    expect(handler).toBeDefined();

    await handler!({ agentLang: 'en', dept: 'general' });

    expect(busDispatch).toHaveBeenCalledTimes(1);
    const [cmd] = busDispatch.mock.calls[0] as [{ type: string; dept: string; agentLang: string }, string];
    expect(cmd.type).toBe('ticket:new');
    expect(cmd.dept).toBe('general');
    expect(cmd.agentLang).toBe('en');
  });

  it('ticket:close passes ticketId + closingNotes through', async () => {
    const { busDispatch, handlerFor } = await setupHandlers();
    await handlerFor('ticket:close')!({ ticketId: 't1', closingNotes: 'resolved by support' });

    const [cmd] = busDispatch.mock.calls[0] as [{ type: string; ticketId: string; closingNotes?: string }, string];
    expect(cmd.type).toBe('ticket:close');
    expect(cmd.ticketId).toBe('t1');
    expect(cmd.closingNotes).toBe('resolved by support');
  });

  it('ticket:transfer passes ticketId + departmentId through', async () => {
    const { busDispatch, handlerFor } = await setupHandlers();
    await handlerFor('ticket:transfer')!({ ticketId: 't1', departmentId: 'd2' });

    const [cmd] = busDispatch.mock.calls[0] as [{ type: string; ticketId: string; departmentId?: string }, string];
    expect(cmd.type).toBe('ticket:transfer');
    expect(cmd.ticketId).toBe('t1');
    expect(cmd.departmentId).toBe('d2');
  });

  it('ticket:labels:update passes ticketId + labels through', async () => {
    const { busDispatch, handlerFor } = await setupHandlers();
    await handlerFor('ticket:labels:update')!({ ticketId: 't1', labels: ['l1', 'l2'] });

    const [cmd] = busDispatch.mock.calls[0] as [{ type: string; ticketId: string; labels: string[] }, string];
    expect(cmd.type).toBe('ticket:labels:update');
    expect(cmd.ticketId).toBe('t1');
    expect(cmd.labels).toEqual(['l1', 'l2']);
  });

  it('unidentified socket on ticket:close — bus is never reached', async () => {
    const { socket, busDispatch, handlerFor } = await setupHandlers({ userId: undefined, partnerId: undefined });
    await handlerFor('ticket:close')!({ ticketId: 't1' });

    expect(socket.emit).toHaveBeenCalledWith('error', {
      message: 'Not authenticated — call socket:identify first',
    });
    expect(busDispatch).not.toHaveBeenCalled();
  });
});
