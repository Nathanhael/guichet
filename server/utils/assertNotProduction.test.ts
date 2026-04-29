import { describe, it, expect, vi, afterEach } from 'vitest';

describe('assertNotProduction', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('../config.js');
  });

  it('returns silently when NODE_ENV !== production', async () => {
    vi.doMock('../config.js', () => ({ default: { NODE_ENV: 'development' } }));
    const { assertNotProduction } = await import('./assertNotProduction.js');
    expect(() => assertNotProduction()).not.toThrow();
    expect(() => assertNotProduction('test fixtures')).not.toThrow();
  });

  it('throws when NODE_ENV === production', async () => {
    vi.doMock('../config.js', () => ({ default: { NODE_ENV: 'production' } }));
    const { assertNotProduction } = await import('./assertNotProduction.js');
    expect(() => assertNotProduction()).toThrow(/Production-restricted module/);
  });

  it('includes the supplied reason in the error message', async () => {
    vi.doMock('../config.js', () => ({ default: { NODE_ENV: 'production' } }));
    const { assertNotProduction } = await import('./assertNotProduction.js');
    expect(() => assertNotProduction('test fixtures')).toThrow(/test fixtures/);
  });

  it('default error message names the file as production-restricted', async () => {
    vi.doMock('../config.js', () => ({ default: { NODE_ENV: 'production' } }));
    const { assertNotProduction } = await import('./assertNotProduction.js');
    expect(() => assertNotProduction()).toThrow(/must not be imported when NODE_ENV=production/);
  });
});
