import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('archivedTickets FK to partners (#35)', () => {
  const schemaSource = fs.readFileSync(
    path.resolve(__dirname, '../db/schema.ts'), 'utf-8'
  );

  it('has a foreign key reference from archivedTickets.partnerId to partners', () => {
    const archivedBlock = schemaSource.slice(
      schemaSource.indexOf("pgTable('archived_tickets'"),
      schemaSource.indexOf('// ─── Knowledge Base')
    );
    expect(archivedBlock).toMatch(/partnerId.*references.*partners\.id/s);
  });
});
