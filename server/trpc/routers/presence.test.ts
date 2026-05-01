/**
 * Behavior test for presence.getOnlineStatus after dropping `partnerId` from
 * the input schema. The endpoint must:
 *   1. Accept input of shape { userId } (no partnerId field).
 *   2. Call availability.advanced.onlineUsers with the JWT's partnerId
 *      — not a client-supplied value.
 *   3. Reject callers whose JWT has no partnerId (partnerScopedProcedure).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAvailability } = vi.hoisted(() => ({
  mockAvailability: {
    advanced: {
      onlineUsers: vi.fn().mockResolvedValue([]),
      getStatus: vi.fn().mockResolvedValue(null),
    },
    setStatus: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../services/availability/index.js', () => ({
  getAvailability: () => mockAvailability,
}));

import { appRouter } from '../router.js';

type CallerCtx = Parameters<typeof appRouter.createCaller>[0];

const makeUser = (overrides: Record<string, unknown> = {}) => ({
  id: 'caller-id',
  name: 'Caller',
  email: 'caller@test',
  role: 'support',
  partnerId: 'partner-a',
  isPlatformOperator: false,
  isExternal: false,
  lang: 'en',
  ...overrides,
});

describe('presence.getOnlineStatus', () => {
  beforeEach(() => {
    mockAvailability.advanced.onlineUsers.mockReset();
    mockAvailability.advanced.onlineUsers.mockResolvedValue([]);
  });

  it('accepts input with only { userId } (no partnerId field required)', async () => {
    const caller = appRouter.createCaller({ user: makeUser() } as unknown as CallerCtx);
    await expect(caller.presence.getOnlineStatus({ userId: 'target' } as { userId: string })).resolves.toEqual({
      online: false,
    });
  });

  it('queries presence service using ctx.user.partnerId (JWT), ignoring any input.partnerId', async () => {
    const caller = appRouter.createCaller({
      user: makeUser({ partnerId: 'partner-a' }),
    } as unknown as CallerCtx);
    await caller.presence.getOnlineStatus({ userId: 'target' } as { userId: string });
    expect(mockAvailability.advanced.onlineUsers).toHaveBeenCalledWith('partner-a');
  });

  it('returns online=true when the target user is in the JWT partner online set', async () => {
    mockAvailability.advanced.onlineUsers.mockResolvedValueOnce([{ userId: 'target', role: 'support' }]);
    const caller = appRouter.createCaller({ user: makeUser() } as unknown as CallerCtx);
    const result = await caller.presence.getOnlineStatus({ userId: 'target' } as { userId: string });
    expect(result).toEqual({ online: true });
  });

  it('rejects callers whose JWT has no partnerId (partnerScopedProcedure guard)', async () => {
    const caller = appRouter.createCaller({
      user: makeUser({ partnerId: null, isPlatformOperator: true }),
    } as unknown as CallerCtx);
    await expect(
      caller.presence.getOnlineStatus({ userId: 'target' } as { userId: string }),
    ).rejects.toThrow(/BAD_REQUEST|No active partner/i);
  });
});
