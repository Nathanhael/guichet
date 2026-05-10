/**
 * One-shot config for generating the prod-cutover squashed migration.
 *
 * Used at cutover time only — see docs/AZURE_CUTOVER_RUNBOOK.md "Migration
 * strategy" → squash path. Dev keeps using `drizzle.config.ts` and the
 * incremental files in `drizzle/`. Output lands in `drizzle-prod-squash/`
 * which is gitignored so this prep doesn't disturb the dev journal.
 *
 * Generate with:
 *   docker compose exec server npx drizzle-kit generate \
 *     --config drizzle-prod-squash.config.ts --name initial
 */
import type { Config } from 'drizzle-kit';

export default {
  schema: './db/schema.ts',
  out: './drizzle-prod-squash',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
} satisfies Config;
