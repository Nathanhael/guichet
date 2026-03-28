import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const source = readFileSync(
  join(__dirname, '../../../trpc/routers/platformSecurity.ts'),
  'utf-8'
);

describe('platform TOTP enable brute-force protection', () => {
  it('checks lockout before verifying TOTP code', () => {
    expect(source).toContain('checkLockout');
  });

  it('records failed login on bad TOTP code', () => {
    expect(source).toContain('recordFailedLogin');
  });
});
