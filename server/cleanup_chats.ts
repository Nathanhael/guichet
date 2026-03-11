import { db } from './db/sqlite.js';

console.log('Cleaning chat-related data...');

db.transaction(() => {
    const tables = [
        'messages',
        'ticket_labels',
        'ratings',
        'tickets',
        'app_feedback',
        'daily_stats',
        'llm_summaries',
        'translations_cache'
    ];

    for (const table of tables) {
        try {
            const result = db.prepare(`DELETE FROM ${table}`).run();
            console.log(`Cleared ${result.changes} rows from ${table}.`);
        } catch (err: any) {
            console.error(`Error clearing ${table}:`, err.message);
        }
    }
})();

console.log('Cleanup complete.');
process.exit(0);
