import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';
import config from '../config.js';
import logger from '../utils/logger.js';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://user:password@localhost:5432/i_pxs_support',
});

pool.on('error', (err) => {
  logger.error({ err: err.message }, 'Unexpected error on idle PostgreSQL client');
});

export const db = drizzle(pool, { schema });

// Helper for traditional query patterns if needed, though drizzle is preferred
export const query = async (text: string, params?: any[]) => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    logger.debug({ text, duration, rows: res.rowCount }, 'Executed query');
    return res.rows;
  } catch (err: any) {
    logger.error({ err: err.message, text, params }, 'Database query error');
    throw err;
  }
};

export const get = async (text: string, params?: any[]) => {
  const rows = await query(text, params);
  return rows[0];
};

export const run = async (text: string, params?: any[]) => {
  const res = await pool.query(text, params);
  return { changes: res.rowCount };
};

export const transaction = async <T>(cb: () => Promise<T>): Promise<T> => {
  return await db.transaction(async (tx) => {
    return await cb();
  });
};
