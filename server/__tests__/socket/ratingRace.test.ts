import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('rating:submit race condition fix', () => {
  it('schema has unique constraint on ratings.ticket_id', () => {
    const source = readFileSync(
      join(__dirname, '../../db/schema.ts'),
      'utf-8'
    );
    expect(source).toMatch(/uniqueIndex.*ticket/i);
  });

  it('handler uses ON CONFLICT instead of SELECT-then-INSERT', () => {
    const source = readFileSync(
      join(__dirname, '../../socket/handlers.ts'),
      'utf-8'
    );
    expect(source).toMatch(/ON CONFLICT.*ticket_id.*DO NOTHING/i);
  });
});
