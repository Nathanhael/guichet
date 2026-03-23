/**
 * Reset all demo users to a clean state.
 * - Resets passwords to 'password123'
 * - Clears lockout state (failedLoginAttempts, lockedUntil)
 * - Clears MFA (mfaSecret, mfaEnabledAt, mfaRecoveryCodes)
 * - Clears password history
 * - Ensures all demo users exist (re-seeds missing ones)
 *
 * Usage: docker compose exec server npx tsx scripts/reset_demo_users.ts
 */
import { db } from '../db.js';
import { users, memberships, partners } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { hashPassword } from '../utils/passwords.js';

const DEMO_PASSWORD = 'password123';
const PARTNER_ID = 'tessera-main';

async function ensurePartner() {
  const existing = await db.select({ id: partners.id }).from(partners).where(eq(partners.id, PARTNER_ID)).limit(1);
  if (existing.length > 0) return;
  console.log('  Creating partner "Tessera Main"...');
  await db.insert(partners).values({
    id: PARTNER_ID,
    name: 'Tessera Main',
    industry: 'Telecommunications',
    departments: [
      { id: 'dispatch', name: 'Dispatch', description: 'Field dispatch and routing' },
      { id: 'front-office', name: 'Front Office', description: 'Customer-facing support' },
      { id: 'billing', name: 'Billing', description: 'Invoicing and payments' },
    ],
    status: 'active',
    authMethod: 'local',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

const DEMO_USERS = [
  { id: 'agent_jan',     name: 'Jan Peeters',     email: 'jan@tessera.demo',     role: 'agent',   departments: ['dispatch'],     lang: 'nl' },
  { id: 'agent_marie',   name: 'Marie Dubois',    email: 'marie@tessera.demo',   role: 'agent',   departments: ['front-office'], lang: 'fr' },
  { id: 'agent_tom',     name: 'Tom Williams',    email: 'tom@tessera.demo',     role: 'agent',   departments: ['dispatch'],     lang: 'en' },
  { id: 'agent_lisa',    name: 'Lisa Janssens',   email: 'lisa@tessera.demo',    role: 'agent',   departments: ['billing'],      lang: 'nl' },
  { id: 'agent_karim',   name: 'Karim Benali',    email: 'karim@tessera.demo',   role: 'agent',   departments: ['front-office'], lang: 'fr' },
  { id: 'expert_piet',   name: 'Piet Van Damme',  email: 'piet@tessera.demo',    role: 'support', departments: ['dispatch'],     lang: 'nl' },
  { id: 'expert_sophie', name: 'Sophie Laurent',  email: 'sophie@tessera.demo',  role: 'support', departments: ['front-office'], lang: 'fr' },
  { id: 'expert_alex',   name: 'Alex Johnson',    email: 'alex@tessera.demo',    role: 'support', departments: [],               lang: 'en' },
  { id: 'admin_dirk',    name: 'Dirk De Smedt',   email: 'dirk@tessera.demo',    role: 'admin',   departments: [],               lang: 'nl' },
  { id: 'platform_bart', name: 'Bart Operator',   email: 'bart@tessera.demo',    role: 'admin',   departments: [],               lang: 'nl', isPlatformOperator: true },
] as const;

async function resetDemoUsers() {
  console.log('Resetting demo users...\n');

  await ensurePartner();
  const hashedPassword = await hashPassword(DEMO_PASSWORD);
  let resetCount = 0;
  let createdCount = 0;

  for (const u of DEMO_USERS) {
    const existing = await db.select({ id: users.id }).from(users).where(eq(users.id, u.id)).limit(1);

    if (existing.length > 0) {
      // Reset existing user
      await db.update(users).set({
        password: hashedPassword,
        failedLoginAttempts: 0,
        lockedUntil: null,
        mfaSecret: null,
        mfaEnabledAt: null,
        mfaRecoveryCodes: [],
        passwordHistory: [],
        passwordChangedAt: null,
        resetPasswordToken: null,
        resetPasswordExpires: null,
        platformTotpSecret: null,
        platformTotpEnabledAt: null,
        deletedAt: null,
        isPlatformOperator: 'isPlatformOperator' in u ? u.isPlatformOperator : false,
        updatedAt: new Date().toISOString(),
      }).where(eq(users.id, u.id));

      console.log(`  ✓ Reset ${u.id} (${u.name})`);
      resetCount++;
    } else {
      // Create missing user
      await db.insert(users).values({
        id: u.id,
        name: u.name,
        email: u.email,
        lang: u.lang as 'nl' | 'fr' | 'en',
        password: hashedPassword,
        isPlatformOperator: 'isPlatformOperator' in u ? u.isPlatformOperator : false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Create membership
      const existingMem = await db.select({ id: memberships.id }).from(memberships)
        .where(eq(memberships.id, `mem_${u.id}`)).limit(1);
      if (existingMem.length === 0) {
        await db.insert(memberships).values({
          id: `mem_${u.id}`,
          userId: u.id,
          partnerId: PARTNER_ID,
          role: u.role as 'agent' | 'support' | 'admin',
          departments: [...u.departments],
          createdAt: new Date().toISOString(),
        });
      }

      console.log(`  + Created ${u.id} (${u.name})`);
      createdCount++;
    }
  }

  console.log(`\nDone! Reset: ${resetCount}, Created: ${createdCount}`);
  console.log(`All demo users have password: ${DEMO_PASSWORD}`);
  process.exit(0);
}

resetDemoUsers().catch((err) => {
  console.error('Reset failed:', err);
  process.exit(1);
});
