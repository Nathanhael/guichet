import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('DISABLE_RATE_LIMIT wired to auth limiter (#42)', () => {
  const authSource = fs.readFileSync(
    path.resolve(__dirname, '../routes/auth.ts'), 'utf-8'
  );

  it('checks DISABLE_RATE_LIMIT in redisRateLimit function', () => {
    const rateLimitFn = authSource.slice(
      authSource.indexOf('async function redisRateLimit'),
      authSource.indexOf('function loginRateLimit')
    );
    expect(rateLimitFn).toMatch(/DISABLE_RATE_LIMIT/);
  });
});
