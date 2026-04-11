import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../db/postgres.js', () => {
  const selectResult = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
  };
  return {
    db: {
      select: vi.fn().mockReturnValue(selectResult),
    },
  };
});

import { findPartnerConfig } from './partnerQueries.js';
import { db } from '../db/postgres.js';

describe('partnerQueries', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('findPartnerConfig', () => {
    it('returns partner config when found', async () => {
      const mockPartner = {
        status: 'active',
        businessHoursSchedule: null,
        businessHoursStart: '09:00',
        businessHoursEnd: '17:00',
        businessHoursTimezone: 'Europe/Brussels',
      };
      const selectResult = { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([mockPartner]) };
      vi.mocked(db.select).mockReturnValue(selectResult as never);

      const result = await findPartnerConfig('p1');
      expect(result).toEqual(mockPartner);
    });

    it('returns undefined when partner not found', async () => {
      const selectResult = { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([]) };
      vi.mocked(db.select).mockReturnValue(selectResult as never);

      const result = await findPartnerConfig('missing');
      expect(result).toBeUndefined();
    });
  });
});
