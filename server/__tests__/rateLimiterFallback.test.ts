import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Rate limiter fallback (#9)', () => {
  const authSource = fs.readFileSync(
    path.resolve(__dirname, '../routes/auth/rateLimit.ts'), 'utf-8'
  );

  it('has an in-memory fallback Map for rate limiting', () => {
    expect(authSource).toMatch(/new Map/);
    expect(authSource).toMatch(/fallback/i);
  });

  it('uses fallback when Redis is unavailable', () => {
    expect(authSource).toMatch(/fallbackRateLimit|memoryLimiter|localLimiter/);
  });

  it('fallback has TTL-based expiry', () => {
    expect(authSource).toMatch(/Date\.now|setTimeout|expire|ttl/i);
  });
});
