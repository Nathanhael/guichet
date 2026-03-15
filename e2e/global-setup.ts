import pg from 'pg';
import bcrypt from 'bcrypt';
import { TEST_PARTNER_A, TEST_PARTNER_B, TEST_USERS } from './lib/constants.js';

const DB_URL = process.env.DATABASE_URL || 'postgresql://user:password@db:5432/tessera';

export default async function globalSetup() {
  const pool = new pg.Pool({ connectionString: DB_URL });

  try {
    const now = new Date().toISOString();

    // Create test partners (matches schema: id, name, industry, departments, created_at)
    for (const partner of [TEST_PARTNER_A, TEST_PARTNER_B]) {
      await pool.query(
        `INSERT INTO partners (id, name, industry, departments, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO NOTHING`,
        [partner.id, partner.name, partner.industry, JSON.stringify([{ id: 'DSC', label: 'Dispatch' }]), now]
      );
    }

    // Create test users (matches schema: id, name, lang, password)
    for (const [key, user] of Object.entries(TEST_USERS)) {
      const hash = await bcrypt.hash(user.password, 10);

      await pool.query(
        `INSERT INTO users (id, name, lang, password)
         VALUES ($1, $2, 'en', $3)
         ON CONFLICT (id) DO UPDATE SET password = $3`,
        [user.id, `E2E ${key}`, hash]
      );

      // Create membership (matches schema: id, user_id, partner_id, role, created_at)
      const membershipId = `e2e-membership-${key}`;
      await pool.query(
        `INSERT INTO memberships (id, user_id, partner_id, role, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET role = $4`,
        [membershipId, user.id, user.partnerId, user.role, now]
      );
    }

    console.log('E2E global setup: test data seeded');
  } finally {
    await pool.end();
  }
}
