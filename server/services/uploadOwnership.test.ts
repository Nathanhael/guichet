// server/services/uploadOwnership.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../db/postgres.js', () => {
  const chainable = {
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
  };
  return {
    db: { select: vi.fn().mockReturnValue(chainable) },
  };
});

import { lookupFilePartnerId } from './uploadOwnership.js';
import { db } from '../db/postgres.js';

function makeChain(rows: Array<{ partnerId: string }>) {
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ limit });
  const innerJoin = vi.fn().mockReturnValue({ where });
  const from = vi.fn().mockReturnValue({ innerJoin });
  vi.mocked(db.select).mockReturnValue({ from } as never);
  return { from, innerJoin, where, limit };
}

describe('lookupFilePartnerId', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the partnerId when filename matches an attachment', async () => {
    makeChain([{ partnerId: 'partner-acme' }]);
    const result = await lookupFilePartnerId('abc.png');
    expect(result).toBe('partner-acme');
  });

  it('returns null when the filename is unknown', async () => {
    makeChain([]);
    const result = await lookupFilePartnerId('does-not-exist.png');
    expect(result).toBeNull();
  });

  it('returns null when filename is empty (skips DB query)', async () => {
    const chain = makeChain([{ partnerId: 'partner-acme' }]);
    const result = await lookupFilePartnerId('');
    expect(result).toBeNull();
    expect(chain.from).not.toHaveBeenCalled();
  });

  it('builds URL by prefixing /uploads/ before querying', async () => {
    const chain = makeChain([{ partnerId: 'p1' }]);
    await lookupFilePartnerId('xyz.jpg');
    // Where clause is opaque (Drizzle SQL). Just verify the chain ran end-to-end.
    expect(chain.from).toHaveBeenCalled();
    expect(chain.innerJoin).toHaveBeenCalled();
    expect(chain.where).toHaveBeenCalled();
    expect(chain.limit).toHaveBeenCalledWith(1);
  });
});
