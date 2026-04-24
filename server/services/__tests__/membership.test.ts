/**
 * Behavioural tests for services/membership.ts.
 *
 * assertMembership invariants:
 *  1. Platform operators short-circuit — no DB hit required.
 *  2. Users with a membership row for the given (userId, partnerId) pass silently.
 *  3. Users without a membership row are rejected with TRPCError FORBIDDEN.
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
}));

import { assertMembership } from '../membership.js';

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
