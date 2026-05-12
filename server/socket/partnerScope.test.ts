import { describe, it, expect, vi } from 'vitest';

// Minimal mock for ticketQueries
const findTicketPartnerMock = vi.fn();
vi.mock('../services/ticketQueries.js', () => ({
  findTicketPartner: (...args: unknown[]) => findTicketPartnerMock(...args),
}));
vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { requireActorTicketScope, requireActorTicketScopeWith } from './partnerScope.js';
import type { UserActor } from '../services/auth/types.js';

function mockSocket() {
  return {
    data: { identified: true },
    id: 'socket-1',
    emit: vi.fn(),
  } as unknown as Parameters<typeof requireActorTicketScope>[0];
}

function mockActor(partnerId: string): UserActor {
  return {
    kind: 'user',
    userId: 'u1',
    name: 'Test User',
    role: 'support',
    partnerId,
    isPlatformOperator: false,
    lang: 'en',
  };
}

describe('requireActorTicketScope', () => {
  it('returns the ticket when partnerId matches', async () => {
    findTicketPartnerMock.mockResolvedValue({ partnerId: 'p1' });
    const socket = mockSocket();

    const result = await requireActorTicketScope(socket, mockActor('p1'), 'ticket-1');

    expect(result).toEqual({ partnerId: 'p1' });
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('returns null and emits error when partnerId does not match', async () => {
    findTicketPartnerMock.mockResolvedValue({ partnerId: 'p2' });
    const socket = mockSocket();

    const result = await requireActorTicketScope(socket, mockActor('p1'), 'ticket-1');

    expect(result).toBeNull();
    expect(socket.emit).toHaveBeenCalledWith('error', { message: 'Not authorized' });
  });

  it('returns null when ticket does not exist', async () => {
    findTicketPartnerMock.mockResolvedValue(undefined);
    const socket = mockSocket();

    const result = await requireActorTicketScope(socket, mockActor('p1'), 'ticket-1');

    expect(result).toBeNull();
    expect(socket.emit).toHaveBeenCalledWith('error', { message: 'Not authorized' });
  });
});

describe('requireActorTicketScopeWith', () => {
  it('returns full query result when partnerId matches', async () => {
    const customQuery = vi.fn().mockResolvedValue({ partnerId: 'p1', status: 'open', supportId: 'u2' });
    const socket = mockSocket();

    const result = await requireActorTicketScopeWith(socket, mockActor('p1'), 'ticket-1', customQuery);

    expect(customQuery).toHaveBeenCalledWith('ticket-1');
    expect(result).toEqual({ partnerId: 'p1', status: 'open', supportId: 'u2' });
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('returns null and emits error when partnerId does not match', async () => {
    const customQuery = vi.fn().mockResolvedValue({ partnerId: 'p2', status: 'open' });
    const socket = mockSocket();

    const result = await requireActorTicketScopeWith(socket, mockActor('p1'), 'ticket-1', customQuery);

    expect(result).toBeNull();
    expect(socket.emit).toHaveBeenCalledWith('error', { message: 'Not authorized' });
  });

  it('returns null when query returns undefined', async () => {
    const customQuery = vi.fn().mockResolvedValue(undefined);
    const socket = mockSocket();

    const result = await requireActorTicketScopeWith(socket, mockActor('p1'), 'ticket-1', customQuery);

    expect(result).toBeNull();
    expect(socket.emit).toHaveBeenCalledWith('error', { message: 'Not authorized' });
  });
});
