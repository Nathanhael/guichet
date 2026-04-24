/**
 * Behavioural tests for services/membership.ts.
 *
 * assertMembership invariants:
 *  1. Platform operators short-circuit — no DB hit required.
 *  2. Users with a membership row for the given (userId, partnerId) pass silently.
 *  3. Users without a membership row are rejected with TRPCError FORBIDDEN.
 *
 * loadTicketForUser invariants:
 *  1. Throws NOT_FOUND when the ticket row does not exist.
 *  2. Throws FORBIDDEN when ticket.partnerId !== ctx.user.partnerId.
 *  3. Platform operators follow the same rule — no bypass.
 *  4. Returns the full ticket row when tenant matches.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TRPCError } from '@trpc/server';

const { limitMock, whereMock, fromMock, selectMock } = vi.hoisted(() => {
  const limitMock = vi.fn();
  const whereMock = vi.fn(() => ({ limit: limitMock }));
  const fromMock = vi.fn(() => ({ where: whereMock }));
  const selectMock = vi.fn(() => ({ from: fromMock }));
  return { limitMock, whereMock, fromMock, selectMock };
});

vi.mock('../../db.js', () => ({
  db: { select: selectMock },
}));

vi.mock('../../db/schema.js', () => ({
  memberships: {
    userId: { name: 'userId' },
    partnerId: { name: 'partnerId' },
  },
  tickets: {
    id: { name: 'id' },
  },
}));

import { assertMembership, loadTicketForUser } from '../membership.js';

describe('assertMembership', () => {
  beforeEach(() => {
    selectMock.mockClear();
    fromMock.mockClear();
    whereMock.mockClear();
    limitMock.mockReset();
  });

  it('returns void without querying DB when caller is a platform operator', async () => {
    await expect(
      assertMembership('user-1', 'partner-1', true),
    ).resolves.toBeUndefined();
    expect(selectMock).not.toHaveBeenCalled();
  });

  it('returns void when a membership row exists for (userId, partnerId)', async () => {
    limitMock.mockResolvedValueOnce([{ userId: 'user-1', partnerId: 'partner-1' }]);
    await expect(
      assertMembership('user-1', 'partner-1', false),
    ).resolves.toBeUndefined();
    expect(selectMock).toHaveBeenCalledTimes(1);
  });

  it('throws TRPCError FORBIDDEN when no membership row exists', async () => {
    limitMock.mockResolvedValueOnce([]);
    await expect(
      assertMembership('user-1', 'partner-1', false),
    ).rejects.toMatchObject({
      name: 'TRPCError',
      code: 'FORBIDDEN',
    });
  });

  it('thrown error is an instance of TRPCError', async () => {
    limitMock.mockResolvedValueOnce([]);
    let caught: unknown;
    try {
      await assertMembership('user-1', 'partner-1', false);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(TRPCError);
  });
});

describe('loadTicketForUser', () => {
  beforeEach(() => {
    selectMock.mockClear();
    fromMock.mockClear();
    whereMock.mockClear();
    limitMock.mockReset();
  });

  const ctx = (overrides: Partial<{ partnerId: string; isPlatformOperator: boolean }> = {}) => ({
    user: {
      id: 'user-1',
      partnerId: overrides.partnerId ?? 'partner-a',
      isPlatformOperator: overrides.isPlatformOperator ?? false,
    },
  });

  it('throws NOT_FOUND when the ticket row does not exist', async () => {
    limitMock.mockResolvedValueOnce([]);
    await expect(loadTicketForUser('ticket-missing', ctx())).rejects.toMatchObject({
      name: 'TRPCError',
      code: 'NOT_FOUND',
    });
  });

  it('throws FORBIDDEN when ticket belongs to a different partner', async () => {
    limitMock.mockResolvedValueOnce([{ id: 'ticket-1', partnerId: 'partner-b' }]);
    await expect(loadTicketForUser('ticket-1', ctx({ partnerId: 'partner-a' }))).rejects.toMatchObject({
      name: 'TRPCError',
      code: 'FORBIDDEN',
    });
  });

  it('throws FORBIDDEN even for platform operators when partner does not match (no bypass)', async () => {
    limitMock.mockResolvedValueOnce([{ id: 'ticket-1', partnerId: 'partner-b' }]);
    await expect(
      loadTicketForUser('ticket-1', ctx({ partnerId: 'partner-a', isPlatformOperator: true })),
    ).rejects.toMatchObject({
      name: 'TRPCError',
      code: 'FORBIDDEN',
    });
  });

  it('returns the full ticket row when partner matches', async () => {
    const row = { id: 'ticket-1', partnerId: 'partner-a', agentId: 'u-2', dept: 'billing' };
    limitMock.mockResolvedValueOnce([row]);
    const result = await loadTicketForUser('ticket-1', ctx({ partnerId: 'partner-a' }));
    expect(result).toEqual(row);
  });
});
