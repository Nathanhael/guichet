import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Presence setStatus enum validation (#37)', () => {
  const presenceSource = fs.readFileSync(
    path.resolve(__dirname, '../trpc/routers/presence.ts'), 'utf-8'
  );

  it('constrains status to an enum of valid values', () => {
    expect(presenceSource).toMatch(/z\.enum\(\[.*available.*\]/);
  });

  it('does not accept arbitrary strings for status', () => {
    const statusLine = presenceSource.match(/status:\s*z\.string\(\)/);
    expect(statusLine).toBeNull();
  });
});
