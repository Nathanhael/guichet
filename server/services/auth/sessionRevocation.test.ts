import { beforeEach, describe, expect, it, vi } from 'vitest';

const existsMock = vi.fn();
const getMock = vi.fn();
const setMock = vi.fn();
const publishMock = vi.fn();

vi.mock('../../utils/redis.js', () => ({
  getRedisClients: vi.fn(() => ({
    pubClient: {
      exists: existsMock,
      get: getMock,
      set: setMock,
      publish: publishMock,
    },
    subClient: null,
  })),
}));

vi.mock('../../utils/logger.js', () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('./refreshToken.js', () => ({
  revokeAllUserRefreshTokens: vi.fn().mockResolvedValue(undefined),
}));

describe('session revocation helpers', () => {
  beforeEach(() => {
    existsMock.mockReset();
    getMock.mockReset();
    setMock.mockReset();
    publishMock.mockReset();
    existsMock.mockResolvedValue(0);
    getMock.mockResolvedValue(null);
    setMock.mockResolvedValue('OK');
    publishMock.mockResolvedValue(1);
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

describe('sessionRevocation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMock.mockResolvedValue('OK');
    publishMock.mockResolvedValue(1);
  });

  describe('revokeToken', () => {
    it('publishes revocation event to Redis channel after revoking', async () => {
      const { revokeToken } = await import('./sessionRevocation.js');
      await revokeToken('jti-123', Math.floor(Date.now() / 1000) + 300);

      expect(setMock).toHaveBeenCalledWith(
        'auth:revoked:jti:jti-123',
        '1',
        expect.objectContaining({ EX: expect.any(Number) }),
      );

      expect(publishMock).toHaveBeenCalledWith(
        'auth:session:revoked',
        expect.stringContaining('jti-123'),
      );
    });
  });

  describe('revokeUserSessions', () => {
    it('publishes user-level revocation event', async () => {
      const cutoff = Math.floor(Date.now() / 1000);
      const { revokeUserSessions } = await import('./sessionRevocation.js');
      await revokeUserSessions('user-42', cutoff);

      expect(publishMock).toHaveBeenCalledWith(
        'auth:session:revoked',
        expect.stringContaining('user-42'),
      );
    });
  });
});
