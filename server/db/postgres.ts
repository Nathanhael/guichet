import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';
import logger from '../utils/logger.js';

const { Pool, types } = pg;

// Return timestamp/timestamptz columns as raw strings instead of Date objects.
// The codebase treats these as ISO strings (matching Drizzle's `mode: 'string'`).
types.setTypeParser(1114, (val: string) => val); // timestamp
types.setTypeParser(1184, (val: string) => val); // timestamptz

if (!process.env.DATABASE_URL) {
  throw new Error('FATAL: DATABASE_URL environment variable is required');
}

const poolMax = parseInt(process.env.DB_POOL_MAX || '30');
const poolMin = parseInt(process.env.DB_POOL_MIN || '5');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number.isNaN(poolMax) ? 30 : poolMax,
  min: Number.isNaN(poolMin) ? 5 : poolMin,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  ssl: process.env.DB_SSL === 'false' ? false : (process.env.DB_SSL ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' } : undefined),
});

pool.on('error', (err) => {
  logger.error({ err: err.message }, 'Unexpected error on idle PostgreSQL client');
});

export { pool };
export const db = drizzle(pool, { schema });
