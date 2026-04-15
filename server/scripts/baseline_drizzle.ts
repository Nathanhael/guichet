/**
 * db:baseline — populate the Drizzle migration ledger WITHOUT running SQL.
 *
 * WHEN TO USE
 *   • The database already has the correct schema (applied manually or by
 *     a previous tool) but the drizzle.__drizzle_migrations ledger is empty.
 *   • Typically a one-time fix when adopting Drizzle on an existing DB.
 *
 * WHEN NOT TO USE
 *   • On a brand-new / empty database — just run `npm run db:migrate` instead.
 *   • If the ledger already has entries (the script will refuse anyway).
 *
 * SAFETY
 *   • The script checks that the ledger is empty before writing; if it finds
 *     existing rows it rolls back and exits with no changes.
 *   • Pass --yes / -y to skip the interactive confirmation (CI use only).
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import pg from 'pg';

const { Client } = pg;

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
  breakpoints: boolean;
}

interface Journal {
  entries: JournalEntry[];
}

function readJournal(drizzleDir: string): Journal {
  const journalPath = path.join(drizzleDir, 'meta', '_journal.json');
  return JSON.parse(fs.readFileSync(journalPath, 'utf8')) as Journal;
}

function getMigrationHash(drizzleDir: string, tag: string): string {
  const sqlPath = path.join(drizzleDir, `${tag}.sql`);
  const sql = fs.readFileSync(sqlPath, 'utf8');
  return crypto.createHash('sha256').update(sql).digest('hex');
}

async function confirm(message: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${message} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

async function main() {
  const skipPrompt = process.argv.includes('--yes') || process.argv.includes('-y');
  const drizzleDir = path.resolve(process.cwd(), 'drizzle');
  const journal = readJournal(drizzleDir);
  const connectionString = process.env.DATABASE_URL || 'postgres://user:password@localhost:5432/guichet';

  if (!skipPrompt) {
    console.log(`This will mark ${journal.entries.length} migrations as already-applied.`);
    console.log('Only use this on a database whose schema already matches the migrations.');
    const ok = await confirm('Continue?');
    if (!ok) {
      console.log('Aborted.');
      return;
    }
  }

  const client = new Client({ connectionString });

  await client.connect();

  try {
    await client.query('begin');
    await client.query('create schema if not exists drizzle');
    await client.query(`
      create table if not exists drizzle.__drizzle_migrations (
        id serial primary key,
        hash text not null,
        created_at bigint
      )
    `);

    const existing = await client.query<{ count: string }>('select count(*)::text as count from drizzle.__drizzle_migrations');
    if (Number(existing.rows[0]?.count || '0') > 0) {
      await client.query('rollback');
      console.log('Drizzle migration ledger already contains entries. No changes applied.');
      return;
    }

    for (const entry of journal.entries) {
      await client.query(
        'insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)',
        [getMigrationHash(drizzleDir, entry.tag), entry.when],
      );
    }

    await client.query('commit');
    console.log(`Baselined ${journal.entries.length} Drizzle migrations.`);
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
