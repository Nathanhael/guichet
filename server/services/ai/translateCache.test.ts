import { describe, it, expect, vi, beforeEach } from 'vitest';

// In-memory fake redis client mirroring the redis npm client surface we use.
// Stores values + TTL recorded per key so tests can assert TTL argument.
function createFakeRedis() {
  const store = new Map<string, string>();
  const ttls = new Map<string, number>();
  return {
    store,
    ttls,
    get: vi.fn(async (k: string) => (store.has(k) ? store.get(k)! : null)),
    set: vi.fn(async (k: string, v: string, opts?: { EX?: number }) => {
      store.set(k, v);
      if (opts?.EX !== undefined) ttls.set(k, opts.EX);
      return 'OK';
    }),
    del: vi.fn(async (k: string | string[]) => {
      const keys = Array.isArray(k) ? k : [k];
      let n = 0;
      for (const key of keys) {
        if (store.delete(key)) n++;
        ttls.delete(key);
      }
      return n;
    }),
  };
}

let fakeRedis = createFakeRedis();

vi.mock('./context.js', () => ({
  getAiContext: vi.fn(() => ({
    db: {} as any,
    redis: fakeRedis,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    config: { AI_ENABLED: true } as any,
    decrypt: (s: string) => s,
    schema: {} as any,
  })),
  initAiContext: vi.fn(),
}));

const MSG_ID = 'msg-1';

describe('translateCache', () => {
  beforeEach(() => {
    fakeRedis = createFakeRedis();
    vi.clearAllMocks();
  });

  it('get returns null on miss', async () => {
    const { getCachedTranslation } = await import('./translateCache.js');
    const result = await getCachedTranslation(MSG_ID, 'nl');
    expect(result).toBeNull();
  });

  it('set then get returns the cached value', async () => {
    const { getCachedTranslation, setCachedTranslation } = await import('./translateCache.js');
    await setCachedTranslation(MSG_ID, 'fr', 'Bonjour');
    const result = await getCachedTranslation(MSG_ID, 'fr');
    expect(result).toBe('Bonjour');
  });

  it('get for a different lang returns null after set on one lang', async () => {
    const { getCachedTranslation, setCachedTranslation } = await import('./translateCache.js');
    await setCachedTranslation(MSG_ID, 'nl', 'Hallo');
    const otherLang = await getCachedTranslation(MSG_ID, 'fr');
    expect(otherLang).toBeNull();
    const sameLang = await getCachedTranslation(MSG_ID, 'nl');
    expect(sameLang).toBe('Hallo');
  });

  it('invalidate removes all lang variants for a message', async () => {
    const { getCachedTranslation, setCachedTranslation, invalidateTranslation } = await import('./translateCache.js');
    await setCachedTranslation(MSG_ID, 'nl', 'Hallo');
    await setCachedTranslation(MSG_ID, 'fr', 'Bonjour');
    await setCachedTranslation(MSG_ID, 'en', 'Hello');
    await invalidateTranslation(MSG_ID);
    expect(await getCachedTranslation(MSG_ID, 'nl')).toBeNull();
    expect(await getCachedTranslation(MSG_ID, 'fr')).toBeNull();
    expect(await getCachedTranslation(MSG_ID, 'en')).toBeNull();
  });

  it('writes 24h (86400s) TTL on set', async () => {
    const { setCachedTranslation } = await import('./translateCache.js');
    await setCachedTranslation(MSG_ID, 'en', 'Hello');
    expect(fakeRedis.set).toHaveBeenCalledWith(
      `translation:${MSG_ID}:en`,
      'Hello',
      { EX: 86400 },
    );
    // Also verify the recorded TTL
    expect(fakeRedis.ttls.get(`translation:${MSG_ID}:en`)).toBe(86400);
  });

  it('uses key format translation:${messageId}:${targetLang}', async () => {
    const { setCachedTranslation } = await import('./translateCache.js');
    await setCachedTranslation('msg-XYZ', 'fr', 'salut');
    expect(fakeRedis.store.has('translation:msg-XYZ:fr')).toBe(true);
  });

  it('returns null gracefully when redis is null', async () => {
    const ctx = await import('./context.js');
    (ctx.getAiContext as any).mockReturnValueOnce({
      db: {} as any,
      redis: null,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      config: {} as any,
      decrypt: (s: string) => s,
      schema: {} as any,
    });
    const { getCachedTranslation } = await import('./translateCache.js');
    const result = await getCachedTranslation(MSG_ID, 'nl');
    expect(result).toBeNull();
  });
});
