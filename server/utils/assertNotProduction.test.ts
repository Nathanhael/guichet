import { describe, it, expect, afterEach } from 'vitest';
import { assertNotProduction } from './assertNotProduction.js';

describe('assertNotProduction', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it('returns silently when NODE_ENV !== production', () => {
    process.env.NODE_ENV = 'development';
    expect(() => assertNotProduction()).not.toThrow();
    expect(() => assertNotProduction('test fixtures')).not.toThrow();
  });

  it('throws when NODE_ENV === production', () => {
    process.env.NODE_ENV = 'production';
    expect(() => assertNotProduction()).toThrow(/Production-restricted module/);
  });

  it('includes the supplied reason in the error message', () => {
    process.env.NODE_ENV = 'production';
    expect(() => assertNotProduction('test fixtures')).toThrow(/test fixtures/);
  });

  it('default error message names the file as production-restricted', () => {
    process.env.NODE_ENV = 'production';
    expect(() => assertNotProduction()).toThrow(/must not be imported when NODE_ENV=production/);
  });
});
