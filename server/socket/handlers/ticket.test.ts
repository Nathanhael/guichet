/**
 * Behavioral tests for `ticket:labels:update` — capability gating.
 *
 * Bundle A slice 4 (issue #69) replaces the hardcoded
 *   LABEL_ROLES = ['support', 'admin', 'platform_operator']
 * array with `assertCan(actor, 'use_support_workflows')`, closing silent
 * drift between the socket and tRPC implementations of the same rule. The
 * tests below pin the contract:
 *   - agent role is rejected
 *   - support / admin roles are allowed (existing behavior)
 *   - platform operators (role='agent' + isPlatformOperator=true) are allowed —
 *     the legacy array compared the role STRING against 'platform_operator',
 *     which was never set there, so operators were silently rejected; the
 *     capability vocabulary fixes this.
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

vi.mock('../../services/userQueries.js', () => ({
  findUserName: vi.fn(),
  findSenderInfo: vi.fn(),
  findUserById: vi.fn(),
}));

vi.mock('../../services/partnerQueries.js', () => ({
  findPartnerConfig: vi.fn(),
}));

vi.mock('../../services/businessHours.js', () => ({
  getBusinessHoursStatus: vi.fn(() => ({ isOpen: true, message: 'Open' })),
  broadcastQueuePositions: vi.fn(),
  broadcastAgentStatus: vi.fn(),
}));

const findTicketPartnerMock = vi.fn();
const findPartnerLabelsMock = vi.fn();
const replaceTicketLabelsMock = vi.fn();

vi.mock('../../services/ticketQueries.js', () => ({
  findTicketPartner: findTicketPartnerMock,
  findTicketForJoin: vi.fn(),
  findTicketForClose: vi.fn(),
  findTicketOwner: vi.fn(),
  findTicketParticipants: vi.fn(),
  findTicketForTransfer: vi.fn(),
  findPartnerLabels: findPartnerLabelsMock,
  replaceTicketLabels: replaceTicketLabelsMock,
  createTicket: vi.fn(),
  assignSupport: vi.fn(),
  findUpdatedParticipants: vi.fn(),
  updateParticipants: vi.fn(),
  closeTicket: vi.fn(),
  updateTicketSla: vi.fn(),
  transferTicket: vi.fn(),
  returnTicketToQueue: vi.fn(),
  insertRating: vi.fn(),
}));

vi.mock('../../services/transferService.js', () => ({
  findPartnerDepartments: vi.fn(),
  transferTicketToDepartment: vi.fn(),
}));

vi.mock('../../services/systemMessage.js', () => ({
  insertSystemMessage: vi.fn(async () => {}),
  insertWhisperMessage: vi.fn(async () => {}),
}));

vi.mock('../../services/webhookDispatch.js', () => ({
  dispatchWebhookEvent: vi.fn(async () => {}),
}));

vi.mock('../../services/sla.js', () => ({
  parseSlaConfig: vi.fn(() => null),
  getEffectiveSla: vi.fn(() => ({ responseMs: 180000, resolutionMs: 3600000 })),
  calculateSlaDueDate: vi.fn(() => new Date()),
}));

vi.mock('../../services/ai/index.js', () => ({}));

vi.mock('../../utils/redis.js', () => ({
  getRedisClients: vi.fn(() => ({ pubClient: null, subClient: null })),
}));

vi.mock('../../db.js', () => ({
  query: vi.fn(),
  get: vi.fn(),
  run: vi.fn(),
  transaction: vi.fn(),
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

function createMockIo() {
  const io: unknown = {
    use: vi.fn(),
    on: vi.fn(),
    to: vi.fn(() => ({ emit: vi.fn() })),
  };
  return io;
}

async function setupLabelsHandler(actorOverrides: Record<string, unknown>) {
  const { register } = await import('./ticket.js');
  const io = createMockIo();
  const socket = createMockSocket({
    userId: 'u1',
    partnerId: 'p1',
    role: 'agent',
    name: 'Test User',
    isPlatformOperator: false,
    lang: 'en',
    tokenExp: Math.floor(Date.now() / 1000) + 3600,
    ...actorOverrides,
  });
  // ctx shape required by register()
  register(socket as any, { io, socketTickets: new Map(), viewerKeyPrefix: 'ticket:viewers:' } as any);
  const call = socket.on.mock.calls.find((c) => (c as unknown[])[0] === 'ticket:labels:update');
  return { socket, handler: call?.[1] as ((data: unknown) => Promise<void>) | undefined };
}

describe('ticket:labels:update — capability gating (slice #69)', () => {
  beforeEach(() => {
    findTicketPartnerMock.mockReset();
    findPartnerLabelsMock.mockReset();
    replaceTicketLabelsMock.mockReset();
  });

  it('rejects role=agent (no support workflows)', async () => {
    const { socket, handler } = await setupLabelsHandler({ role: 'agent', isPlatformOperator: false });
    expect(handler).toBeDefined();
    await handler!({ ticketId: 't1', labels: ['l1'] });
    expect(socket.emit).toHaveBeenCalledWith('error', { message: 'Not authorized to update labels' });
    expect(replaceTicketLabelsMock).not.toHaveBeenCalled();
  });

  it('allows role=support', async () => {
    findTicketPartnerMock.mockResolvedValue({ partnerId: 'p1' });
    findPartnerLabelsMock.mockResolvedValue([{ id: 'l1' }]);
    const { socket, handler } = await setupLabelsHandler({ role: 'support', isPlatformOperator: false });
    await handler!({ ticketId: 't1', labels: ['l1'] });
    expect(socket.emit).not.toHaveBeenCalledWith('error', { message: 'Not authorized to update labels' });
    expect(replaceTicketLabelsMock).toHaveBeenCalledWith('t1', ['l1']);
  });

  it('allows role=admin', async () => {
    findTicketPartnerMock.mockResolvedValue({ partnerId: 'p1' });
    findPartnerLabelsMock.mockResolvedValue([{ id: 'l1' }]);
    const { socket, handler } = await setupLabelsHandler({ role: 'admin', isPlatformOperator: false });
    await handler!({ ticketId: 't1', labels: ['l1'] });
    expect(socket.emit).not.toHaveBeenCalledWith('error', { message: 'Not authorized to update labels' });
    expect(replaceTicketLabelsMock).toHaveBeenCalledWith('t1', ['l1']);
  });

  it('allows platform operator (role=agent + isPlatformOperator=true) via operator bypass', async () => {
    findTicketPartnerMock.mockResolvedValue({ partnerId: 'p1' });
    findPartnerLabelsMock.mockResolvedValue([{ id: 'l1' }]);
    const { socket, handler } = await setupLabelsHandler({ role: 'agent', isPlatformOperator: true });
    await handler!({ ticketId: 't1', labels: ['l1'] });
    // Pre-slice-#69, the legacy LABEL_ROLES array compared role==='platform_operator'
    // (a string never set on socket.data.role), so operators were silently rejected.
    // Capability rules give them workflow access.
    expect(socket.emit).not.toHaveBeenCalledWith('error', { message: 'Not authorized to update labels' });
    expect(replaceTicketLabelsMock).toHaveBeenCalledWith('t1', ['l1']);
  });
});
