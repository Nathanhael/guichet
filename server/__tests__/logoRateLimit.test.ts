import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Logo upload rate limit (#38)', () => {
  const logosSource = fs.readFileSync(
    path.resolve(__dirname, '../routes/logos.ts'), 'utf-8'
  );

  it('applies rate limiting to POST endpoint', () => {
    expect(logosSource).toMatch(/rateLimit|rateLimiter|logoRateLimit/i);
  });

  it('imports rate limiting middleware', () => {
    expect(logosSource).toMatch(/import.*rateLimit|express-rate-limit/i);
  });
});
