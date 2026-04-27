// server/services/messageQueries.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../db/postgres.js', () => {
  const chainable = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
    orderBy: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue(undefined),
  };
  return {
    db: {
      select: vi.fn().mockReturnValue(chainable),
      insert: vi.fn().mockReturnValue(chainable),
      update: vi.fn().mockReturnValue(chainable),
    },
  };
});

const mockStorageDelete = vi.fn().mockResolvedValue(undefined);
vi.mock('./storage.js', () => ({
  getStorage: () => ({
    upload: vi.fn(),
    delete: mockStorageDelete,
    getUrl: vi.fn(),
    read: vi.fn(),
    healthy: vi.fn(),
  }),
}));

vi.stubGlobal('crypto', { ...crypto, randomUUID: vi.fn(() => 'mock-uuid') });

import {
  findTicketLabelIds,
  findMessageForEdit,
  findMessageForDelete,
  markDelivered,
  markRead,
  findTicketMessagesPaginated,
} from './messageQueries.js';
import { db } from '../db/postgres.js';

describe('messageQueries', () => {
  beforeEach(() => vi.clearAllMocks());

  // Tests for `insertMessage`, `updateMessageText`, `updateMessageReactions`,
  // and `softDeleteMessage` were removed in PR 4 of the messageLifecycle
  // deepening (issue #50). The functions were absorbed into
  // `services/messageLifecycle/` and their behavior is now covered by
  // PGLite boundary tests in that module with stronger assertions.

  describe('findTicketLabelIds', () => {
    it('returns label IDs array', async () => {
      const rows = [{ labelId: 'l1' }, { labelId: 'l2' }];
      const chain = { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue(rows) };
      vi.mocked(db.select).mockReturnValue(chain as never);

      const result = await findTicketLabelIds('t1');
      expect(result).toEqual(['l1', 'l2']);
    });
  });

  describe('findMessageForEdit', () => {
    it('returns message metadata', async () => {
      const msg = { senderId: 'u1', createdAt: '2026-01-01', system: 0, deletedAt: null };
      const chain = { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([msg]) };
      vi.mocked(db.select).mockReturnValue(chain as never);

      const result = await findMessageForEdit('m1', 't1');
      expect(result).toEqual(msg);
    });
  });

  describe('findMessageForDelete', () => {
    it('returns message metadata for delete auth', async () => {
      const msg = { senderId: 'u1', system: 0, deletedAt: null };
      const chain = { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([msg]) };
      vi.mocked(db.select).mockReturnValue(chain as never);

      const result = await findMessageForDelete('m1', 't1');
      expect(result).toEqual(msg);
    });
  });

  describe('markDelivered', () => {
    it('updates deliveredAt where null', async () => {
      const chain = { set: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue(undefined) };
      vi.mocked(db.update).mockReturnValue(chain as never);

      await markDelivered('m1', 't1');
      expect(db.update).toHaveBeenCalled();
    });
  });

  describe('markRead', () => {
    it('batch updates readAt for multiple message IDs', async () => {
      const chain = { set: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue(undefined) };
      vi.mocked(db.update).mockReturnValue(chain as never);

      await markRead(['m1', 'm2'], 't1');
      expect(db.update).toHaveBeenCalled();
    });
  });

  describe('findTicketMessagesPaginated', () => {
    function makeSelectChain(resolvedValue: unknown[]) {
      const mockLimit = vi.fn().mockResolvedValue(resolvedValue);
      const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });
      const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy });
      const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
      vi.mocked(db.select).mockReturnValue({ from: mockFrom } as never);
      return { mockLimit, mockOrderBy, mockWhere, mockFrom };
    }

    it('returns messages with hasMore=false when under limit', async () => {
      const fakeMessages = [
        { id: 'm1', ticketId: 't1', createdAt: '2026-01-01T00:00:00Z' },
        { id: 'm2', ticketId: 't1', createdAt: '2026-01-01T00:01:00Z' },
      ];
      makeSelectChain(fakeMessages);

      const result = await findTicketMessagesPaginated('t1', { limit: 50 });

      expect(result.messages).toHaveLength(2);
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeUndefined();
    });

    it('returns hasMore=true and nextCursor when at limit', async () => {
      // Return limit+1 items to signal hasMore
      const fakeMessages = Array.from({ length: 51 }, (_, i) => ({
        id: `m${i}`,
        ticketId: 't1',
        createdAt: `2026-01-01T00:${String(i).padStart(2, '0')}:00Z`,
      }));
      makeSelectChain(fakeMessages);

      const result = await findTicketMessagesPaginated('t1', { limit: 50 });

      expect(result.messages).toHaveLength(50);
      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).toBeDefined();
      // Cursor should be createdAt|id of the last returned message
      expect(result.nextCursor).toBe(`2026-01-01T00:49:00Z|m49`);
    });

    it('caps limit at 200', async () => {
      const { mockLimit } = makeSelectChain([]);

      await findTicketMessagesPaginated('t1', { limit: 500 });

      // Should call limit with 201 (200 + 1 for hasMore detection)
      expect(mockLimit).toHaveBeenCalledWith(201);
    });

    it('defaults limit to 50', async () => {
      const { mockLimit } = makeSelectChain([]);

      await findTicketMessagesPaginated('t1');

      expect(mockLimit).toHaveBeenCalledWith(51);
    });
  });
});
