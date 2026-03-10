const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Path to the database
const dbPath = path.join(__dirname, '..', 'server', 'database.sqlite');

console.log('Connecting to database at:', dbPath);

if (!fs.existsSync(dbPath)) {
    console.error('Database file not found!');
    process.exit(1);
}

const db = new Database(dbPath);

const tablesToClear = [
    'tickets',
    'messages',
    'ratings',
    'app_feedback',
    'labels',
    'ticket_labels',
    'daily_stats',
    'translations_cache',
    'llm_summaries',
    'canned_responses'
];

try {
    console.log('Disabling foreign keys...');
    db.pragma('foreign_keys = OFF');

    db.transaction(() => {
        for (const table of tablesToClear) {
            console.log(`Clearing table: ${table}...`);
            // Check if table exists before deleting
            const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
            if (tableExists) {
                db.prepare(`DELETE FROM ${table}`).run();
            } else {
                console.warn(`Table ${table} does not exist, skipping.`);
            }
        }
    })();

    console.log('Vacuuming database...');
    db.prepare('VACUUM').run();

    console.log('Re-enabling foreign keys...');
    db.pragma('foreign_keys = ON');

    console.log('Database cleanup successful!');
} catch (err) {
    console.error('Database cleanup failed:', err.message);
    process.exit(1);
} finally {
    db.close();
}
