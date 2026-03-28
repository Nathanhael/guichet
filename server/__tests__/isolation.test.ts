/**
 * Multi-tenant isolation tests.
 *
 * These tests verify that tenant (partner) boundaries are enforced:
 * - Socket handlers reject cross-partner operations
 * - tRPC routers scope queries to the caller's partner
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---- DB mocks ----
const queryMock = vi.fn();
const getMock = vi.fn();
const runMock = vi.fn();
const transactionMock = vi.fn();

const selectQueue: unknown[] = [];
const insertValuesMock = vi.fn();
const updateWhereMock = vi.fn();

const dbMock = {
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => selectQueue.shift()),
        orderBy: vi.fn(async () => selectQueue.shift()),
      })),
      innerJoin: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(async () => selectQueue.shift()),
        })),
      })),
    })),
  })),
  insert: vi.fn(() => ({
    values: insertValuesMock,
  })),
  update: vi.fn(() => ({
    set: vi.fn(() => ({
      where: updateWhereMock,
    })),
  })),
};

vi.mock('../db.js', () => ({
  db: dbMock,
  query: queryMock,
  get: getMock,
  run: runMock,
  transaction: transactionMock,
}));

vi.mock('../config.js', () => ({
  default: {
    JWT_SECRET: 'test-secret-key-only-for-unit-tests-padding-to-reach-sixty-four-c!',
    BUSINESS_HOURS_START: '00:00',
    BUSINESS_HOURS_END: '23:59',
  },
}));

vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../utils/metrics.js', () => ({
  socketioConnectionsActive: { inc: vi.fn(), dec: vi.fn() },
  socketioEventsTotal: { inc: vi.fn() },
}));

vi.mock('../utils/security.js', () => ({
  isValidMediaUrl: () => true,
}));

vi.mock('../utils/messageMapper.js', () => ({
  mapMessageRow: (row: any) => row,
}));

vi.mock('../services/presence.js', () => ({
  identifyUser: vi.fn(),
  decrementUserCount: vi.fn(),
  broadcastOnlineSupport: vi.fn(),
}));

vi.mock('../services/businessHours.js', () => ({
  getBusinessHoursStatus: vi.fn(() => ({ isOpen: true })),
  broadcastQueuePositions: vi.fn(),
  broadcastAgentStatus: vi.fn(),
}));

vi.mock('../services/sessionRevocation.js', () => ({
  isRevoked: vi.fn(async () => false),
}));

vi.mock('../services/roles.js', () => ({
  canUseSupportWorkflows: (role: string) => role === 'support' || role === 'admin',
  isPlatformAdmin: (v: boolean) => v,
}));

// ---- Helpers ----

function createMockSocket(data: Record<string, any>) {
  const rooms = new Set<string>();
  const emitted: Array<{ event: string; args: any[] }> = [];
  const socket: any = {
    id: `socket-${Math.random().toString(36).slice(2)}`,
    data: { ...data },
    rooms,
    handshake: { auth: {} },
    join: vi.fn((room: string) => rooms.add(room)),
    leave: vi.fn((room: string) => rooms.delete(room)),
    emit: vi.fn((event: string, ...args: any[]) => emitted.push({ event, args })),
    to: vi.fn(() => ({ emit: vi.fn() })),
    disconnect: vi.fn(),
    on: vi.fn(),
    _emitted: emitted,
  };
  return socket;
}

function createMockIo() {
  const connectionHandlers: Array<(socket: any) => void> = [];
  const io: any = {
    use: vi.fn(),
    on: vi.fn((event: string, handler: any) => {
      if (event === 'connection') connectionHandlers.push(handler);
    }),
    to: vi.fn(() => ({ emit: vi.fn() })),
    _connectionHandlers: connectionHandlers,
  };
  return io;
}

function getHandler(socket: any, eventName: string) {
  const call = socket.on.mock.calls.find((c: any[]) => c[0] === eventName);
  return call?.[1];
}

describe('multi-tenant isolation — socket handlers', () => {
  let io: any;

  beforeEach(async () => {
    queryMock.mockReset();
    getMock.mockReset();
    runMock.mockReset();
    selectQueue.length = 0;
    insertValuesMock.mockReset();
    insertValuesMock.mockResolvedValue(undefined);
    updateWhereMock.mockReset();
    updateWhereMock.mockResolvedValue(undefined);

    const { registerSocketHandlers } = await import('../socket/handlers.js');
    io = createMockIo();
    registerSocketHandlers(io);
  });

  it('support:join rejects joining a ticket belonging to a different partner', async () => {
    const socket = createMockSocket({
      userId: 'support-1',
      partnerId: 'partner-A',
      role: 'support',
      name: 'Support A',
      authedUserId: 'support-1',
      tokenExp: Math.floor(Date.now() / 1000) + 3600,
    });

    io._connectionHandlers[0](socket);
    const joinHandler = getHandler(socket, 'support:join');

    // Ticket belongs to partner-B, NOT partner-A
    getMock.mockResolvedValueOnce({
      id: 'ticket-1',
      partner_id: 'partner-B',
      status: 'open',
      agent_id: 'agent-1',
      agent_lang: 'en',
      support_id: null,
      participants: '[]',
    });

    await joinHandler({
      ticketId: 'ticket-1',
      supportId: 'support-1',
      supportName: 'Support A',
      supportLang: 'en',
    });

    // Should emit an error, NOT join the room
    expect(socket.emit).toHaveBeenCalledWith('error', expect.objectContaining({
      message: expect.stringContaining('Not authorized'),
    }));
    expect(socket.join).not.toHaveBeenCalledWith('ticket:ticket-1');
  });

  it('message:send rejects sending to a ticket in a different partner', async () => {
    const socket = createMockSocket({
      userId: 'support-1',
      partnerId: 'partner-A',
      role: 'support',
      name: 'Support A',
      authedUserId: 'support-1',
      tokenExp: Math.floor(Date.now() / 1000) + 3600,
    });

    io._connectionHandlers[0](socket);
    const sendHandler = getHandler(socket, 'message:send');

    // Ticket belongs to partner-B
    getMock.mockResolvedValueOnce({ partner_id: 'partner-B', status: 'active' });

    await sendHandler({
      ticketId: 'ticket-1',
      senderId: 'support-1',
      text: 'Hello from wrong partner',
    });

    expect(socket.emit).toHaveBeenCalledWith('error', expect.objectContaining({
      message: expect.stringContaining('Not authorized'),
    }));
    expect(runMock).not.toHaveBeenCalled(); // No message should be inserted
  });

  it('ticket:close rejects closing a ticket in a different partner', async () => {
    const socket = createMockSocket({
      userId: 'support-1',
      partnerId: 'partner-A',
      role: 'support',
      name: 'Support A',
      authedUserId: 'support-1',
      tokenExp: Math.floor(Date.now() / 1000) + 3600,
    });

    io._connectionHandlers[0](socket);
    const closeHandler = getHandler(socket, 'ticket:close');

    // Ticket belongs to partner-B
    getMock.mockResolvedValueOnce({
      id: 'ticket-1',
      partner_id: 'partner-B',
      status: 'active',
      support_id: 'support-1',
    });

    await closeHandler({ ticketId: 'ticket-1' });

    expect(socket.emit).toHaveBeenCalledWith('error', expect.objectContaining({
      message: expect.stringContaining('Not authorized'),
    }));
    expect(runMock).not.toHaveBeenCalled();
  });

  it('ticket:labels:update rejects updating labels on a cross-partner ticket', async () => {
    const socket = createMockSocket({
      userId: 'admin-1',
      partnerId: 'partner-A',
      role: 'admin',
      name: 'Admin A',
      authedUserId: 'admin-1',
      tokenExp: Math.floor(Date.now() / 1000) + 3600,
    });

    io._connectionHandlers[0](socket);
    const labelsHandler = getHandler(socket, 'ticket:labels:update');

    // Ticket belongs to partner-B
    getMock.mockResolvedValueOnce({ partner_id: 'partner-B' });

    await labelsHandler({ ticketId: 'ticket-1', labels: ['label-1'] });

    expect(socket.emit).toHaveBeenCalledWith('error', expect.objectContaining({
      message: expect.stringContaining('Not authorized'),
    }));
  });

  it('socket:identify prevents non-platform user from accessing unassigned partner', async () => {
    const socket = createMockSocket({
      authedUserId: 'user-1',
      authedIsPlatformOperator: false,
      tokenExp: Math.floor(Date.now() / 1000) + 3600,
    });

    io._connectionHandlers[0](socket);
    const identifyHandler = getHandler(socket, 'socket:identify');

    // User exists but has no membership for this partner
    getMock
      .mockResolvedValueOnce({ name: 'User 1', isPlatformOperator: false }) // user lookup
      .mockResolvedValueOnce(undefined); // no membership

    await identifyHandler({ partnerId: 'partner-X' });

    expect(socket.emit).toHaveBeenCalledWith('error', { message: 'Not authorized for this partner' });
    expect(socket.disconnect).toHaveBeenCalled();
  });
});
