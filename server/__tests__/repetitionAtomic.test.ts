import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Repetition store atomicity (#26)', () => {
  // Source moved from `services/repetitionStore.ts` into the moderator
  // package as part of the moderator extraction; the atomicity contract
  // still belongs to the repetition pipeline so the assertions stay.
  const repSource = fs.readFileSync(
    path.resolve(__dirname, '../services/moderator/repetition.ts'), 'utf-8'
  );

  it('uses a Lua script for atomic check-and-increment', () => {
    expect(repSource).toMatch(/eval|EVAL|lua|sendCommand/i);
  });

  it('does not have separate get-then-incr pattern', () => {
    const hasGetThenIncr = /await redisClient\.get\(key\)[\s\S]{1,200}await redisClient\.incr\(countKey\)/.test(repSource);
    expect(hasGetThenIncr).toBe(false);
  });
});
