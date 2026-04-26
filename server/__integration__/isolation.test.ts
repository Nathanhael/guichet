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

// ---- userQueries mocks ----
const findUserByIdMock = vi.fn();
const findMembershipMock = vi.fn();
const findSenderInfoMock = vi.fn();
const findUserNameMock = vi.fn();
const findTargetSupportMock = vi.fn();

vi.mock('../services/userQueries.js', () => ({
  findUserById: findUserByIdMock,
  findMembership: findMembershipMock,
  findSenderInfo: findSenderInfoMock,
  findUserName: findUserNameMock,
  findTargetSupport: findTargetSupportMock,
}));

const findPartnerConfigMock = vi.fn();

vi.mock('../services/partnerQueries.js', () => ({
  findPartnerConfig: findPartnerConfigMock,
}));

// ---- ticketQueries mocks ----
const findTicketPartnerMock = vi.fn();
const findTicketForJoinMock = vi.fn();
const findTicketForCloseMock = vi.fn();
const findTicketOwnerMock = vi.fn();
const findTicketParticipantsMock = vi.fn();
const findTicketForMessageMock = vi.fn();
const findRecentClosedTicketsMock = vi.fn();
const findActiveTicketsForAgentMock = vi.fn();
const findActiveTicketsForSupportMock = vi.fn();
const findTicketForTransferMock = vi.fn();
const findPartnerLabelsMock = vi.fn();
const createTicketMock = vi.fn();
const assignSupportMock = vi.fn();
const findUpdatedParticipantsMock = vi.fn();
const updateParticipantsMock = vi.fn();
const closeTicketMock = vi.fn();
const updateTicketSlaMock = vi.fn();
const transferTicketMock = vi.fn();
const returnTicketToQueueMock = vi.fn();
const replaceTicketLabelsMock = vi.fn();
const insertRatingMock = vi.fn();

vi.mock('../services/ticketQueries.js', () => ({
  findTicketPartner: findTicketPartnerMock,
  findTicketForJoin: findTicketForJoinMock,
  findTicketForClose: findTicketForCloseMock,
  findTicketOwner: findTicketOwnerMock,
  findTicketParticipants: findTicketParticipantsMock,
  findTicketForMessage: findTicketForMessageMock,
  findRecentClosedTickets: findRecentClosedTicketsMock,
  findActiveTicketsForAgent: findActiveTicketsForAgentMock,
  findActiveTicketsForSupport: findActiveTicketsForSupportMock,
  findTicketForTransfer: findTicketForTransferMock,
  findPartnerLabels: findPartnerLabelsMock,
  createTicket: createTicketMock,
  assignSupport: assignSupportMock,
  findUpdatedParticipants: findUpdatedParticipantsMock,
  updateParticipants: updateParticipantsMock,
  closeTicket: closeTicketMock,
  updateTicketSla: updateTicketSlaMock,
  transferTicket: transferTicketMock,
  returnTicketToQueue: returnTicketToQueueMock,
  replaceTicketLabels: replaceTicketLabelsMock,
  insertRating: insertRatingMock,
}));

// ---- messageQueries mocks ----
// Side-effect spies for the partner-scope assertion: each one must NOT be
// called when the cross-tenant guard fires. The remaining names are
// shape-completeness stubs so module imports don't trip on undefined.
const findTicketMessagesPaginatedMock = vi.fn();
const findMessageForEditMock = vi.fn();
const findMessageForDeleteMock = vi.fn();
const findMessageForReactMock = vi.fn();
const updateMessageTextMock = vi.fn();
const updateMessageReactionsMock = vi.fn();
const softDeleteMessageMock = vi.fn();
const markDeliveredMock = vi.fn();
const markReadMock = vi.fn();

vi.mock('../services/messageQueries.js', () => ({
  findTicketMessagesPaginated: findTicketMessagesPaginatedMock,
  findMessageForEdit: findMessageForEditMock,
  findMessageForDelete: findMessageForDeleteMock,
  findMessageForReact: findMessageForReactMock,
  updateMessageText: updateMessageTextMock,
  updateMessageReactions: updateMessageReactionsMock,
  softDeleteMessage: softDeleteMessageMock,
  markDelivered: markDeliveredMock,
  markRead: markReadMock,
  insertMessage: vi.fn(),
  resolveReplySnippet: vi.fn(),
  updateMessageLinkPreviews: vi.fn(),
}));

vi.mock('../config.js', () => ({
  default: {
    JWT_SECRET: 'test-secret-key-only-for-unit-tests-padding-to-reach-sixty-four-c!',
  },
}));

vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../utils/metrics.js', () => ({
  socketioConnectionsActive: { inc: vi.fn(), dec: vi.fn() },
  socketioEventsTotal: { inc: vi.fn() },
  crossLangPickupTotal: { inc: vi.fn() },
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
    findUserByIdMock.mockReset();
    findMembershipMock.mockReset();
    findSenderInfoMock.mockReset();
    findUserNameMock.mockReset();
    findTargetSupportMock.mockReset();
    findPartnerConfigMock.mockReset();
    findTicketPartnerMock.mockReset();
    findTicketForJoinMock.mockReset();
    findTicketForCloseMock.mockReset();
    findTicketOwnerMock.mockReset();
    findTicketParticipantsMock.mockReset();
    findTicketForMessageMock.mockReset();
    findRecentClosedTicketsMock.mockReset();
    findActiveTicketsForAgentMock.mockReset();
    findActiveTicketsForSupportMock.mockReset();
    findTicketForTransferMock.mockReset();
    findPartnerLabelsMock.mockReset();
    createTicketMock.mockReset();
    assignSupportMock.mockReset();
    findUpdatedParticipantsMock.mockReset();
    updateParticipantsMock.mockReset();
    closeTicketMock.mockReset();
    updateTicketSlaMock.mockReset();
    transferTicketMock.mockReset();
    returnTicketToQueueMock.mockReset();
    replaceTicketLabelsMock.mockReset();
    insertRatingMock.mockReset();
    findTicketMessagesPaginatedMock.mockReset();
    findMessageForEditMock.mockReset();
    findMessageForDeleteMock.mockReset();
    findMessageForReactMock.mockReset();
    updateMessageTextMock.mockReset();
    updateMessageReactionsMock.mockReset();
    softDeleteMessageMock.mockReset();
    markDeliveredMock.mockReset();
    markReadMock.mockReset();
    selectQueue.length = 0;
    insertValuesMock.mockReset();
    insertValuesMock.mockResolvedValue(undefined);
    updateWhereMock.mockReset();
    updateWhereMock.mockResolvedValue(undefined);

    const { registerSocketHandlers } = await import('../socket/handlers.js');
    io = createMockIo();
    // Lifecycle isn't exercised by these integration tests (they cover
    // partner-scope guards, not lifecycle ops). A stub keeps the wiring
    // honest without dragging the lifecycle module into the mock graph.
    const stubLifecycle = { reclaim: async () => ({ ok: false, code: 'TICKET_NOT_FOUND' as const }) };
    registerSocketHandlers(io, { lifecycle: stubLifecycle as never });
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
    findTicketForJoinMock.mockResolvedValueOnce({
      id: 'ticket-1',
      partnerId: 'partner-B',
      status: 'open',
      supportId: null,
      supportName: null,
      supportLang: null,
      supportJoinedAt: null,
      participants: [],
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
    findTicketForMessageMock.mockResolvedValueOnce({ partnerId: 'partner-B', status: 'active' });

    await sendHandler({
      ticketId: 'ticket-1',
      senderId: 'support-1',
      text: 'Hello from wrong partner',
    });

    expect(socket.emit).toHaveBeenCalledWith('error', expect.objectContaining({
      message: expect.stringContaining('Not authorized'),
    }));
  });

  it('ticket:close rejects closing a ticket in a different partner', async () => {
    const socket = createMockSocket({
      userId: 'support-1',
      partnerId: 'partner-A',
      role: 'support',
      name: 'Support A',
      authedUserId: 'support-1',
      tokenExp: Math.floor(Date.now() / 1000) + 3600,
      isSupport: true,
    });

    io._connectionHandlers[0](socket);
    const closeHandler = getHandler(socket, 'ticket:close');

    // Ticket belongs to partner-B
    findTicketForCloseMock.mockResolvedValueOnce({
      partnerId: 'partner-B',
      status: 'active',
    });

    await closeHandler({ ticketId: 'ticket-1' });

    expect(socket.emit).toHaveBeenCalledWith('error', expect.objectContaining({
      message: expect.stringContaining('Not authorized'),
    }));
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
    findTicketPartnerMock.mockResolvedValueOnce({ partnerId: 'partner-B' });

    await labelsHandler({ ticketId: 'ticket-1', labels: ['label-1'] });

    expect(socket.emit).toHaveBeenCalledWith('error', expect.objectContaining({
      message: expect.stringContaining('Not authorized'),
    }));
  });

  // ── message:* cross-tenant rejection ─────────────────────────────────────
  // Each test mocks findTicketPartner (called by requirePartnerScope) to
  // return a ticket on partner-B while the socket lives on partner-A. The
  // assertion shape is identical: error emit + side-effect mock NOT called.
  // A dropped guard would skip past requirePartnerScope and reach the
  // side-effect, failing the second expect.

  it('message:loadMore rejects loading messages from a cross-partner ticket', async () => {
    const socket = createMockSocket({
      userId: 'support-1',
      partnerId: 'partner-A',
      role: 'support',
      name: 'Support A',
      authedUserId: 'support-1',
      tokenExp: Math.floor(Date.now() / 1000) + 3600,
    });

    io._connectionHandlers[0](socket);
    const handler = getHandler(socket, 'message:loadMore');

    findTicketPartnerMock.mockResolvedValueOnce({ partnerId: 'partner-B' });

    await handler({ ticketId: 'ticket-1', cursor: 'msg-100' });

    expect(socket.emit).toHaveBeenCalledWith('error', expect.objectContaining({
      message: expect.stringContaining('Not authorized'),
    }));
    expect(findTicketMessagesPaginatedMock).not.toHaveBeenCalled();
  });

  it('message:delivered rejects marking a cross-partner message as delivered', async () => {
    const socket = createMockSocket({
      userId: 'support-1',
      partnerId: 'partner-A',
      role: 'support',
      name: 'Support A',
      authedUserId: 'support-1',
      tokenExp: Math.floor(Date.now() / 1000) + 3600,
    });

    io._connectionHandlers[0](socket);
    const handler = getHandler(socket, 'message:delivered');

    findTicketPartnerMock.mockResolvedValueOnce({ partnerId: 'partner-B' });

    await handler({ ticketId: 'ticket-1', messageId: 'msg-1' });

    expect(socket.emit).toHaveBeenCalledWith('error', expect.objectContaining({
      message: expect.stringContaining('Not authorized'),
    }));
    expect(markDeliveredMock).not.toHaveBeenCalled();
  });

  it('message:read rejects marking cross-partner messages as read', async () => {
    const socket = createMockSocket({
      userId: 'support-1',
      partnerId: 'partner-A',
      role: 'support',
      name: 'Support A',
      authedUserId: 'support-1',
      tokenExp: Math.floor(Date.now() / 1000) + 3600,
    });

    io._connectionHandlers[0](socket);
    const handler = getHandler(socket, 'message:read');

    findTicketPartnerMock.mockResolvedValueOnce({ partnerId: 'partner-B' });

    await handler({ ticketId: 'ticket-1', messageIds: ['msg-1', 'msg-2'] });

    expect(socket.emit).toHaveBeenCalledWith('error', expect.objectContaining({
      message: expect.stringContaining('Not authorized'),
    }));
    expect(markReadMock).not.toHaveBeenCalled();
  });

  it('message:edit rejects editing a message on a cross-partner ticket', async () => {
    const socket = createMockSocket({
      userId: 'support-1',
      partnerId: 'partner-A',
      role: 'support',
      name: 'Support A',
      authedUserId: 'support-1',
      tokenExp: Math.floor(Date.now() / 1000) + 3600,
    });

    io._connectionHandlers[0](socket);
    const handler = getHandler(socket, 'message:edit');

    findTicketPartnerMock.mockResolvedValueOnce({ partnerId: 'partner-B' });

    await handler({ ticketId: 'ticket-1', messageId: 'msg-1', text: 'edited' });

    expect(socket.emit).toHaveBeenCalledWith('error', expect.objectContaining({
      message: expect.stringContaining('Not authorized'),
    }));
    // Assert on the lookup (the FIRST DB call after the guard), not on
    // updateMessageText: an unmocked findMessageForEdit returns undefined
    // and the handler short-circuits on `if (!msg) return`, so a dropped
    // guard would still leave updateMessageText untouched and give a
    // false-pass. The lookup, by contrast, is reached if and only if the
    // guard was bypassed.
    expect(findMessageForEditMock).not.toHaveBeenCalled();
    expect(updateMessageTextMock).not.toHaveBeenCalled();
  });

  it('message:delete rejects deleting a message on a cross-partner ticket', async () => {
    const socket = createMockSocket({
      userId: 'support-1',
      partnerId: 'partner-A',
      role: 'support',
      name: 'Support A',
      authedUserId: 'support-1',
      tokenExp: Math.floor(Date.now() / 1000) + 3600,
      isSupport: true,
    });

    io._connectionHandlers[0](socket);
    const handler = getHandler(socket, 'message:delete');

    findTicketPartnerMock.mockResolvedValueOnce({ partnerId: 'partner-B' });

    await handler({ ticketId: 'ticket-1', messageId: 'msg-1' });

    expect(socket.emit).toHaveBeenCalledWith('error', expect.objectContaining({
      message: expect.stringContaining('Not authorized'),
    }));
    // Lookup-not-called is the dropped-guard tripwire (see message:edit).
    expect(findMessageForDeleteMock).not.toHaveBeenCalled();
    expect(softDeleteMessageMock).not.toHaveBeenCalled();
  });

  it('message:react rejects reacting to a message on a cross-partner ticket', async () => {
    const socket = createMockSocket({
      userId: 'support-1',
      partnerId: 'partner-A',
      role: 'support',
      name: 'Support A',
      authedUserId: 'support-1',
      tokenExp: Math.floor(Date.now() / 1000) + 3600,
    });

    io._connectionHandlers[0](socket);
    const handler = getHandler(socket, 'message:react');

    findTicketPartnerMock.mockResolvedValueOnce({ partnerId: 'partner-B' });

    // '👍' is in REACTION_EMOJIS so the emoji-allowlist check passes and
    // execution reaches the partner-scope guard rather than short-circuiting
    // on an invalid-emoji error (which would mask a regression here).
    await handler({ ticketId: 'ticket-1', messageId: 'msg-1', emoji: '👍' });

    expect(socket.emit).toHaveBeenCalledWith('error', expect.objectContaining({
      message: expect.stringContaining('Not authorized'),
    }));
    // Lookup-not-called is the dropped-guard tripwire (see message:edit).
    expect(findMessageForReactMock).not.toHaveBeenCalled();
    expect(updateMessageReactionsMock).not.toHaveBeenCalled();
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
    findUserByIdMock.mockResolvedValueOnce({ name: 'User 1', isPlatformOperator: false }); // user lookup
    findMembershipMock.mockResolvedValueOnce(undefined); // no membership

    await identifyHandler({ partnerId: 'partner-X' });

    // Security assertion: must not join the partner room + must
    // disconnect. The event name changed from 'error' to 'auth:expired'
    // so the client auto-refreshes rather than showing a generic red
    // toast. The cross-tenant protection itself is unchanged.
    expect(socket.emit).toHaveBeenCalledWith(
      'auth:expired',
      expect.objectContaining({ message: expect.any(String) }),
    );
    expect(socket.disconnect).toHaveBeenCalled();
    expect(socket.join).not.toHaveBeenCalledWith('partner:partner-X');
  });
});
