import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_JSON_PATH = path.join(__dirname, '..', 'db.json');
const PG_URL = process.env.DATABASE_URL || 'postgres://user:password@localhost:5432/tessera';

async function migrateUsers() {
  console.log('🚀 Starting user migration from db.json to PostgreSQL...');
  
  if (!fs.existsSync(DB_JSON_PATH)) {
    console.error(`❌ db.json not found at ${DB_JSON_PATH}`);
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(DB_JSON_PATH, 'utf8'));
  const users = data.users || [];
  
  console.log(`👥 Found ${users.length} users in db.json`);

  const pgPool = new Pool({ connectionString: PG_URL });

  try {
    for (const u of users) {
      console.log(`👤 Migrating user: ${u.name} (${u.id})...`);
      await pgPool.query(
        'INSERT INTO users (id, name, role, dept, lang, password) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role, dept = EXCLUDED.dept, lang = EXCLUDED.lang',
        [u.id, u.name, u.role, u.dept, u.lang, u.password || null]
      );
    }
    console.log('✅ User migration completed successfully!');
  } catch (err: unknown) {
    console.error('❌ Migration failed:', (err as Error).message);
  } finally {
    await pgPool.end();
  }
}

migrateUsers();
