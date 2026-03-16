/**
 * Global setup for E2E tests.
 * This script runs ONCE before all tests.
 * It triggers the server-side seed endpoint to ensure 
 * the database is in a consistent state with the correct passwords.
 */
export default async function globalSetup() {
  const API_URL = 'http://server:3001';
  console.log(`🚀 E2E Global Setup: Triggering seed at ${API_URL}/api/v1/seed-e2e...`);
  
  let success = false;
  let attempts = 0;
  const maxAttempts = 10;

  while (!success && attempts < maxAttempts) {
    try {
      const res = await fetch(`${API_URL}/api/v1/seed-e2e`, { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (res.ok) {
        const data = await res.json();
        console.log('✅ E2E Global Setup: Database seeded successfully.', data);
        success = true;
      } else {
        const text = await res.text();
        console.warn(`⚠️ Seed attempt ${attempts + 1} failed: ${res.status} ${text}`);
      }
    } catch (err) {
      console.warn(`⚠️ Seed attempt ${attempts + 1} connection failed, retrying in 2s...`);
      await new Promise(r => setTimeout(r, 2000));
    }
    attempts++;
  }

  if (!success) {
    console.error('❌ E2E Global Setup: Failed to seed database after all attempts.');
    process.exit(1);
  }
}
