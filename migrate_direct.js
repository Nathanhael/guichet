
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'server', 'database.sqlite');
const db = new Database(dbPath);

console.log('Migrating roles from manager to admin...');

const result = db.prepare("UPDATE users SET role = 'admin' WHERE role = 'manager'").run();
console.log(`Updated ${result.changes} users from 'manager' to 'admin'.`);

const result2 = db.prepare("UPDATE users SET name = 'Admin Dirk' WHERE name = 'Manager Dirk' OR name = 'Dirk' AND role = 'admin'").run();
console.log(`Updated ${result2.changes} user names.`);

db.close();
console.log('Migration complete.');
