const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'server', 'database.sqlite');
const db = new Database(dbPath);

try {
    const labels = db.prepare('SELECT * FROM labels').all();
    console.log('Labels count:', labels.length);
    if (labels.length > 0) {
        const firstLabel = labels[0];
        console.log('Attempting to delete label:', firstLabel);

        // Check if in use
        const usage = db.prepare('SELECT COUNT(*) as count FROM ticket_labels WHERE labelId = ?').get(firstLabel.id);
        console.log('Label usage count in ticket_labels:', usage.count);

        try {
            const res = db.prepare('DELETE FROM labels WHERE id = ?').run(firstLabel.id);
            console.log('Delete result:', res);
        } catch (e) {
            console.error('Delete failed with error:', e.message);
        }
    }
} catch (err) {
    console.error('Test failed:', err.message);
} finally {
    db.close();
}
