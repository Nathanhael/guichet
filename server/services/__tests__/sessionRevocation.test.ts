import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Redis before importing module
const mockPublish = vi.fn().mockResolvedValue(1);
const mockSet = vi.fn().mockResolvedValue('OK');
const mockGet = vi.fn().mockResolvedValue(null);
vi.mock('../../utils/redis.js', () => ({
  getRedisClients: () => ({
    pubClient: { set: mockSet, get: mockGet, publish: mockPublish },
    subClient: null,
  }),
}));
vi.mock('../../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../refreshToken.js', () => ({
  revokeAllUserRefreshTokens: vi.fn().mockResolvedValue(undefined),
}));

import { revokeToken, revokeUserSessions } from '../sessionRevocation.js';

describe('sessionRevocation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('revokeToken', () => {
    it('publishes revocation event to Redis channel after revoking', async () => {
      await revokeToken('jti-123', Math.floor(Date.now() / 1000) + 300);

      expect(mockSet).toHaveBeenCalledWith(
        'auth:revoked:jti:jti-123',
        '1',
        expect.objectContaining({ EX: expect.any(Number) }),
      );

      expect(mockPublish).toHaveBeenCalledWith(
        'auth:session:revoked',
        expect.stringContaining('jti-123'),
      );
    });
  });

  describe('revokeUserSessions', () => {
    it('publishes user-level revocation event', async () => {
      const cutoff = Math.floor(Date.now() / 1000);
      await revokeUserSessions('user-42', cutoff);

      expect(mockPublish).toHaveBeenCalledWith(
        'auth:session:revoked',
        expect.stringContaining('user-42'),
      );
    });
  });
});
