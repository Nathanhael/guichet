import { describe, it, expect, vi } from 'vitest';

// Minimal mock for ticketQueries
const findTicketPartnerMock = vi.fn();
vi.mock('../../services/ticketQueries.js', () => ({
  findTicketPartner: (...args: unknown[]) => findTicketPartnerMock(...args),
}));
vi.mock('../../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { requirePartnerScope } from '../partnerScope.js';

function mockSocket(partnerId: string) {
  return {
    data: { partnerId, userId: 'u1' },
    id: 'socket-1',
    emit: vi.fn(),
  } as any;
}

describe('requirePartnerScope', () => {
  it('returns the ticket when partnerId matches', async () => {
    findTicketPartnerMock.mockResolvedValue({ partnerId: 'p1' });
    const socket = mockSocket('p1');

    const result = await requirePartnerScope(socket, 'ticket-1');

    expect(result).toEqual({ partnerId: 'p1' });
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('returns null and emits error when partnerId does not match', async () => {
    findTicketPartnerMock.mockResolvedValue({ partnerId: 'p2' });
    const socket = mockSocket('p1');

    const result = await requirePartnerScope(socket, 'ticket-1');

    expect(result).toBeNull();
    expect(socket.emit).toHaveBeenCalledWith('error', { message: 'Not authorized' });
  });

  it('returns null when ticket does not exist', async () => {
    findTicketPartnerMock.mockResolvedValue(undefined);
    const socket = mockSocket('p1');

    const result = await requirePartnerScope(socket, 'ticket-1');

    expect(result).toBeNull();
    expect(socket.emit).toHaveBeenCalledWith('error', { message: 'Not authorized' });
  });
});
