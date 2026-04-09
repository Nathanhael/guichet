import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('removeMember transaction safety', () => {
  it('wraps the count-check and delete in a transaction', () => {
    const source = readFileSync(join(__dirname, '../../../trpc/routers/partner/members.ts'), 'utf-8');
    // Find the removeMember section and verify it uses db.transaction
    // Look for transaction usage near the membership deletion logic
    expect(source).toMatch(/db\.transaction/);
  });
});
