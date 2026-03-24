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

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.DB_POOL_MAX || '30'),
  min: parseInt(process.env.DB_POOL_MIN || '5'),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (err) => {
  logger.error({ err: err.message }, 'Unexpected error on idle PostgreSQL client');
});

export const db = drizzle(pool, { schema });

// Convert snake_case keys to camelCase
function toCamelCase(str: string): string {
  return str.toLowerCase().replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

function camelCaseRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map(row => {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(row)) {
      out[toCamelCase(key)] = row[key];
    }
    return out;
  });
}

// Helper for traditional query patterns if needed, though drizzle is preferred
export const query = async (text: string, params?: unknown[]) => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    logger.debug({ text, duration, rows: res.rowCount }, 'Executed query');
    return camelCaseRows(res.rows);
  } catch (err: unknown) {
    logger.error({ err: err instanceof Error ? err.message : String(err), text, params }, 'Database query error');
    throw err;
  }
};

export const get = async (text: string, params?: unknown[]) => {
  const rows = await query(text, params);
  return rows[0];
};

export const run = async (text: string, params?: unknown[]) => {
  const res = await pool.query(text, params);
  return { changes: res.rowCount };
};

export const transaction = async <T>(cb: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>): Promise<T> => {
  return await db.transaction(async (tx) => {
    return await cb(tx);
  });
};
