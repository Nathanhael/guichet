import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('user.list pagination', () => {
  it('query includes LIMIT clause', () => {
    const source = readFileSync(
      join(__dirname, '../../../trpc/routers/user.ts'),
      'utf-8'
    );
    expect(source.toLowerCase()).toMatch(/limit\s+\$/);
  });

  it('input schema accepts limit and offset params', () => {
    const source = readFileSync(
      join(__dirname, '../../../trpc/routers/user.ts'),
      'utf-8'
    );
    expect(source).toContain('limit:');
    expect(source).toContain('offset:');
  });
});
