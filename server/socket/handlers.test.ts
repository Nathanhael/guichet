import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---- Mock dependencies ----

const queryMock = vi.fn();
const getMock = vi.fn();
const runMock = vi.fn();
const transactionMock = vi.fn();

vi.mock('../db.js', () => ({
  query: queryMock,
  get: getMock,
  run: runMock,
  transaction: transactionMock,
}));

vi.mock('../config.js', () => ({
  default: {
    JWT_SECRET: 'test-secret-key-only-for-unit-tests',
    BUSINESS_HOURS_START: '00:00',
    BUSINESS_HOURS_END: '23:59',
  },
}));

vi.mock('../utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../utils/metrics.js', () => ({
  socketioConnectionsActive: { inc: vi.fn(), dec: vi.fn() },
  socketioEventsTotal: { inc: vi.fn() },
}));

vi.mock('../utils/security.js', () => ({
  isValidMediaUrl: (url: string) => !url || url.startsWith('/uploads/') || url.startsWith('https://'),
}));

vi.mock('../utils/messageMapper.js', () => ({
  mapMessageRow: (row: any) => row,
}));

const identifyUserMock = vi.fn();
const decrementUserCountMock = vi.fn();
const broadcastOnlineSupportMock = vi.fn();

vi.mock('../services/presence.js', () => ({
  identifyUser: identifyUserMock,
  decrementUserCount: decrementUserCountMock,
  broadcastOnlineSupport: broadcastOnlineSupportMock,
}));

const getBusinessHoursStatusMock = vi.fn(() => ({ isOpen: true, message: 'Open' }));
const broadcastQueuePositionsMock = vi.fn();
const broadcastAgentStatusMock = vi.fn();

vi.mock('../services/businessHours.js', () => ({
  getBusinessHoursStatus: getBusinessHoursStatusMock,
  broadcastQueuePositions: broadcastQueuePositionsMock,
  broadcastAgentStatus: broadcastAgentStatusMock,
}));

vi.mock('../services/sessionRevocation.js', () => ({
  isRevoked: vi.fn(async () => false),
}));

vi.mock('../services/roles.js', () => ({
  canUseSupportWorkflows: (role: string) => role === 'support' || role === 'admin',
  isPlatformAdmin: (v: boolean) => v,
}));

// ---- Socket & IO mocks ----

function createMockSocket(data: Record<string, any> = {}) {
  const rooms = new Set<string>();
  const emitted: Array<{ event: string; args: any[] }> = [];

  const socket: any = {
    id: 'socket-1',
    data: { ...data },
    rooms,
    handshake: { auth: {} },
    join: vi.fn((room: string) => rooms.add(room)),
    leave: vi.fn((room: string) => rooms.delete(room)),
    emit: vi.fn((event: string, ...args: any[]) => emitted.push({ event, args })),
    to: vi.fn(() => ({
      emit: vi.fn(),
    })),
    disconnect: vi.fn(),
    on: vi.fn(),
    _emitted: emitted,
  };

  return socket;
}

function createMockIo() {
  const connectionHandlers: Array<(socket: any) => void> = [];
  const middlewares: Array<(socket: any, next: (err?: Error) => void) => void> = [];

  const io: any = {
    use: vi.fn((fn: any) => middlewares.push(fn)),
    on: vi.fn((event: string, handler: any) => {
      if (event === 'connection') connectionHandlers.push(handler);
    }),
    to: vi.fn(() => ({
      emit: vi.fn(),
    })),
    _middlewares: middlewares,
    _connectionHandlers: connectionHandlers,
  };

  return io;
}

describe('registerSocketHandlers', () => {
  beforeEach(() => {
    queryMock.mockReset();
    getMock.mockReset();
    runMock.mockReset();
    transactionMock.mockReset();
    identifyUserMock.mockReset();
    decrementUserCountMock.mockReset();
    broadcastOnlineSupportMock.mockReset();
    getBusinessHoursStatusMock.mockReset();
    getBusinessHoursStatusMock.mockReturnValue({ isOpen: true, message: 'Open' });
    broadcastQueuePositionsMock.mockReset();
    broadcastAgentStatusMock.mockReset();
  });

  it('registers JWT auth middleware and connection handler', async () => {
    const { registerSocketHandlers } = await import('./handlers.js');
    const io = createMockIo();

    registerSocketHandlers(io);

    expect(io.use).toHaveBeenCalledTimes(1); // JWT middleware
    expect(io.on).toHaveBeenCalledWith('connection', expect.any(Function));
  });

  it('JWT middleware rejects connections without a token', async () => {
    const { registerSocketHandlers } = await import('./handlers.js');
    const io = createMockIo();
    registerSocketHandlers(io);

    const socket = createMockSocket();
    socket.handshake.auth = {};
    const next = vi.fn();

    await io._middlewares[0](socket, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Authentication required',
    }));
  });

  it('JWT middleware accepts valid tokens and attaches userId', async () => {
    const jwt = await import('jsonwebtoken');
    const token = jwt.default.sign(
      { userId: 'u1', role: 'support', isPlatformOperator: false },
      'test-secret-key-only-for-unit-tests',
      { expiresIn: '1h' }
    );

    const { registerSocketHandlers } = await import('./handlers.js');
    const io = createMockIo();
    registerSocketHandlers(io);

    const socket = createMockSocket();
    socket.handshake.auth = { token };
    const next = vi.fn();

    await io._middlewares[0](socket, next);

    expect(next).toHaveBeenCalledWith(); // no error
    expect(socket.data.authedUserId).toBe('u1');
  });
});

describe('socket:identify', () => {
  async function setupIdentify() {
    const { registerSocketHandlers } = await import('./handlers.js');
    const io = createMockIo();
    registerSocketHandlers(io);

    const socket = createMockSocket({
      authedUserId: 'u1',
      authedIsPlatformOperator: false,
      tokenExp: Math.floor(Date.now() / 1000) + 3600,
    });

    // Trigger connection handler which sets up event listeners
    io._connectionHandlers[0](socket);

    // Find the socket:identify handler from the socket.on calls
    const identifyCall = socket.on.mock.calls.find((c: any[]) => c[0] === 'socket:identify');
    return { socket, io, identifyHandler: identifyCall?.[1] };
  }

  it('emits error and disconnects when user not found in DB', async () => {
    getMock.mockResolvedValueOnce(undefined); // user lookup returns nothing

    const { socket, identifyHandler } = await setupIdentify();
    await identifyHandler({ partnerId: 'partner-1' });

    expect(socket.emit).toHaveBeenCalledWith('error', { message: 'User not found' });
    expect(socket.disconnect).toHaveBeenCalled();
  });

  it('emits error when non-platform user lacks membership', async () => {
    getMock
      .mockResolvedValueOnce({ name: 'Test User', isPlatformOperator: false }) // user lookup
      .mockResolvedValueOnce(undefined); // membership lookup

    const { socket, identifyHandler } = await setupIdentify();
    await identifyHandler({ partnerId: 'partner-1' });

    expect(socket.emit).toHaveBeenCalledWith('error', { message: 'Not authorized for this partner' });
    expect(socket.disconnect).toHaveBeenCalled();
  });

  it('identifies successfully with valid membership', async () => {
    getMock
      .mockResolvedValueOnce({ name: 'Test User', isPlatformOperator: false }) // user lookup
      .mockResolvedValueOnce({ role: 'support' }); // membership lookup
    queryMock.mockResolvedValueOnce([]); // active tickets

    const { socket, identifyHandler } = await setupIdentify();
    await identifyHandler({ partnerId: 'partner-1' });

    expect(socket.data.userId).toBe('u1');
    expect(socket.data.role).toBe('support');
    expect(socket.data.partnerId).toBe('partner-1');
    expect(identifyUserMock).toHaveBeenCalledWith('u1', 'support', 'Test User', 'partner-1');
    expect(socket.join).toHaveBeenCalledWith('partner:partner-1');
    expect(socket.join).toHaveBeenCalledWith('user:u1');
  });

  it('allows platform operators without membership', async () => {
    const { registerSocketHandlers } = await import('./handlers.js');
    const io = createMockIo();
    registerSocketHandlers(io);

    const socket = createMockSocket({
      authedUserId: 'platform-1',
      authedIsPlatformOperator: true,
      tokenExp: Math.floor(Date.now() / 1000) + 3600,
    });

    io._connectionHandlers[0](socket);
    const identifyHandler = socket.on.mock.calls.find((c: any[]) => c[0] === 'socket:identify')?.[1];

    getMock
      .mockResolvedValueOnce({ name: 'Platform Admin', isPlatformOperator: true }) // user lookup
      .mockResolvedValueOnce(undefined); // no membership
    queryMock.mockResolvedValueOnce([]); // active tickets

    await identifyHandler({ partnerId: 'partner-1' });

    expect(socket.data.userId).toBe('platform-1');
    expect(socket.data.role).toBe('admin'); // auto-elevated
    expect(socket.disconnect).not.toHaveBeenCalled();
  });
});

describe('disconnect handler', () => {
  it('clears typing indicators and decrements presence on disconnect', async () => {
    const { registerSocketHandlers } = await import('./handlers.js');
    const io = createMockIo();
    registerSocketHandlers(io);

    const toEmitMock = vi.fn();
    const socket = createMockSocket({
      userId: 'u1',
      partnerId: 'partner-1',
      name: 'Test User',
      tokenExp: Math.floor(Date.now() / 1000) + 3600,
    });
    // Pre-populate rooms as if user had joined ticket rooms
    socket.rooms.add('ticket:t1');
    socket.rooms.add('ticket:t2');
    socket.rooms.add('partner:partner-1');
    socket.to.mockReturnValue({ emit: toEmitMock });

    decrementUserCountMock.mockResolvedValueOnce({ removed: true, role: 'agent' });

    io._connectionHandlers[0](socket);
    const disconnectHandler = socket.on.mock.calls.find((c: any[]) => c[0] === 'disconnect')?.[1];

    await disconnectHandler();

    // Should emit typing:false for each ticket room
    const typingCalls = socket.to.mock.calls.filter((c: any[]) => {
      const room = c[0];
      return room.startsWith('ticket:');
    });
    expect(typingCalls.length).toBe(2);

    // Should decrement presence
    expect(decrementUserCountMock).toHaveBeenCalledWith('u1', 'partner-1');

    // Should broadcast agent offline status since role was 'agent'
    expect(broadcastAgentStatusMock).toHaveBeenCalledWith('u1', false);
  });
});

describe('broadcastPartnerDeactivation', () => {
  it('emits partner:deactivated to the partner room', async () => {
    const { registerSocketHandlers, broadcastPartnerDeactivation } = await import('./handlers.js');
    const io = createMockIo();
    const emitMock = vi.fn();
    io.to.mockReturnValue({ emit: emitMock });

    registerSocketHandlers(io);
    broadcastPartnerDeactivation('partner-1');

    expect(io.to).toHaveBeenCalledWith('partner:partner-1');
    expect(emitMock).toHaveBeenCalledWith('partner:deactivated', { partnerId: 'partner-1' });
  });
});

describe('broadcastUserDeactivation', () => {
  it('emits user:deactivated to the user room', async () => {
    const { registerSocketHandlers, broadcastUserDeactivation } = await import('./handlers.js');
    const io = createMockIo();
    const emitMock = vi.fn();
    io.to.mockReturnValue({ emit: emitMock });

    registerSocketHandlers(io);
    broadcastUserDeactivation('user-1');

    expect(io.to).toHaveBeenCalledWith('user:user-1');
    expect(emitMock).toHaveBeenCalledWith('user:deactivated', { userId: 'user-1' });
  });
});
