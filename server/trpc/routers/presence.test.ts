/**
 * Behavior test for presence.getOnlineStatus after dropping `partnerId` from
 * the input schema. The endpoint must:
 *   1. Accept input of shape { userId } (no partnerId field).
 *   2. Call availability.isOnline with the JWT's partnerId — not a
 *      client-supplied value.
 *   3. Reject callers whose JWT has no partnerId (partnerScopedProcedure).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { isOnlineMock, setStatusMock } = vi.hoisted(() => ({
  isOnlineMock: vi.fn(),
  setStatusMock: vi.fn(),
}));

vi.mock('../../services/availability/instance.js', () => ({
  getAvailability: () => ({
    isOnline: isOnlineMock,
    setStatus: setStatusMock,
  }),
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
    isOnlineMock.mockReset();
    isOnlineMock.mockResolvedValue(false);
  });

  it('accepts input with only { userId } (no partnerId field required)', async () => {
    const caller = appRouter.createCaller({ user: makeUser() } as unknown as CallerCtx);
    await expect(caller.presence.getOnlineStatus({ userId: 'target' } as { userId: string })).resolves.toEqual({
      online: false,
    });
  });

  it('queries availability service using ctx.user.partnerId (JWT), ignoring any input.partnerId', async () => {
    const caller = appRouter.createCaller({
      user: makeUser({ partnerId: 'partner-a' }),
    } as unknown as CallerCtx);
    await caller.presence.getOnlineStatus({ userId: 'target' } as { userId: string });
    expect(isOnlineMock).toHaveBeenCalledWith('target', 'partner-a');
  });

  it('returns online=true when availability reports the target online', async () => {
    isOnlineMock.mockResolvedValueOnce(true);
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
