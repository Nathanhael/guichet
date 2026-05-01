import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---- Mock dependencies ----

vi.mock('../../config.js', () => ({
  default: {
    JWT_SECRET: 'test-secret-key-only-for-unit-tests-padding-to-reach-sixty-four-c!',
  },
}));

vi.mock('../../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../utils/metrics.js', () => ({
  socketioConnectionsActive: { inc: vi.fn(), dec: vi.fn() },
  socketioEventsTotal: { inc: vi.fn() },
}));

vi.mock('../../utils/security.js', () => ({
  isValidMediaUrl: (url: string) => !url || url.startsWith('/uploads/') || url.startsWith('https://'),
}));

// ---- userQueries mocks ----
const findUserByIdMock = vi.fn();
const findMembershipMock = vi.fn();

vi.mock('../../services/userQueries.js', () => ({
  findUserById: findUserByIdMock,
  findMembership: findMembershipMock,
  findSenderInfo: vi.fn(),
  findUserName: vi.fn(),
  findTargetSupport: vi.fn(),
}));

const { mockAvailability } = vi.hoisted(() => ({
  mockAvailability: {
    socket: { attach: vi.fn().mockResolvedValue(undefined), detach: vi.fn().mockResolvedValue({ fullyOffline: false, role: '', partnerId: '', isPlatformOperator: false }) },
    advanced: { getStatus: vi.fn().mockResolvedValue(null) },
  },
}));

vi.mock('../../services/availability/index.js', () => ({
  getAvailability: () => mockAvailability,
}));

vi.mock('../../services/businessHours.js', () => ({
  getBusinessHoursStatus: vi.fn(() => ({ isOpen: true, message: 'Open' })),
  broadcastQueuePositions: vi.fn(),
  broadcastAgentStatus: vi.fn(),
}));

vi.mock('../../services/auth/sessionRevocation.js', () => ({
  isRevoked: vi.fn(async () => false),
}));

vi.mock('../../services/roles.js', () => ({
  canUseSupportWorkflows: (role: string) => role === 'support' || role === 'admin',
  isPlatformAdmin: (v: boolean) => v,
}));

const findActiveTicketsForSupportMock = vi.fn();

vi.mock('../../services/ticketQueries.js', () => ({
  findTicketPartner: vi.fn(),
  findTicketForJoin: vi.fn(),
  findTicketForClose: vi.fn(),
  findTicketOwner: vi.fn(),
  findTicketParticipants: vi.fn(),
  findTicketForMessage: vi.fn(),
  findRecentClosedTickets: vi.fn(),
  findActiveTicketsForAgent: vi.fn(),
  findActiveTicketsForSupport: findActiveTicketsForSupportMock,
  findTicketForTransfer: vi.fn(),
  findPartnerLabels: vi.fn(),
  createTicket: vi.fn(),
  assignSupport: vi.fn(),
  findUpdatedParticipants: vi.fn(),
  updateParticipants: vi.fn(),
  closeTicket: vi.fn(),
  updateTicketSla: vi.fn(),
  transferTicket: vi.fn(),
  returnTicketToQueue: vi.fn(),
  replaceTicketLabels: vi.fn(),
  insertRating: vi.fn(),
}));

vi.mock('../../services/partnerQueries.js', () => ({
  findPartnerConfig: vi.fn(),
}));

vi.mock('../../utils/redis.js', () => ({
  getRedisClients: vi.fn(() => ({ pubClient: null, subClient: null })),
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
    to: vi.fn(() => ({ emit: vi.fn() })),
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
    to: vi.fn(() => ({ emit: vi.fn() })),
    _middlewares: middlewares,
    _connectionHandlers: connectionHandlers,
  };

  return io;
}

describe('setupJwtMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers JWT auth middleware', async () => {
    const { setupJwtMiddleware } = await import('./auth.js');
    const io = createMockIo();

    setupJwtMiddleware(io);

    expect(io.use).toHaveBeenCalledTimes(1);
  });

  it('JWT middleware rejects connections without a token', async () => {
    const { setupJwtMiddleware } = await import('./auth.js');
    const io = createMockIo();
    setupJwtMiddleware(io);

    const socket = createMockSocket();
    socket.handshake.auth = {};
    const next = vi.fn();

    await io._middlewares[0](socket, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Authentication required',
    }));
  });

  it('JWT middleware accepts valid tokens and attaches userId', async () => {
    const { SignJWT } = await import('jose');
    const secret = new TextEncoder().encode('test-secret-key-only-for-unit-tests-padding-to-reach-sixty-four-c!');
    const token = await new SignJWT({ userId: 'u1', role: 'support', isPlatformOperator: false })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secret);

    const { setupJwtMiddleware } = await import('./auth.js');
    const io = createMockIo();
    setupJwtMiddleware(io);

    const socket = createMockSocket();
    socket.handshake.auth = { token };
    const next = vi.fn();

    await io._middlewares[0](socket, next);

    expect(next).toHaveBeenCalledWith(); // no error
    expect(socket.data.authedUserId).toBe('u1');
  });
});

describe('socket:identify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function setupIdentify() {
    const { setupJwtMiddleware, register } = await import('./auth.js');
    const io = createMockIo();
    setupJwtMiddleware(io);

    const socket = createMockSocket({
      authedUserId: 'u1',
      authedIsPlatformOperator: false,
      tokenExp: Math.floor(Date.now() / 1000) + 3600,
    });

    const ctx = {
      io,
      socketTickets: new Map<string, Set<string>>(),
      viewerKeyPrefix: 'ticket:viewers:',
    };

    register(socket, ctx);

    const identifyCall = socket.on.mock.calls.find((c: any[]) => c[0] === 'socket:identify');
    return { socket, io, identifyHandler: identifyCall?.[1] };
  }

  it('emits auth:expired and disconnects when user not found in DB', async () => {
    // Updated 2026-04-11: the handler now emits 'auth:expired' (not a
    // generic 'error' event) when the JWT references a deleted user,
    // so the client auto-reconnects through the refresh flow rather
    // than surfacing a generic red error toast.
    findUserByIdMock.mockResolvedValueOnce(undefined);

    const { socket, identifyHandler } = await setupIdentify();
    await identifyHandler({ partnerId: 'partner-1' });

    expect(socket.emit).toHaveBeenCalledWith(
      'auth:expired',
      expect.objectContaining({ message: expect.any(String) }),
    );
    expect(socket.disconnect).toHaveBeenCalled();
  });

  it('emits auth:expired when non-platform user lacks membership', async () => {
    // Same reasoning as above — membership revocation (e.g. after a
    // reseed) goes through the auth:expired path.
    findUserByIdMock.mockResolvedValueOnce({ name: 'Test User', isPlatformOperator: false });
    findMembershipMock.mockResolvedValueOnce(undefined);

    const { socket, identifyHandler } = await setupIdentify();
    await identifyHandler({ partnerId: 'partner-1' });

    expect(socket.emit).toHaveBeenCalledWith(
      'auth:expired',
      expect.objectContaining({ message: expect.any(String) }),
    );
    expect(socket.disconnect).toHaveBeenCalled();
  });

  it('identifies successfully with valid membership', async () => {
    findUserByIdMock.mockResolvedValueOnce({ name: 'Test User', isPlatformOperator: false, lang: 'fr' });
    findMembershipMock.mockResolvedValueOnce({ role: 'support' });
    findActiveTicketsForSupportMock.mockResolvedValueOnce([]);

    const { socket, identifyHandler } = await setupIdentify();
    await identifyHandler({ partnerId: 'partner-1' });

    expect(socket.data.userId).toBe('u1');
    expect(socket.data.role).toBe('support');
    expect(socket.data.partnerId).toBe('partner-1');
    // H-1 regression: viewer lang must be stored on socket.data so the
    // message:send pre-warm can fan out per-viewer translations.
    expect(socket.data.lang).toBe('fr');
    // availability.socket.attach carries userId, role, name, partnerId, socketId, isPlatformOperator.
    expect(mockAvailability.socket.attach).toHaveBeenCalledWith({
      userId: 'u1',
      partnerId: 'partner-1',
      socketId: expect.any(String),
      role: 'support',
      name: 'Test User',
      isPlatformOperator: false,
    });
    expect(socket.join).toHaveBeenCalledWith('partner:partner-1');
    expect(socket.join).toHaveBeenCalledWith('user:u1');
  });

  it('allows platform operators without membership', async () => {
    const { setupJwtMiddleware, register } = await import('./auth.js');
    const io = createMockIo();
    setupJwtMiddleware(io);

    const socket = createMockSocket({
      authedUserId: 'platform-1',
      authedIsPlatformOperator: true,
      tokenExp: Math.floor(Date.now() / 1000) + 3600,
    });

    const ctx = {
      io,
      socketTickets: new Map<string, Set<string>>(),
      viewerKeyPrefix: 'ticket:viewers:',
    };

    register(socket, ctx);

    const identifyHandler = socket.on.mock.calls.find((c: any[]) => c[0] === 'socket:identify')?.[1];

    findUserByIdMock.mockResolvedValueOnce({ name: 'Platform Admin', isPlatformOperator: true });
    findMembershipMock.mockResolvedValueOnce(undefined);
    findActiveTicketsForSupportMock.mockResolvedValueOnce([]);

    await identifyHandler({ partnerId: 'partner-1' });

    expect(socket.data.userId).toBe('platform-1');
    expect(socket.data.role).toBe('admin');
    expect(socket.disconnect).not.toHaveBeenCalled();
  });
});
