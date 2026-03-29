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

vi.mock('uuid', () => ({ v4: vi.fn(() => 'mock-uuid') }));

import {
  insertMessage,
  findTicketMessages,
  findTicketLabelIds,
  findMessageForEdit,
  findMessageForDelete,
  updateMessageText,
  softDeleteMessage,
  markDelivered,
  markRead,
} from './messageQueries.js';
import { db } from '../db/postgres.js';

describe('messageQueries', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('insertMessage', () => {
    it('returns a socket-ready message object', async () => {
      const insertChain = { values: vi.fn().mockResolvedValue(undefined) };
      vi.mocked(db.insert).mockReturnValue(insertChain as never);

      const result = await insertMessage({
        ticketId: 't1',
        senderId: 'u1',
        senderName: 'Alice',
        senderRole: 'agent',
        senderLang: 'en',
        text: 'Hello',
      });

      expect(result).toMatchObject({
        ticketId: 't1',
        senderId: 'u1',
        senderName: 'Alice',
        text: 'Hello',
        whisper: false,
        system: false,
      });
      expect(result.id).toBeDefined();
      expect(result.timestamp).toBe(result.createdAt);
    });
  });

  describe('findTicketMessages', () => {
    it('returns ordered messages', async () => {
      const msgs = [{ id: 'm1' }, { id: 'm2' }];
      const chain = { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), orderBy: vi.fn().mockResolvedValue(msgs) };
      vi.mocked(db.select).mockReturnValue(chain as never);

      const result = await findTicketMessages('t1');
      expect(result).toEqual(msgs);
    });
  });

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

  describe('updateMessageText', () => {
    it('calls db.update with text and editedAt', async () => {
      const chain = { set: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue(undefined) };
      vi.mocked(db.update).mockReturnValue(chain as never);

      await updateMessageText('m1', 'new text');
      expect(db.update).toHaveBeenCalled();
    });
  });

  describe('softDeleteMessage', () => {
    it('sets deletedAt and clears text', async () => {
      const chain = { set: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue(undefined) };
      vi.mocked(db.update).mockReturnValue(chain as never);

      await softDeleteMessage('m1');
      expect(db.update).toHaveBeenCalled();
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
});
