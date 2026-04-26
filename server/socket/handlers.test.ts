import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---- Mock all domain handler modules to no-ops ----

const setupRevocationPubSubMock = vi.fn();
const setupJwtMiddlewareMock = vi.fn();
const setupIdentityMiddlewareMock = vi.fn();
const registerAuthMock = vi.fn();

vi.mock('./handlers/auth.js', () => ({
  setupRevocationPubSub: setupRevocationPubSubMock,
  setupJwtMiddleware: setupJwtMiddlewareMock,
  setupIdentityMiddleware: setupIdentityMiddlewareMock,
  register: registerAuthMock,
}));

vi.mock('./handlers/ticket.js', () => ({ register: vi.fn() }));
vi.mock('./handlers/message.js', () => ({ register: vi.fn() }));
vi.mock('./handlers/presence.js', () => ({ register: vi.fn() }));
vi.mock('./handlers/collision.js', () => ({ register: vi.fn() }));
vi.mock('./handlers/rating.js', () => ({ register: vi.fn() }));
vi.mock('./handlers/disconnect.js', () => ({ register: vi.fn() }));

vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../utils/metrics.js', () => ({
  socketioConnectionsActive: { inc: vi.fn(), dec: vi.fn() },
}));

// Stub lifecycle — orchestrator tests only check fanout, not lifecycle calls.
const stubLifecycle = {
  reclaim: vi.fn(),
} as any;

// ---- Socket & IO mocks ----

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

function createMockSocket() {
  return {
    id: 'socket-1',
    data: {},
    rooms: new Set<string>(),
    on: vi.fn(),
    emit: vi.fn(),
  } as any;
}

describe('registerSocketHandlers (orchestrator)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls setupRevocationPubSub and setupJwtMiddleware once', async () => {
    const { registerSocketHandlers } = await import('./handlers.js');
    const io = createMockIo();

    registerSocketHandlers(io, { lifecycle: stubLifecycle });

    expect(setupRevocationPubSubMock).toHaveBeenCalledOnce();
    expect(setupRevocationPubSubMock).toHaveBeenCalledWith(io);
    expect(setupJwtMiddlewareMock).toHaveBeenCalledOnce();
    expect(setupJwtMiddlewareMock).toHaveBeenCalledWith(io);
  });

  it('registers a connection handler on io', async () => {
    const { registerSocketHandlers } = await import('./handlers.js');
    const io = createMockIo();

    registerSocketHandlers(io, { lifecycle: stubLifecycle });

    expect(io.on).toHaveBeenCalledWith('connection', expect.any(Function));
  });

  it('delegates to all domain register functions on connection', async () => {
    const { registerSocketHandlers } = await import('./handlers.js');
    const { register: registerTicket } = await import('./handlers/ticket.js');
    const { register: registerMessage } = await import('./handlers/message.js');
    const { register: registerPresence } = await import('./handlers/presence.js');
    const { register: registerCollision } = await import('./handlers/collision.js');
    const { register: registerRating } = await import('./handlers/rating.js');
    const { register: registerDisconnect } = await import('./handlers/disconnect.js');

    const io = createMockIo();
    registerSocketHandlers(io, { lifecycle: stubLifecycle });

    const socket = createMockSocket();
    io._connectionHandlers[0](socket);

    expect(registerAuthMock).toHaveBeenCalledWith(socket, expect.any(Object));
    expect(registerTicket).toHaveBeenCalledWith(socket, expect.any(Object));
    expect(registerMessage).toHaveBeenCalledWith(socket, expect.any(Object));
    expect(registerPresence).toHaveBeenCalledWith(socket, expect.any(Object));
    expect(registerCollision).toHaveBeenCalledWith(socket, expect.any(Object));
    expect(registerRating).toHaveBeenCalledWith(socket, expect.any(Object));
    expect(registerDisconnect).toHaveBeenCalledWith(socket, expect.any(Object));
  });
});

describe('broadcastPartnerDeactivation', () => {
  it('emits partner:deactivated to the partner room', async () => {
    const { registerSocketHandlers, broadcastPartnerDeactivation } = await import('./handlers.js');
    const io = createMockIo();
    const emitMock = vi.fn();
    io.to.mockReturnValue({ emit: emitMock });

    registerSocketHandlers(io, { lifecycle: stubLifecycle });
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

    registerSocketHandlers(io, { lifecycle: stubLifecycle });
    broadcastUserDeactivation('user-1');

    expect(io.to).toHaveBeenCalledWith('user:user-1');
    expect(emitMock).toHaveBeenCalledWith('user:deactivated', { userId: 'user-1' });
  });
});
