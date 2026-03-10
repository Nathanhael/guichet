import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import logger from '../utils/logger.js';
import config from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = config.DB_PATH;

// Initialize database
logger.info({ dbPath }, 'Initializing SQLite database');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Initialize schema
const schema = fs.readFileSync(path.join(path.dirname(config.DB_PATH), 'db', 'schema.sql'), 'utf8');
db.exec(schema);

// Migration: ensure users table has password column
try {
    const tableInfo = db.prepare('PRAGMA table_info(users)').all();
    const hasPassword = tableInfo.some(col => col.name === 'password');
    if (!hasPassword) {
        logger.info('Migrating users table: adding password column');
        db.prepare('ALTER TABLE users ADD COLUMN password TEXT').run();
    }
} catch (err) {
    logger.error({ err: err.message }, 'Failed to migrate users table');
}

export { db };

export function query(sql, params = []) {
    try {
        return db.prepare(sql).all(params);
    } catch (err) {
        logger.error({ err: err.message, sql, params }, 'Database query error');
        throw err;
    }
}

export function get(sql, params = []) {
    try {
        return db.prepare(sql).get(params);
    } catch (err) {
        logger.error({ err: err.message, sql, params }, 'Database get error');
        throw err;
    }
}

export function run(sql, params = []) {
    try {
        return db.prepare(sql).run(params);
    } catch (err) {
        logger.error({ err: err.message, sql, params }, 'Database run error');
        throw err;
    }
}

export function transaction(fn) {
    try {
        return db.transaction(fn)();
    } catch (err) {
        logger.error({ err: err.message }, 'Database transaction error');
        throw err;
    }
}
