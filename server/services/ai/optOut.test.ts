// Covers the cache+DB behaviour of `isUserOptedOut` and the explicit
// invalidation called by the `ai.setOptOut` mutation. The Redis adapter is
// stubbed so tests stay hermetic.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Drizzle-style query builder stub. The shape matches what the production
// code threads through: select().from().where().limit() → Promise<rows>.
function buildDbStub(returnedRows: Array<{ aiOptOut: boolean }>) {
  const limit = vi.fn().mockResolvedValue(returnedRows);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  return { select, _spies: { select, from, where, limit } };
}

function buildRedisStub() {
  return {
    get: vi.fn(),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
  };
}

const mockGetContext = vi.fn();

vi.mock('./context.js', () => ({
  getAiContext: () => mockGetContext(),
}));

import { isUserOptedOut, invalidateOptOutCache } from './optOut';

const FAKE_LOGGER = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const FAKE_SCHEMA = {
  memberships: {
    aiOptOut: 'ai_opt_out',
    partnerId: 'partner_id',
    userId: 'user_id',
  },
} as unknown as ReturnType<typeof Object>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('isUserOptedOut', () => {
  it('returns true on a cache hit with value "1"', async () => {
    const redis = buildRedisStub();
    redis.get.mockResolvedValue('1');
    const db = buildDbStub([]);
    mockGetContext.mockReturnValue({
      redis,
      db,
      schema: FAKE_SCHEMA,
      logger: FAKE_LOGGER,
    });

    const result = await isUserOptedOut('p-1', 'u-1');

    expect(result).toBe(true);
    // Cache hit short-circuits the DB call.
    expect(db._spies.select).not.toHaveBeenCalled();
  });

  it('returns false on a cache hit with value "0"', async () => {
    const redis = buildRedisStub();
    redis.get.mockResolvedValue('0');
    const db = buildDbStub([]);
    mockGetContext.mockReturnValue({
      redis,
      db,
      schema: FAKE_SCHEMA,
      logger: FAKE_LOGGER,
    });

    const result = await isUserOptedOut('p-1', 'u-1');

    expect(result).toBe(false);
    expect(db._spies.select).not.toHaveBeenCalled();
  });

  it('hits the DB on cache miss and caches the result', async () => {
    const redis = buildRedisStub();
    redis.get.mockResolvedValue(null);
    const db = buildDbStub([{ aiOptOut: true }]);
    mockGetContext.mockReturnValue({
      redis,
      db,
      schema: FAKE_SCHEMA,
      logger: FAKE_LOGGER,
    });

    const result = await isUserOptedOut('p-2', 'u-2');

    expect(result).toBe(true);
    expect(db._spies.select).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledWith(
      'ai:optout:p-2:u-2',
      '1',
      expect.objectContaining({ EX: 60 }),
    );
  });

  it('caches false when DB returns no rows (membership not found)', async () => {
    const redis = buildRedisStub();
    redis.get.mockResolvedValue(null);
    const db = buildDbStub([]);
    mockGetContext.mockReturnValue({
      redis,
      db,
      schema: FAKE_SCHEMA,
      logger: FAKE_LOGGER,
    });

    const result = await isUserOptedOut('p-3', 'u-3');

    expect(result).toBe(false);
    expect(redis.set).toHaveBeenCalledWith(
      'ai:optout:p-3:u-3',
      '0',
      expect.objectContaining({ EX: 60 }),
    );
  });

  it('falls back to false (NOT throwing) when DB lookup errors', async () => {
    const redis = buildRedisStub();
    redis.get.mockResolvedValue(null);
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockRejectedValue(new Error('db down')),
          }),
        }),
      }),
    };
    mockGetContext.mockReturnValue({
      redis,
      db,
      schema: FAKE_SCHEMA,
      logger: FAKE_LOGGER,
    });

    const result = await isUserOptedOut('p-4', 'u-4');

    expect(result).toBe(false);
    expect(FAKE_LOGGER.warn).toHaveBeenCalled();
  });

  it('still consults DB when redis is null (no cache available)', async () => {
    const db = buildDbStub([{ aiOptOut: true }]);
    mockGetContext.mockReturnValue({
      redis: null,
      db,
      schema: FAKE_SCHEMA,
      logger: FAKE_LOGGER,
    });

    const result = await isUserOptedOut('p-5', 'u-5');

    expect(result).toBe(true);
    expect(db._spies.select).toHaveBeenCalled();
  });
});

describe('invalidateOptOutCache', () => {
  it('deletes the cache key for the given membership', async () => {
    const redis = buildRedisStub();
    mockGetContext.mockReturnValue({
      redis,
      logger: FAKE_LOGGER,
    });

    await invalidateOptOutCache('p-9', 'u-9');

    expect(redis.del).toHaveBeenCalledWith('ai:optout:p-9:u-9');
  });

  it('is a noop when redis is unavailable', async () => {
    mockGetContext.mockReturnValue({
      redis: null,
      logger: FAKE_LOGGER,
    });

    await expect(invalidateOptOutCache('p-9', 'u-9')).resolves.toBeUndefined();
  });
});
