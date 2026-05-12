/**
 * Boundary tests for the message-domain dispatch on the SocketCommandBus.
 *
 * Verifies the bus's contract: it loads scope, calls the lifecycle, and
 * returns a typed `CommandResult` without ever touching the socket. Tests
 * provide an in-memory MessageLifecycle stub + a minimal `io` shaped just
 * enough for the viewer-language read in `message:send`.
 *
 * What stays covered upstream:
 *   - Real lifecycle behavior:    services/messageLifecycle/*.test.ts (PGLite)
 *   - Handler-level parse/auth:   socket/handlers/message.test.ts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  findTicketPartnerMock: vi.fn(),
  findTicketForMessageMock: vi.fn(),
}));

vi.mock('../../services/ticketQueries.js', () => ({
  findTicketPartner: h.findTicketPartnerMock,
  findTicketForMessage: h.findTicketForMessageMock,
}));

vi.mock('../../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { dispatchMessageCommand } from './messageBus.js';
import type { SocketCommand } from './types.js';
import type { Server } from 'socket.io';
import type { MessageLifecycle } from '../../services/messageLifecycle/index.js';

function makeActor() {
  return {
    userId: 'u_a',
    partnerId: 'p_a',
    role: 'support' as const,
    name: 'Support',
    lang: 'en',
    isPlatformOperator: false,
  };
}

function makeIo(): Server {
  // Empty sockets map keeps the viewer-lang prewarm set empty — matches
  // the production behavior when no other socket is in the ticket room.
  return {
    sockets: { sockets: new Map() },
  } as unknown as Server;
}

function makeLifecycle(overrides: Partial<MessageLifecycle> = {}): MessageLifecycle {
  return {
    send: vi.fn(async () => ({ ok: true as const, effects: [] })),
    edit: vi.fn(async () => ({ ok: true as const, effects: [] })),
    delete: vi.fn(async () => ({ ok: true as const, effects: [] })),
    react: vi.fn(async () => ({ ok: true as const, effects: [] })),
    ...overrides,
  } as unknown as MessageLifecycle;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('messageBus — cross-tenant scope', () => {
  it('rejects message:send with Not authorized when ticket belongs to another partner', async () => {
    h.findTicketForMessageMock.mockResolvedValueOnce({ partnerId: 'p_other', status: 'open' });
    const lifecycle = makeLifecycle();

    const cmd: SocketCommand = {
      type: 'message:send',
      partnerId: 'p_a',
      actor: makeActor(),
      ticketId: 't1',
      text: 'cross-tenant',
    };

    const result = await dispatchMessageCommand({ messageLifecycle: lifecycle, io: makeIo() }, cmd, 'caller-1');

    expect(result.reply).toEqual({ event: 'error', payload: { message: 'Not authorized' } });
    expect(result.effects).toEqual([]);
    expect(lifecycle.send).not.toHaveBeenCalled();
  });

  it('rejects message:edit with Not authorized when ticket is in another partner', async () => {
    h.findTicketPartnerMock.mockResolvedValueOnce({ partnerId: 'p_other' });
    const lifecycle = makeLifecycle();

    const result = await dispatchMessageCommand(
      { messageLifecycle: lifecycle, io: makeIo() },
      { type: 'message:edit', partnerId: 'p_a', actor: makeActor(), ticketId: 't1', messageId: 'm1', newText: 'x' },
      'caller-1',
    );

    expect(result.reply).toEqual({ event: 'error', payload: { message: 'Not authorized' } });
    expect(lifecycle.edit).not.toHaveBeenCalled();
  });

  it('rejects message:delete with Not authorized for cross-tenant access', async () => {
    h.findTicketPartnerMock.mockResolvedValueOnce(null);
    const lifecycle = makeLifecycle();

    const result = await dispatchMessageCommand(
      { messageLifecycle: lifecycle, io: makeIo() },
      { type: 'message:delete', partnerId: 'p_a', actor: makeActor(), ticketId: 't1', messageId: 'm1' },
      'caller-1',
    );

    expect(result.reply).toEqual({ event: 'error', payload: { message: 'Not authorized' } });
    expect(lifecycle.delete).not.toHaveBeenCalled();
  });

  it('rejects message:react with Not authorized for cross-tenant access', async () => {
    h.findTicketPartnerMock.mockResolvedValueOnce({ partnerId: 'p_other' });
    const lifecycle = makeLifecycle();

    const result = await dispatchMessageCommand(
      { messageLifecycle: lifecycle, io: makeIo() },
      { type: 'message:react', partnerId: 'p_a', actor: makeActor(), ticketId: 't1', messageId: 'm1', emoji: '👍' },
      'caller-1',
    );

    expect(result.reply).toEqual({ event: 'error', payload: { message: 'Not authorized' } });
    expect(lifecycle.react).not.toHaveBeenCalled();
  });
});

describe('messageBus — message:send happy path', () => {
  it('forwards parsed payload to messageLifecycle.send and returns the effects', async () => {
    h.findTicketForMessageMock.mockResolvedValueOnce({ partnerId: 'p_a', status: 'open' });
    const lifecycle = makeLifecycle({
      send: vi.fn(async () => ({
        ok: true as const,
        effects: [{ type: 'emit', rooms: ['ticket:t1'], event: 'message:new', payload: { id: 'm1' } }],
      })),
    } as Partial<MessageLifecycle>);

    const result = await dispatchMessageCommand(
      { messageLifecycle: lifecycle, io: makeIo() },
      {
        type: 'message:send',
        partnerId: 'p_a',
        actor: makeActor(),
        ticketId: 't1',
        text: 'hi',
        whisper: false,
        replyToId: null,
        localId: 'local-1',
      },
      'caller-1',
    );

    expect(lifecycle.send).toHaveBeenCalledTimes(1);
    const arg = (lifecycle.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.ticketId).toBe('t1');
    expect(arg.partnerId).toBe('p_a');
    expect(arg.text).toBe('hi');
    expect(result.effects).toHaveLength(1);
    expect(result.reply).toBeUndefined();
  });

  it('treats a closed ticket as a silent no-op (legacy behavior)', async () => {
    h.findTicketForMessageMock.mockResolvedValueOnce({ partnerId: 'p_a', status: 'closed' });
    const lifecycle = makeLifecycle();

    const result = await dispatchMessageCommand(
      { messageLifecycle: lifecycle, io: makeIo() },
      { type: 'message:send', partnerId: 'p_a', actor: makeActor(), ticketId: 't1', text: 'hi' },
      'caller-1',
    );

    expect(result.reply).toEqual({ silent: true });
    expect(result.effects).toEqual([]);
    expect(lifecycle.send).not.toHaveBeenCalled();
  });
});

describe('messageBus — error code mapping', () => {
  it('message:send GUARD_REJECTED → message:rejected event with localId', async () => {
    h.findTicketForMessageMock.mockResolvedValueOnce({ partnerId: 'p_a', status: 'open' });
    const lifecycle = makeLifecycle({
      send: vi.fn(async () => ({ ok: false as const, code: 'GUARD_REJECTED' as const })),
    } as Partial<MessageLifecycle>);

    const result = await dispatchMessageCommand(
      { messageLifecycle: lifecycle, io: makeIo() },
      {
        type: 'message:send',
        partnerId: 'p_a',
        actor: makeActor(),
        ticketId: 't1',
        text: 'bad',
        localId: 'L1',
      },
      'caller-1',
    );

    expect(result.reply).toEqual({
      event: 'message:rejected',
      payload: { ticketId: 't1', localId: 'L1', code: 'GUARD_REJECTED' },
    });
    expect(result.effects).toEqual([]);
  });

  it('message:edit NOT_OWN_MESSAGE → error event with editor wording', async () => {
    h.findTicketPartnerMock.mockResolvedValueOnce({ partnerId: 'p_a' });
    const lifecycle = makeLifecycle({
      edit: vi.fn(async () => ({ ok: false as const, code: 'NOT_OWN_MESSAGE' as const })),
    } as Partial<MessageLifecycle>);

    const result = await dispatchMessageCommand(
      { messageLifecycle: lifecycle, io: makeIo() },
      { type: 'message:edit', partnerId: 'p_a', actor: makeActor(), ticketId: 't1', messageId: 'm1', newText: 'x' },
      'caller-1',
    );

    expect(result.reply).toEqual({ event: 'error', payload: { message: 'Can only edit your own messages' } });
  });

  it('message:react INVALID_REACTION → error event', async () => {
    h.findTicketPartnerMock.mockResolvedValueOnce({ partnerId: 'p_a' });
    const lifecycle = makeLifecycle({
      react: vi.fn(async () => ({ ok: false as const, code: 'INVALID_REACTION' as const })),
    } as Partial<MessageLifecycle>);

    const result = await dispatchMessageCommand(
      { messageLifecycle: lifecycle, io: makeIo() },
      { type: 'message:react', partnerId: 'p_a', actor: makeActor(), ticketId: 't1', messageId: 'm1', emoji: 'invalid' },
      'caller-1',
    );

    expect(result.reply).toEqual({ event: 'error', payload: { message: 'Invalid reaction emoji' } });
  });

  it('message:delete TICKET_NOT_FOUND → silent (legacy)', async () => {
    h.findTicketPartnerMock.mockResolvedValueOnce({ partnerId: 'p_a' });
    const lifecycle = makeLifecycle({
      delete: vi.fn(async () => ({ ok: false as const, code: 'TICKET_NOT_FOUND' as const })),
    } as Partial<MessageLifecycle>);

    const result = await dispatchMessageCommand(
      { messageLifecycle: lifecycle, io: makeIo() },
      { type: 'message:delete', partnerId: 'p_a', actor: makeActor(), ticketId: 't1', messageId: 'm1' },
      'caller-1',
    );

    expect(result.reply).toEqual({ silent: true });
  });
});

describe('messageBus — viewer-language collection', () => {
  it('collects langs from peers in the ticket room and excludes the caller', async () => {
    h.findTicketForMessageMock.mockResolvedValueOnce({ partnerId: 'p_a', status: 'open' });
    const lifecycle = makeLifecycle();

    // Three peers: one is the caller (excluded), two have langs, one peer
    // not in the room (excluded by room check).
    const sockets = new Map<string, { id: string; rooms: Set<string>; data: { lang?: string } }>([
      ['caller-1', { id: 'caller-1', rooms: new Set(['ticket:t1']), data: { lang: 'en' } }], // excluded by id
      ['peer-2', { id: 'peer-2', rooms: new Set(['ticket:t1']), data: { lang: 'fr' } }],
      ['peer-3', { id: 'peer-3', rooms: new Set(['ticket:t1']), data: { lang: 'nl' } }],
      ['peer-4', { id: 'peer-4', rooms: new Set(['ticket:t2']), data: { lang: 'de' } }], // wrong room
    ]);
    const io = { sockets: { sockets } } as unknown as Server;

    await dispatchMessageCommand(
      { messageLifecycle: lifecycle, io },
      { type: 'message:send', partnerId: 'p_a', actor: makeActor(), ticketId: 't1', text: 'hi' },
      'caller-1',
    );

    const arg = (lifecycle.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const langs = arg.viewerLangs as Set<string>;
    expect(langs).toBeInstanceOf(Set);
    expect([...langs].sort()).toEqual(['fr', 'nl']);
  });
});
