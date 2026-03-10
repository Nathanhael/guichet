import { db, transaction } from './db.js';
import logger from './utils/logger.js';

/**
 * This script migrates the existing database to the new schema with CASCADE and NOCASE.
 * SQLite doesn't support complex ALTER TABLE, so we recreate tables.
 */

try {
    logger.info('Starting schema migration (CASCADE and NOCASE)...');

    transaction(() => {
        // 1. Rename existing tables
        db.prepare('ALTER TABLE tickets RENAME TO old_tickets').run();
        db.prepare('ALTER TABLE messages RENAME TO old_messages').run();
        db.prepare('ALTER TABLE ratings RENAME TO old_ratings').run();
        db.prepare('ALTER TABLE app_feedback RENAME TO old_app_feedback').run();
        db.prepare('ALTER TABLE labels RENAME TO old_labels').run();
        db.prepare('ALTER TABLE ticket_labels RENAME TO old_ticket_labels').run();

        // 2. Create new tables (re-using the schema definitions)
        db.exec(`
-- Tickets table
CREATE TABLE tickets (
    id TEXT PRIMARY KEY,
    dept TEXT NOT NULL,
    agentId TEXT NOT NULL,
    agentName TEXT,
    agentLang TEXT,
    cdbId TEXT,
    dareRef TEXT,
    status TEXT DEFAULT 'open',
    expertId TEXT,
    expertName TEXT,
    expertLang TEXT,
    expertJoinedAt TEXT,
    createdAt TEXT NOT NULL,
    closedAt TEXT,
    closingNotes TEXT,
    closedBy TEXT,
    participants TEXT DEFAULT '[]',
    FOREIGN KEY(agentId) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(expertId) REFERENCES users(id) ON DELETE CASCADE
);

-- Messages table
CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    ticketId TEXT NOT NULL,
    senderId TEXT NOT NULL,
    senderName TEXT,
    text TEXT,
    translatedText TEXT,
    mediaUrl TEXT,
    whisper INTEGER DEFAULT 0,
    system INTEGER DEFAULT 0,
    createdAt TEXT NOT NULL,
    deliveredAt TEXT,
    readAt TEXT,
    reactions TEXT DEFAULT '{}',
    FOREIGN KEY(ticketId) REFERENCES tickets(id) ON DELETE CASCADE
);

-- Ticket Ratings table
CREATE TABLE ratings (
    id TEXT PRIMARY KEY,
    ticketId TEXT NOT NULL,
    agentId TEXT NOT NULL,
    expertId TEXT,
    rating INTEGER NOT NULL,
    comment TEXT,
    createdAt TEXT NOT NULL,
    FOREIGN KEY(ticketId) REFERENCES tickets(id) ON DELETE CASCADE,
    FOREIGN KEY(agentId) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(expertId) REFERENCES users(id) ON DELETE CASCADE
);

-- App Feedback table
CREATE TABLE app_feedback (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    userName TEXT,
    role TEXT,
    text TEXT NOT NULL,
    treated INTEGER DEFAULT 0,
    createdAt TEXT NOT NULL,
    FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE
);

-- Labels table
CREATE TABLE labels (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    color TEXT
);

-- Ticket Labels junction table
CREATE TABLE ticket_labels (
    ticketId TEXT NOT NULL,
    labelId TEXT NOT NULL,
    PRIMARY KEY(ticketId, labelId),
    FOREIGN KEY(ticketId) REFERENCES tickets(id) ON DELETE CASCADE,
    FOREIGN KEY(labelId) REFERENCES labels(id) ON DELETE CASCADE
);
        `);

        // 3. Migrate data
        db.prepare('INSERT INTO tickets SELECT * FROM old_tickets').run();
        db.prepare('INSERT INTO messages SELECT * FROM old_messages').run();
        db.prepare('INSERT INTO ratings SELECT * FROM old_ratings').run();
        db.prepare('INSERT INTO app_feedback SELECT * FROM old_app_feedback').run();
        db.prepare('INSERT INTO labels SELECT * FROM old_labels').run();
        db.prepare('INSERT INTO ticket_labels SELECT * FROM old_ticket_labels').run();

        // 4. Drop old tables
        db.prepare('DROP TABLE old_tickets').run();
        db.prepare('DROP TABLE old_messages').run();
        db.prepare('DROP TABLE old_ratings').run();
        db.prepare('DROP TABLE old_app_feedback').run();
        db.prepare('DROP TABLE old_labels').run();
        db.prepare('DROP TABLE old_ticket_labels').run();
    });

    logger.info('Schema migration completed successfully.');
} catch (err) {
    logger.error({ err: err.message }, 'Schema migration failed');
    process.exit(1);
}
