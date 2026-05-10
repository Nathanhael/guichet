/**
 * Production migrator — uses drizzle-orm's built-in migrate() helper instead
 * of the drizzle-kit CLI. Runs inside the prod runtime image without needing
 * drizzle-kit (and its ~50 MB transitive footprint of esbuild + typescript
 * + @typespec) installed at runtime.
 *
 * Invoke from inside the container:
 *   node dist/db/migrate.js
 *
 * Reads DATABASE_URL from the environment. Migration SQL files + journal are
 * read from /app/drizzle (copied in by Dockerfile.prod).
 *
 * Dev developers should keep using `npm run db:migrate` (drizzle-kit CLI) —
 * it's still wired in package.json and drizzle-kit lives in devDependencies.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// dist/db/migrate.js → /app/dist/db/migrate.js → drizzle/ at /app/drizzle
const migrationsFolder = path.resolve(__dirname, '..', '..', 'drizzle');

if (!process.env.DATABASE_URL) {
  console.error('[migrate] FATAL: DATABASE_URL is required');
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.DB_SSL === 'false'
      ? false
      : process.env.DB_SSL
        ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' }
        : undefined,
});

const db = drizzle(pool);

console.log(`[migrate] applying migrations from ${migrationsFolder}`);
try {
  await migrate(db, { migrationsFolder });
  console.log('[migrate] done');
  await pool.end();
  process.exit(0);
} catch (err) {
  console.error('[migrate] failed:', err instanceof Error ? err.message : err);
  await pool.end().catch(() => {});
  process.exit(1);
}
