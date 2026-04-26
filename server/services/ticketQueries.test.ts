import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../db/postgres.js', () => {
  const chainable = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    set: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue(undefined),
  };
  return {
    db: {
      select: vi.fn().mockReturnValue(chainable),
      insert: vi.fn().mockReturnValue(chainable),
      update: vi.fn().mockReturnValue(chainable),
      delete: vi.fn().mockReturnValue(chainable),
      transaction: vi.fn().mockImplementation(async (cb) => cb({
        delete: vi.fn().mockReturnValue(chainable),
        insert: vi.fn().mockReturnValue(chainable),
      })),
      execute: vi.fn().mockResolvedValue({ rows: [] }),
    },
  };
});

import {
  findTicketPartner,
  findTicketForJoin,
  findTicketForClose,
  findTicketOwner,
  findTicketParticipants,
  findRecentClosedTickets,
  findActiveTicketsForAgent,
  findActiveTicketsForSupport,
  replaceTicketLabels,
  findPartnerLabels,
} from './ticketQueries.js';
import { db } from '../db/postgres.js';

describe('ticketQueries', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('findTicketPartner', () => {
    it('returns partnerId when found', async () => {
      const chain = { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([{ partnerId: 'p1' }]) };
      vi.mocked(db.select).mockReturnValue(chain as never);
      const result = await findTicketPartner('t1');
      expect(result).toEqual({ partnerId: 'p1' });
    });

    it('returns undefined when not found', async () => {
      const chain = { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([]) };
      vi.mocked(db.select).mockReturnValue(chain as never);
      const result = await findTicketPartner('missing');
      expect(result).toBeUndefined();
    });
  });

  describe('findTicketForJoin', () => {
    it('returns full ticket row for support:join', async () => {
      const mockTicket = { id: 't1', partnerId: 'p1', supportId: null, supportName: null, supportLang: null, supportJoinedAt: null, status: 'open', participants: [] };
      const chain = { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([mockTicket]) };
      vi.mocked(db.select).mockReturnValue(chain as never);
      const result = await findTicketForJoin('t1');
      expect(result?.id).toBe('t1');
    });
  });

  describe('findTicketForClose', () => {
    it('returns status, partnerId, supportId, and supportName', async () => {
      const chain = { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([{ status: 'open', partnerId: 'p1', supportId: 's1', supportName: 'Support Agent' }]) };
      vi.mocked(db.select).mockReturnValue(chain as never);
      const result = await findTicketForClose('t1');
      expect(result?.status).toBe('open');
      expect(result?.supportId).toBe('s1');
      expect(result?.supportName).toBe('Support Agent');
    });
  });

  describe('findTicketOwner', () => {
    it('returns partner, agent, support IDs', async () => {
      const chain = { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([{ partnerId: 'p1', agentId: 'a1', supportId: 's1' }]) };
      vi.mocked(db.select).mockReturnValue(chain as never);
      const result = await findTicketOwner('t1');
      expect(result?.agentId).toBe('a1');
    });
  });

  describe('findTicketParticipants', () => {
    it('returns partnerId and participants', async () => {
      const chain = { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([{ partnerId: 'p1', participants: [] }]) };
      vi.mocked(db.select).mockReturnValue(chain as never);
      const result = await findTicketParticipants('t1');
      expect(result?.partnerId).toBe('p1');
    });
  });

  describe('findRecentClosedTickets', () => {
    it('returns closed tickets with reopen data', async () => {
      const rows = [{ id: 't1', reopenCount: 0, references: [] }];
      const chain = { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), orderBy: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue(rows) };
      vi.mocked(db.select).mockReturnValue(chain as never);
      const result = await findRecentClosedTickets('p1', 100);
      expect(result).toHaveLength(1);
    });
  });

  describe('findActiveTicketsForAgent', () => {
    it('returns open ticket IDs for agent', async () => {
      const chain = { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([{ id: 't1' }]) };
      vi.mocked(db.select).mockReturnValue(chain as never);
      const result = await findActiveTicketsForAgent('u1', 'p1');
      expect(result).toEqual([{ id: 't1' }]);
    });
  });

  describe('findActiveTicketsForSupport', () => {
    it('returns active ticket IDs for support user', async () => {
      const chain = { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([{ id: 't1' }]) };
      vi.mocked(db.select).mockReturnValue(chain as never);
      const result = await findActiveTicketsForSupport('u1', 'p1');
      expect(result).toEqual([{ id: 't1' }]);
    });
  });

  // Lifecycle-mutation tests (createTicket / closeTicket / returnTicketToQueue
  // and friends) lived here pre-deepening. Their replacements assert against
  // PGLite-backed transactions in `services/ticketLifecycle/*.test.ts` —
  // `reclaim.test.ts` covers returnTicketToQueue + audit invariant,
  // `leave.test.ts` covers participant updates, `assign.test.ts` covers
  // assignSupport, `transfer.test.ts` covers transferTicketToDepartment +
  // whisper note, `close.test.ts` covers closeTicket + closed_at, and
  // `create.test.ts` covers createTicket + reopen detection.

  describe('replaceTicketLabels', () => {
    it('replaces labels in a transaction', async () => {
      await replaceTicketLabels('t1', ['l1', 'l2']);
      expect(db.transaction).toHaveBeenCalled();
    });
  });

  describe('findPartnerLabels', () => {
    it('returns labels for partner matching given IDs', async () => {
      const chain = { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([{ id: 'l1' }]) };
      vi.mocked(db.select).mockReturnValue(chain as never);
      const result = await findPartnerLabels('p1', ['l1', 'l2']);
      expect(result).toEqual([{ id: 'l1' }]);
    });
  });
});
