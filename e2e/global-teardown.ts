import pg from 'pg';

const DB_URL = process.env.DATABASE_URL || 'postgresql://user:password@db:5432/tessera';

export default async function globalTeardown() {
  const pool = new pg.Pool({ connectionString: DB_URL });

  try {
    // Delete in reverse dependency order
    await pool.query(`DELETE FROM messages WHERE ticket_id IN (SELECT id FROM tickets WHERE partner_id LIKE 'test-partner-%')`);
    await pool.query(`DELETE FROM tickets WHERE partner_id LIKE 'test-partner-%'`);
    await pool.query(`DELETE FROM memberships WHERE partner_id LIKE 'test-partner-%'`);
    await pool.query(`DELETE FROM users WHERE id LIKE 'e2e-%'`);
    await pool.query(`DELETE FROM partners WHERE id LIKE 'test-partner-%'`);

    console.log('E2E global teardown: test data cleaned');
  } finally {
    await pool.end();
  }
}
