import { describe, it, expect, vi, afterEach } from 'vitest';

describe('testFixtures router — production boundary', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it('throws on import when NODE_ENV === production', async () => {
    // Set NODE_ENV=production AND stub the other prod-required env vars so
    // config.ts's prod-validation cascade doesn't process.exit before our
    // assertNotProduction check runs. (testFixtures.ts transitively imports
    // utils/redis.ts which imports config.ts.)
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'a'.repeat(64);
    process.env.CORS_ORIGIN = 'https://example.com';
    process.env.FRONTEND_URL = 'https://example.com';
    process.env.COOKIE_SECURE = 'true';
    process.env.DISABLE_RATE_LIMIT = 'false';
    process.env.DEMO_MODE = 'false';
    vi.resetModules();
    await expect(import('./testFixtures.js')).rejects.toThrow(
      /Production-restricted module/,
    );
  });

  it('imports cleanly when NODE_ENV !== production', async () => {
    process.env.NODE_ENV = 'test';
    vi.resetModules();
    const mod = await import('./testFixtures.js');
    expect(mod.testFixturesRouter).toBeDefined();
    expect(mod.fixtureProcedure).toBeDefined();
  });

  it('imports cleanly when NODE_ENV === development', async () => {
    process.env.NODE_ENV = 'development';
    vi.resetModules();
    const mod = await import('./testFixtures.js');
    expect(mod.testFixturesRouter).toBeDefined();
  });
});
