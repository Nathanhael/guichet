import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Repetition store atomicity (#26)', () => {
  const repSource = fs.readFileSync(
    path.resolve(__dirname, '../services/repetitionStore.ts'), 'utf-8'
  );

  it('uses a Lua script for atomic check-and-increment', () => {
    expect(repSource).toMatch(/eval|EVAL|lua|sendCommand/i);
  });

  it('does not have separate get-then-incr pattern', () => {
    const hasGetThenIncr = /await redisClient\.get\(key\)[\s\S]{1,200}await redisClient\.incr\(countKey\)/.test(repSource);
    expect(hasGetThenIncr).toBe(false);
  });
});
