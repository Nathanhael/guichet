// server/__tests__/drizzleJournal.test.ts
//
// Guards against silent journal drift. drizzle-kit migrate reads this file
// to know which migrations to apply; if entries fall behind the SQL files,
// `npm run db:migrate` on a fresh DB produces a partial schema and the
// divergence is invisible until someone actually runs it on a clean volume.
//
// Previously CI ran `drizzle-kit push --force` which ignores the journal,
// hiding the drift. That's been flipped to `drizzle-kit migrate` — this
// test is the belt that catches the gap before CI does.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

type JournalEntry = { idx: number; version: string; when: number; tag: string; breakpoints: boolean };
type Journal = { version: string; dialect: string; entries: JournalEntry[] };

describe('drizzle migration journal', () => {
  const drizzleDir = path.resolve(__dirname, '../drizzle');
  const journal: Journal = JSON.parse(
    fs.readFileSync(path.join(drizzleDir, 'meta', '_journal.json'), 'utf-8'),
  );
  const sqlFiles = fs
    .readdirSync(drizzleDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  it('has a journal entry for every .sql migration file', () => {
    const tags = new Set(journal.entries.map((e) => e.tag));
    const missing = sqlFiles
      .map((f) => f.replace(/\.sql$/, ''))
      .filter((tag) => !tags.has(tag));
    expect(missing).toEqual([]);
  });

  it('has no journal entry pointing at a missing .sql file', () => {
    const fileTagSet = new Set(sqlFiles.map((f) => f.replace(/\.sql$/, '')));
    const orphaned = journal.entries.filter((e) => !fileTagSet.has(e.tag));
    expect(orphaned).toEqual([]);
  });

  it('has contiguous idx values starting at 0', () => {
    const sorted = [...journal.entries].sort((a, b) => a.idx - b.idx);
    sorted.forEach((entry, i) => {
      expect(entry.idx).toBe(i);
    });
  });

  it('idx order matches filename prefix order', () => {
    // A migration numbered 0007 must be at idx 7. Drizzle runs migrations in
    // idx order, so if 0008_drop_auth_method ran before 0007_partner_auth_method
    // the DROP would target a non-existent column.
    const sorted = [...journal.entries].sort((a, b) => a.idx - b.idx);
    sorted.forEach((entry) => {
      const filenamePrefix = entry.tag.slice(0, 4);
      expect(parseInt(filenamePrefix, 10)).toBe(entry.idx);
    });
  });

  it('has no duplicate filename prefixes', () => {
    // Two files sharing `0006_*` can both exist on disk but only one can claim
    // idx=6 in the journal — the other gets silently skipped.
    const prefixes = sqlFiles.map((f) => f.slice(0, 4));
    const dupes = prefixes.filter((p, i) => prefixes.indexOf(p) !== i);
    expect(dupes).toEqual([]);
  });
});
