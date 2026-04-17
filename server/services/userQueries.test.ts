import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../db/postgres.js', () => {
  const chainable = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
    innerJoin: vi.fn().mockReturnThis(),
  };
  return {
    db: {
      select: vi.fn().mockReturnValue(chainable),
    },
  };
});

import { findUserById, findMembership, findSenderInfo, findUserName, findTargetSupport } from './userQueries.js';
import { db } from '../db/postgres.js';

describe('userQueries', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('findUserById', () => {
    it('returns user when found', async () => {
      const mockUser = { name: 'Alice', isPlatformOperator: false };
      const chain = { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([mockUser]) };
      vi.mocked(db.select).mockReturnValue(chain as never);
      const result = await findUserById('u1');
      expect(result).toEqual(mockUser);
    });

    it('returns undefined when not found', async () => {
      const chain = { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([]) };
      vi.mocked(db.select).mockReturnValue(chain as never);
      const result = await findUserById('missing');
      expect(result).toBeUndefined();
    });
  });

  describe('findMembership', () => {
    it('returns membership role when found', async () => {
      const chain = { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([{ role: 'admin' }]) };
      vi.mocked(db.select).mockReturnValue(chain as never);
      const result = await findMembership('u1', 'p1');
      expect(result).toEqual({ role: 'admin' });
    });
  });

  describe('findSenderInfo', () => {
    it('returns joined user+membership info including isExternal', async () => {
      const mock = { name: 'Bob', role: 'support', lang: 'en', isExternal: false };
      const chain = { from: vi.fn().mockReturnThis(), innerJoin: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([mock]) };
      vi.mocked(db.select).mockReturnValue(chain as never);
      const result = await findSenderInfo('u1', 'p1');
      expect(result).toEqual(mock);
    });

    it('propagates isExternal=true for Azure B2B guests', async () => {
      const mock = { name: 'Jane', role: 'admin', lang: 'en', isExternal: true };
      const chain = { from: vi.fn().mockReturnThis(), innerJoin: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([mock]) };
      vi.mocked(db.select).mockReturnValue(chain as never);
      const result = await findSenderInfo('u-guest', 'p1');
      expect(result?.isExternal).toBe(true);
    });
  });

  describe('findUserName', () => {
    it('returns user name + isExternal', async () => {
      const chain = { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([{ name: 'Carol', isExternal: false }]) };
      vi.mocked(db.select).mockReturnValue(chain as never);
      const result = await findUserName('u1');
      expect(result).toEqual({ name: 'Carol', isExternal: false });
    });
  });

  describe('findTargetSupport', () => {
    it('returns joined user name for transfer target', async () => {
      const mock = { name: 'Dave' };
      const chain = { from: vi.fn().mockReturnThis(), innerJoin: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([mock]) };
      vi.mocked(db.select).mockReturnValue(chain as never);
      const result = await findTargetSupport('u1', 'p1');
      expect(result).toEqual(mock);
    });
  });
});
