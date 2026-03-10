import { db } from './db/sqlite.js';

try {
    const result = db.prepare("UPDATE users SET role = 'admin' WHERE role = 'manager'").run();
    console.log(`Successfully migrated ${result.changes} roles from manager to admin.`);

    const result2 = db.prepare("UPDATE users SET name = 'Admin Dirk' WHERE id = 'u7'").run();
    console.log(`Updated Dirk's name.`);

} catch (err) {
    console.error('Migration failed:', err.message);
}
