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

const detachMock = vi.fn();
const broadcastAgentStatusMock = vi.fn();

vi.mock('../../services/availability/instance.js', () => ({
  getAvailability: () => ({
    socket: { attach: vi.fn(), detach: detachMock },
    advanced: { getStatus: vi.fn(async () => null) },
  }),
}));

vi.mock('../../services/businessHours.js', () => ({
  getBusinessHoursStatus: vi.fn(() => ({ isOpen: true, message: 'Open' })),
  broadcastQueuePositions: vi.fn(),
  broadcastAgentStatus: broadcastAgentStatusMock,
}));

vi.mock('../../services/sessionRevocation.js', () => ({
  isRevoked: vi.fn(async () => false),
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
  const io: any = {
    use: vi.fn(),
    on: vi.fn(),
    to: vi.fn(() => ({ emit: vi.fn() })),
  };

  return io;
}

describe('disconnect handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clears typing indicators and decrements presence on disconnect', async () => {
    const { register } = await import('./disconnect.js');
    const io = createMockIo();

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

    detachMock.mockResolvedValueOnce({ removed: true, role: 'agent' });

    const ctx = {
      io,
      socketTickets: new Map<string, Set<string>>(),
      viewerKeyPrefix: 'ticket:viewers:',
    };

    register(socket, ctx);
    const disconnectHandler = socket.on.mock.calls.find((c: any[]) => c[0] === 'disconnect')?.[1];

    await disconnectHandler();

    // Should emit typing:false for each ticket room
    const typingCalls = socket.to.mock.calls.filter((c: any[]) => {
      const room = c[0];
      return room.startsWith('ticket:');
    });
    expect(typingCalls.length).toBe(2);

    // Should call availability.socket.detach with the disconnecting socket.id
    // so the socket-set-based presence tracker can SREM the exact socket.
    expect(detachMock).toHaveBeenCalledWith({
      userId: 'u1',
      partnerId: 'partner-1',
      socketId: expect.any(String),
    });

    // Should broadcast agent offline status since role was 'agent'
    expect(broadcastAgentStatusMock).toHaveBeenCalledWith('u1', false);
  });
});
