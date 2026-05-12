import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('GDPR purge guard', () => {
  // The guard moved to gdpr/dailyStatsAggregate.ts after the orchestrator
  // split — same invariant, just a different home.
  const source = readFileSync(
    join(__dirname, '../../services/gdpr/dailyStatsAggregate.ts'),
    'utf-8',
  );

  it('checks for unarchived tickets instead of relying on archiveTickets return value', () => {
    // The old pattern: `if (ticketsArchived === 0` should be gone
    expect(source).not.toMatch(/ticketsArchived\s*===\s*0/);
  });

  it('queries for tickets not yet in archived_tickets', () => {
    // The guard SQL: NOT EXISTS subquery against archivedTickets
    expect(source).toMatch(/NOT EXISTS.*archived.?[Tt]ickets/i);
  });
});
