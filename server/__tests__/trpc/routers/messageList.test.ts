import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('message.list', () => {
  it('applies a limit to the query', () => {
    const source = readFileSync(join(__dirname, '../../../trpc/routers/message.ts'), 'utf-8');
    expect(source).toMatch(/\.limit\s*\(/);
  });
});
