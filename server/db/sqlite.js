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

// Migrations
try {
    const tableInfo = db.prepare('PRAGMA table_info(users)').all();
    if (!tableInfo.some(col => col.name === 'password')) {
        logger.info('Migrating users table: adding password column');
        db.prepare('ALTER TABLE users ADD COLUMN password TEXT').run();
    }

    const messageInfo = db.prepare('PRAGMA table_info(messages)').all();
    const messageCols = [
        { name: 'senderRole', type: 'TEXT' },
        { name: 'senderLang', type: 'TEXT' },
        { name: 'originalText', type: 'TEXT' },
        { name: 'improvedText', type: 'TEXT' },
        { name: 'processedText', type: 'TEXT' },
        { name: 'translationSkipped', type: 'INTEGER DEFAULT 0' },
        { name: 'fallback', type: 'INTEGER DEFAULT 0' },
        { name: 'timestamp', type: 'TEXT' }
    ];
    messageCols.forEach(col => {
        if (!messageInfo.some(c => c.name === col.name)) {
            logger.info(`Migrating messages table: adding ${col.name} column`);
            db.prepare(`ALTER TABLE messages ADD COLUMN ${col.name} ${col.type}`).run();
        }
    });

    // Populate timestamp if it was missing and createdAt exists
    if (messageInfo.some(c => c.name === 'createdAt') && messageInfo.some(c => c.name === 'timestamp')) {
        db.prepare("UPDATE messages SET timestamp = createdAt WHERE timestamp IS NULL").run();
    }

    const ticketInfo = db.prepare('PRAGMA table_info(tickets)').all();
    if (!ticketInfo.some(col => col.name === 'summary')) {
        logger.info('Migrating tickets table: adding summary column');
        db.prepare('ALTER TABLE tickets ADD COLUMN summary TEXT').run();
    }
} catch (err) {
    logger.error({ err: err.message }, 'Migration failed');
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
