import { db } from '../db/postgres.js';
import { users, auditLog } from '../db/schema.js';
import { isNotNull, eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import logger from '../utils/logger.js';

/**
 * PURGE LOCAL PASSWORDS
 * 
 * This script removes all local Argon2id password hashes from the users table.
 * After running this, ALL users (including platform operators) must authenticate
 * via the configured SSO provider (e.g., Azure Entra ID).
 * 
 * Use this when transitioning from a 'Hybrid' development environment to a
 * 'Single SSO' production environment.
 */
async function purgePasswords() {
  try {
    logger.info('[Purge] Starting local password cleanup...');

    // 1. Identify users with local passwords
    const usersWithPasswords = await db
      .select({ id: users.id, email: users.email, isPlatformOperator: users.isPlatformOperator })
      .from(users)
      .where(isNotNull(users.password));

    if (usersWithPasswords.length === 0) {
      logger.info('[Purge] No local passwords found. System is already SSO-only.');
      process.exit(0);
    }

    logger.info(`[Purge] Found ${usersWithPasswords.length} users with local passwords.`);

    // 2. Clear passwords and password history
    const result = await db
      .update(users)
      .set({ 
        password: null,
        passwordHistory: [],
        resetPasswordToken: null,
        resetPasswordExpires: null,
        updatedAt: new Date().toISOString()
      })
      .where(isNotNull(users.password));

    // 3. Audit the purge
    await db.insert(auditLog).values(
      usersWithPasswords.map(u => ({
        id: randomUUID(),
        action: 'system.password_purge',
        actorId: null, // System action
        partnerId: null,
        targetType: 'user',
        targetId: u.id,
        metadata: { 
          email: u.email, 
          isPlatformOperator: u.isPlatformOperator,
          reason: 'Production SSO-only transition'
        }
      }))
    );

    logger.info('[Purge] Successfully cleared all local passwords and histories.');
    logger.info('[Purge] Audit logs created for all affected accounts.');
    
    process.exit(0);
  } catch (err) {
    logger.error({ err }, '[Purge] FATAL: Failed to purge passwords');
    process.exit(1);
  }
}

purgePasswords();
