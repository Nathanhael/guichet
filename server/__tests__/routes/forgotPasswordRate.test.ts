import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('/forgot-password rate limiting', () => {
  it('has rate limit middleware on the forgot-password route', () => {
    const source = readFileSync(join(__dirname, '../../routes/auth/password.ts'), 'utf-8');
    // Matches resetPasswordRateLimit applied to the /forgot-password route
    expect(source).toMatch(/router\.post\(['"]\/forgot-password['"],\s*resetPasswordRateLimit/);
  });
});
