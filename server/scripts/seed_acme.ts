import bcrypt from 'bcryptjs';
import pg from 'pg';
import { randomUUID } from 'crypto';

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://user:password@localhost:5432/tessera',
});

async function run() {
  console.log('🌱 Seeding New Partner: Acme Corp...');

  const partnerId = 'acme-corp';
  const hashedPassword = await bcrypt.hash('password123', 10);

  try {
    // 1. Create Partner
    await pool.query(`
      INSERT INTO partners (id, name, industry, status, departments)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
    `, [partnerId, 'Acme Corp', 'Manufacturing', 'active', JSON.stringify([
      { id: 'PROD', name: 'Production', isActive: true },
      { id: 'LOG', name: 'Logistics', isActive: true },
      { id: 'SAFE', name: 'Safety', isActive: true }
    ])]);

    // 2. Create Users & Memberships
    const usersToCreate = [
      { id: 'acme_admin', name: 'Alice Admin', role: 'admin', email: 'alice@acme.com' },
      { id: 'acme_support_1', name: 'Sam Support', role: 'support', email: 'sam@acme.com' },
      { id: 'acme_agent_1', name: 'John Agent', role: 'agent', email: 'john@acme.com' },
      { id: 'acme_agent_2', name: 'Sarah Agent', role: 'agent', email: 'sarah@acme.com' },
    ];

    for (const u of usersToCreate) {
      // Create User
      await pool.query(`
        INSERT INTO users (id, name, email, password, lang)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (id) DO NOTHING
      `, [u.id, u.name, u.email, hashedPassword, 'en']);

      // Create Membership
      await pool.query(`
        INSERT INTO memberships (id, user_id, partner_id, role, departments)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT DO NOTHING
      `, [randomUUID(), u.id, partnerId, u.role, JSON.stringify([])]);
    }

    console.log('✅ Acme Corp partner and users created successfully.');
  } catch (err) {
    console.error('❌ Seeding failed:', err);
  } finally {
    await pool.end();
  }
}

run();
