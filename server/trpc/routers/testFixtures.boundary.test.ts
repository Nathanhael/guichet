import { describe, it, expect, vi, afterEach } from 'vitest';

describe('testFixtures router — production boundary', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('../../config.js');
  });

  it('throws on import when NODE_ENV === production', async () => {
    vi.doMock('../../config.js', () => ({ default: { NODE_ENV: 'production' } }));
    await expect(import('./testFixtures.js')).rejects.toThrow(
      /Production-restricted module/,
    );
  });

  it('imports cleanly when NODE_ENV !== production', async () => {
    vi.doMock('../../config.js', () => ({ default: { NODE_ENV: 'test' } }));
    const mod = await import('./testFixtures.js');
    expect(mod.testFixturesRouter).toBeDefined();
    expect(mod.fixtureProcedure).toBeDefined();
  });

  it('imports cleanly when NODE_ENV === development', async () => {
    vi.doMock('../../config.js', () => ({ default: { NODE_ENV: 'development' } }));
    const mod = await import('./testFixtures.js');
    expect(mod.testFixturesRouter).toBeDefined();
  });
});
