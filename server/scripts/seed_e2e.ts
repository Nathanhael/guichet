import bcrypt from 'bcrypt';
import pg from 'pg';
import { v4 as uuidv4 } from 'uuid';

const DB_URL = process.env.DATABASE_URL || 'postgresql://user:password@db:5432/tessera';

const TEST_PARTNER_A = { id: 'test-partner-a', name: 'Test Partner A', industry: 'Technology' };
const TEST_PARTNER_B = { id: 'test-partner-b', name: 'Test Partner B', industry: 'Technology' };
const DEFAULT_PARTNER = { id: 'tessera-main', name: 'Tessera Main', industry: 'Telecommunications' };

const TEST_USERS = [
  { id: 'e2e-agent-a', name: 'E2E Agent A', role: 'agent', partnerId: TEST_PARTNER_A.id, lang: 'en' },
  { id: 'e2e-support-a', name: 'E2E Support A', role: 'support', partnerId: TEST_PARTNER_A.id, lang: 'en' },
  { id: 'e2e-admin-a', name: 'E2E Admin A', role: 'admin', partnerId: TEST_PARTNER_A.id, lang: 'en' },
  { id: 'e2e-support-b', name: 'E2E Support B', role: 'support', partnerId: TEST_PARTNER_B.id, lang: 'en' },
  // Demo Users
  { id: 'agent_jan', name: 'Agent Jan', role: 'agent', partnerId: DEFAULT_PARTNER.id, lang: 'nl' },
  { id: 'agent_marie', name: 'Agent Marie', role: 'agent', partnerId: DEFAULT_PARTNER.id, lang: 'fr' },
  { id: 'agent_tom', name: 'Agent Tom', role: 'agent', partnerId: DEFAULT_PARTNER.id, lang: 'en' },
  { id: 'expert_piet', name: 'Expert Piet', role: 'support', partnerId: DEFAULT_PARTNER.id, lang: 'nl' },
  { id: 'expert_sophie', name: 'Expert Sophie', role: 'support', partnerId: DEFAULT_PARTNER.id, lang: 'fr' },
  { id: 'expert_alex', name: 'Expert Alex', role: 'support', partnerId: DEFAULT_PARTNER.id, lang: 'en' },
  { id: 'admin_dirk', name: 'Admin Dirk', role: 'admin', partnerId: DEFAULT_PARTNER.id, lang: 'nl' }
];

async function seed() {
  const pool = new pg.Pool({ connectionString: DB_URL });
  console.log('🌱 Starting E2E server-side seed...');

  try {
    const now = new Date().toISOString();
    const hash = await bcrypt.hash('password123', 10);

    // 1. Clean old data
    await pool.query('TRUNCATE memberships, tickets, messages, ratings, app_feedback, topic_alerts CASCADE');
    await pool.query("DELETE FROM users WHERE id LIKE 'e2e-%' OR id LIKE 'agent_%' OR id LIKE 'expert_%' OR id LIKE 'admin_%'");
    await pool.query("DELETE FROM partners WHERE id LIKE 'test-partner-%' OR id = 'tessera-main'");

    // 2. Insert Partners
    for (const p of [TEST_PARTNER_A, TEST_PARTNER_B, DEFAULT_PARTNER]) {
      console.log(`  - Partner: ${p.id}`);
      await pool.query(
        `INSERT INTO partners (id, name, industry, departments, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [p.id, p.name, p.industry, JSON.stringify([{ id: 'DSC', label: 'Dispatch' }, { id: 'FOT', label: 'Front Office' }]), now]
      );
    }

    // 3. Insert Users & Memberships
    for (const u of TEST_USERS) {
      console.log(`  - User: ${u.id}`);
      await pool.query(
        `INSERT INTO users (id, name, lang, password)
         VALUES ($1, $2, $3, $4)`,
        [u.id, u.name, u.lang, hash]
      );

      await pool.query(
        `INSERT INTO memberships (id, user_id, partner_id, role, dept, created_at)
         VALUES ($1, $2, $3, $4, 'DSC', $5)`,
        [`mem_${u.id}`, u.id, u.partnerId, u.role, now]
      );
    }

    console.log('✅ E2E server-side seed complete.');
  } catch (err) {
    console.error('❌ E2E Seed failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seed();
