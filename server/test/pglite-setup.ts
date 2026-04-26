/**
 * PGLite test substrate.
 *
 * Boots an in-memory PGLite instance, applies every Drizzle migration in
 * `server/drizzle/`, and returns a Drizzle-typed handle plus the raw client.
 * Each call returns an isolated database — share within a `describe` block,
 * not across files.
 *
 * Designed for the `services/ticketLifecycle` boundary tests so the suite can
 * verify real `BEGIN/COMMIT/ROLLBACK` semantics without Docker.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

import * as schema from '../db/schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = path.resolve(__dirname, '..', 'drizzle');

export type TestDb = PgliteDatabase<typeof schema> & { $client: PGlite };

export interface TestDbHandle {
  db: TestDb;
  client: PGlite;
  close: () => Promise<void>;
}

export async function createTestDb(): Promise<TestDbHandle> {
  const client = new PGlite();
  const db = drizzle(client, { schema }) as TestDb;
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return {
    db,
    client,
    close: () => client.close(),
  };
}
