import { beforeEach, describe, expect, it, vi } from 'vitest';

const existsMock = vi.fn();
const getMock = vi.fn();
const setMock = vi.fn();

vi.mock('../utils/redis.js', () => ({
  getRedisClients: vi.fn(() => ({
    pubClient: {
      exists: existsMock,
      get: getMock,
      set: setMock,
    },
  })),
}));

vi.mock('../utils/logger.js', () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('session revocation helpers', () => {
  beforeEach(() => {
    existsMock.mockReset();
    getMock.mockReset();
    setMock.mockReset();
    existsMock.mockResolvedValue(0);
    getMock.mockResolvedValue(null);
    setMock.mockResolvedValue('OK');
  });

  it('marks a token jti as revoked with ttl', async () => {
    const { revokeToken } = await import('./sessionRevocation.js');
    await revokeToken('jti-1', Math.floor(Date.now() / 1000) + 3600);

    expect(setMock).toHaveBeenCalledWith(
      'auth:revoked:jti:jti-1',
      '1',
      expect.objectContaining({ EX: expect.any(Number) })
    );
  });

  it('marks all sessions for a user as revoked after a cutoff', async () => {
    const { revokeUserSessions } = await import('./sessionRevocation.js');
    const cutoff = await revokeUserSessions('user-1', 1234567890);

    expect(cutoff).toBe(1234567890);
    expect(setMock).toHaveBeenCalledWith(
      'auth:user:revoked_after:user-1',
      '1234567890',
      expect.objectContaining({ EX: expect.any(Number) })
    );
  });

  it('treats explicit revoked jti as revoked', async () => {
    existsMock.mockResolvedValue(1);

    const { isRevoked } = await import('./sessionRevocation.js');
    const result = await isRevoked({ userId: 'user-1', jti: 'jti-1', iat: 123 });

    expect(result).toBe(true);
  });

  it('treats tokens issued before revokedAfter as revoked', async () => {
    getMock.mockResolvedValue('500');

    const { isRevoked } = await import('./sessionRevocation.js');
    const result = await isRevoked({ userId: 'user-1', jti: 'jti-1', iat: 400 });

    expect(result).toBe(true);
  });

  it('allows tokens newer than revokedAfter', async () => {
    getMock.mockResolvedValue('500');

    const { isRevoked } = await import('./sessionRevocation.js');
    const result = await isRevoked({ userId: 'user-1', jti: 'jti-1', iat: 600 });

    expect(result).toBe(false);
  });

  it('allows tokens issued at the exact revokedAfter timestamp (boundary)', async () => {
    const cutoff = 1000;
    getMock.mockResolvedValue(String(cutoff));

    const { isRevoked } = await import('./sessionRevocation.js');
    const result = await isRevoked({ userId: 'user-1', jti: 'jti-1', iat: cutoff });

    expect(result).toBe(false);
  });
});
