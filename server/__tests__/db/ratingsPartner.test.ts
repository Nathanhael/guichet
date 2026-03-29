import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('ratings table multi-tenancy', () => {
  it('has partnerId column', () => {
    const source = readFileSync(join(__dirname, '../../db/schema.ts'), 'utf-8');
    const ratingsMatch = source.match(/ratings\s*=\s*pgTable[\s\S]*?}\)/);
    expect(ratingsMatch).toBeTruthy();
    expect(ratingsMatch![0]).toContain("partner_id");
  });

  it('handler populates partnerId on rating insert', () => {
    const source = readFileSync(join(__dirname, '../../socket/handlers.ts'), 'utf-8');
    expect(source).toMatch(/insertRating\(\{[^}]*partnerId/s);
  });
});
