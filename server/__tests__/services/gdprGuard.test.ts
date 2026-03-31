import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('GDPR purge guard', () => {
  it('checks for unarchived tickets instead of relying on archiveTickets return value', () => {
    const source = readFileSync(
      join(__dirname, '../../services/gdpr.ts'),
      'utf-8'
    );
    // The old pattern: `if (ticketsArchived === 0` should be gone
    expect(source).not.toMatch(/ticketsArchived\s*===\s*0/);
  });

  it('queries for tickets not yet in archived_tickets', () => {
    const source = readFileSync(
      join(__dirname, '../../services/gdpr.ts'),
      'utf-8'
    );
    // Should check for unarchived tickets via NOT EXISTS
    expect(source).toMatch(/NOT EXISTS.*archived.?[Tt]ickets/i);
  });
});
