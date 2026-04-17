// server/__tests__/authLimiterRedisStore.test.ts
//
// Guards the multi-instance safety contract for the authLimiter applied to
// /api/v1/auth and /api/v1/auth/sso. Express-rate-limit defaults to an
// in-memory store, which is per-instance — with N replicas the effective
// limit becomes N × 5 req/min. Wiring a shared Redis store fixes that.
//
// Source-inspection test rather than a runtime test: rate-limit-redis uses
// server-side Lua scripts (SCRIPT LOAD / EVALSHA) that are annoying to mock
// faithfully, and the real contract here is "the Redis store is actually
// wired up in app.ts". Mirrors the style of rateLimiterFallback.test.ts.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('authLimiter — Redis-backed multi-instance safety', () => {
  const appSource = fs.readFileSync(
    path.resolve(__dirname, '../app.ts'),
    'utf-8',
  );

  it('imports RedisStore from rate-limit-redis', () => {
    expect(appSource).toMatch(/import\s+RedisStore\s+from\s+['"]rate-limit-redis['"]/);
  });

  it('constructs a Redis-backed authLimiter when REDIS_URL is configured', () => {
    // Conditional on config.REDIS_URL so tests and REDIS_URL-less deploys still work.
    expect(appSource).toMatch(/config\.REDIS_URL\s*\n?\s*\?\s*rateLimit/);
    expect(appSource).toMatch(/new\s+RedisStore\s*\(/);
  });

  it('uses a namespaced key prefix to avoid colliding with other counters', () => {
    expect(appSource).toMatch(/prefix:\s*['"]rl:auth:/);
  });

  it('sendCommand resolves the Redis client lazily at request time', () => {
    // pubClient is null until initRedis() resolves, so the closure must
    // read it fresh on each call rather than capturing at construction.
    expect(appSource).toMatch(/sendCommand:.*getRedisClients\(\)/s);
  });

  it('falls back to in-memory limiter when the Redis client is not yet connected', () => {
    // Startup race: a few requests may hit before initRedis resolves. Same
    // branch covers a transient disconnect.
    expect(appSource).toMatch(/inMemoryAuthLimiter/);
    expect(appSource).toMatch(/if\s*\(\s*pubClient\s*\)/);
  });
});
