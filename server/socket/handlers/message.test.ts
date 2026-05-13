import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---- Mock dependencies ----

vi.mock('../../config.js', () => ({
  default: {
    JWT_SECRET: 'test-secret-key-only-for-unit-tests-padding-to-reach-sixty-four-c!',
  },
}));

vi.mock('../../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../utils/security.js', () => ({
  isValidMediaUrl: (url: string) => !url || url.startsWith('/uploads/') || url.startsWith('https://'),
}));

vi.mock('../../utils/messageMapper.js', () => ({
  mapMessageRow: (row: any) => row,
}));

// ---- userQueries mocks ----
const findSenderInfoMock = vi.fn();

vi.mock('../../services/userQueries.js', () => ({
  findUserById: vi.fn(),
  findMembership: vi.fn(),
  findSenderInfo: findSenderInfoMock,
  findUserName: vi.fn(),
  findTargetSupport: vi.fn(),
}));

vi.mock('../../services/partnerQueries.js', () => ({
  findPartnerConfig: vi.fn(),
}));

vi.mock('../../services/businessHours.js', () => ({
  getBusinessHoursStatus: vi.fn(() => ({ isOpen: true, message: 'Open' })),
  broadcastQueuePositions: vi.fn(),
  broadcastAgentStatus: vi.fn(),
}));

vi.mock('../../services/sessionRevocation.js', () => ({
  isRevoked: vi.fn(async () => false),
}));

vi.mock('../../services/roles.js', () => ({
  canUseSupportWorkflows: (role: string) => role === 'support' || role === 'admin',
  isPlatformAdmin: (v: boolean) => v,
}));

vi.mock('../../services/ai/index.js', () => ({}));

vi.mock('../../services/sla/index.js', () => ({
  parseSlaConfig: vi.fn(() => null),
  getEffectiveSla: vi.fn(() => ({ responseMs: 180000, resolutionMs: 3600000 })),
  calculateSlaDueDate: vi.fn(() => new Date()),
}));

// ---- ticketQueries mocks ----
const findTicketForMessageMock = vi.fn();

vi.mock('../../services/ticketQueries.js', () => ({
  findTicketPartner: vi.fn(),
  findTicketForJoin: vi.fn(),
  findTicketForClose: vi.fn(),
  findTicketOwner: vi.fn(),
  findTicketParticipants: vi.fn(),
  findTicketForMessage: findTicketForMessageMock,
  findRecentClosedTickets: vi.fn(),
  findActiveTicketsForAgent: vi.fn(),
  findActiveTicketsForSupport: vi.fn(),
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

// ---- messageQueries mocks ----
//
// PR 4 of the messageLifecycle deepening (issue #50) deleted the absorbed
// mutation helpers from `messageQueries.ts`. Only the read-side helpers and
// the `markDelivered`/`markRead` writes (still used by the handler for the
// non-migrated `:delivered` / `:read` events) remain.
vi.mock('../../services/messageQueries.js', () => ({
  findTicketLabelIds: vi.fn(),
  findMessageForEdit: vi.fn(),
  findMessageForDelete: vi.fn(),
  markDelivered: vi.fn(),
  markRead: vi.fn(),
}));

vi.mock('../../db.js', () => ({
  query: vi.fn(),
  get: vi.fn(),
  run: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../../utils/redis.js', () => ({
  getRedisClients: vi.fn(() => ({ pubClient: null, subClient: null })),
}));

vi.mock('../../services/guards.js', () => ({
  runSyncGuards: vi.fn((text: string) => ({ ok: true, text })),
  guardRepetition: vi.fn(async () => null),
}));

vi.mock('../../services/linkPreview.js', () => ({
  unfurlLinks: vi.fn(async () => []),
}));

vi.mock('../../services/systemMessage.js', () => ({
  insertSystemMessage: vi.fn(async () => {}),
  insertWhisperMessage: vi.fn(async () => {}),
}));

vi.mock('../../services/transferService.js', () => ({
  findPartnerDepartments: vi.fn(),
  transferTicketToDepartment: vi.fn(),
}));


// ---- Socket & IO mocks ----

function createMockSocket(data: Record<string, any> = {}) {
  const rooms = new Set<string>();
  const emitted: Array<{ event: string; args: any[] }> = [];

  // Default `identified: true` matches what `socket:identify` sets in
  // production (`handlers/auth.ts`). `socketActor()` requires this flag,
  // and tests that explicitly check the unidentified path can still rely
  // on `requireIdentified` bailing first because they pass no userId.
  const socket: any = {
    id: 'socket-1',
    data: { identified: true, ...data },
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
  const toEmitMock = vi.fn();

  const io: any = {
    use: vi.fn(),
    on: vi.fn(),
    to: vi.fn(() => ({ emit: toEmitMock })),
    _toEmitMock: toEmitMock,
  };

  return io;
}

describe('message:send', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function setupMessageSend(socketData: Record<string, unknown> = {}) {
    const { register } = await import('./message.js');
    const io = createMockIo();

    const socket = createMockSocket({
      authedUserId: 'u1',
      authedIsPlatformOperator: false,
      tokenExp: Math.floor(Date.now() / 1000) + 3600,
      ...socketData,
    });

    // A minimal CommandBus stub. The real bus is exercised in
    // commandBus/messageBus.test.ts; here we only want to confirm the
    // handler-level guards (auth, parsing, rate limit) run BEFORE the bus
    // ever sees the command, and that bus output is forwarded back to the
    // socket via applyCommandResult.
    const busDispatch = vi.fn(async () => ({ effects: [] }));
    const ctx = {
      io,
      socketTickets: new Map<string, Set<string>>(),
      viewerKeyPrefix: 'ticket:viewers:',
      bus: { dispatch: busDispatch },
    };

    register(socket, ctx);

    const messageSendCall = socket.on.mock.calls.find(
      (c: [string, (...args: unknown[]) => void]) => c[0] === 'message:send',
    );
    return { socket, io, busDispatch, messageSendHandler: messageSendCall?.[1] };
  }

  it('rejects unidentified socket (no userId/partnerId set) — bus is never reached', async () => {
    const { socket, busDispatch, messageSendHandler } = await setupMessageSend();

    await messageSendHandler({ ticketId: 'ticket-1', text: 'hello' });

    expect(socket.emit).toHaveBeenCalledWith('error', {
      message: 'Not authenticated — call socket:identify first',
    });
    expect(busDispatch).not.toHaveBeenCalled();
  });

  it('hands the parsed command to the bus when the socket is identified', async () => {
    const { busDispatch, messageSendHandler } = await setupMessageSend({
      userId: 'u1',
      partnerId: 'partner-A',
      role: 'agent',
      name: 'Test User',
    });

    await messageSendHandler({ ticketId: 'ticket-1', text: 'hello' });

    expect(busDispatch).toHaveBeenCalledTimes(1);
    const [cmd, socketId] = busDispatch.mock.calls[0] as [{ type: string; ticketId: string; text: string }, string];
    expect(cmd.type).toBe('message:send');
    expect(cmd.ticketId).toBe('ticket-1');
    expect(cmd.text).toBe('hello');
    expect(socketId).toBe('socket-1');
  });

  // Cross-tenant rejection moved to commandBus/messageBus.test.ts — the
  // partner-scope check now lives inside the bus, not the handler.
});

// Mark findTicketForMessageMock as referenced — vi.mock above wires it but
// after the refactor the bus owns the scope check, so the mock object
// remains valid scaffolding for future bus tests in this file.
void findTicketForMessageMock;
