import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { hash } from 'bcryptjs';
import { db } from '../db/postgres.js';
import { users, auditLog } from '../db/schema.js';
import config from '../config.js';
import logger from '../utils/logger.js';

// PostgreSQL unique-violation error code
const PG_UNIQUE_VIOLATION = '23505';

export async function bootstrapPlatformOperator(): Promise<void> {
  try {
    // 1. Check if any platform operator already exists
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.isPlatformOperator, true))
      .limit(1);

    if (existing.length > 0) {
      return; // Nothing to do — platform operator already exists
    }

    // 2. Check if bootstrap email is configured
    if (!config.PLATFORM_ADMIN_EMAIL) {
      logger.warn(
        'No platform operator exists. Set PLATFORM_ADMIN_EMAIL to bootstrap one.'
      );
      return;
    }

    const email = config.PLATFORM_ADMIN_EMAIL;

    // 3. Check if a user with that email already exists
    const byEmail = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (byEmail.length > 0) {
      // Promote existing user to platform operator
      const userId = byEmail[0].id;

      await db
        .update(users)
        .set({ isPlatformOperator: true, updatedAt: new Date().toISOString() })
        .where(eq(users.id, userId));

      await db.insert(auditLog).values({
        action: 'platform_operator.bootstrapped',
        actorId: userId,
        partnerId: null,
        targetType: 'user',
        targetId: userId,
        metadata: { email, bootstrapAction: 'promoted' },
      });

      logger.info({ userId, email }, 'Existing user promoted to platform operator');
    } else {
      // Create a new platform operator user
      const userId = `u_${randomUUID().replace(/-/g, '').substring(0, 12)}`;

      // Derive display name from the local part of the email
      const localPart = email.split('@')[0] ?? '';
      const name =
        localPart.length > 0
          ? localPart.charAt(0).toUpperCase() + localPart.slice(1)
          : email;

      // Hash password only if one is configured; otherwise null (SSO path)
      const hashedPassword = config.PLATFORM_ADMIN_PASSWORD
        ? await hash(config.PLATFORM_ADMIN_PASSWORD, 10)
        : null;

      await db.insert(users).values({
        id: userId,
        email,
        name,
        password: hashedPassword,
        isPlatformOperator: true,
        lang: 'en',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      await db.insert(auditLog).values({
        action: 'platform_operator.bootstrapped',
        actorId: userId,
        partnerId: null,
        targetType: 'user',
        targetId: userId,
        metadata: { email, bootstrapAction: 'created' },
      });

      logger.info({ userId, email }, 'New platform operator created via bootstrap');
    }
  } catch (err: unknown) {
    // Silently ignore unique-violation — another instance already bootstrapped
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: string }).code === PG_UNIQUE_VIOLATION
    ) {
      return;
    }

    // All other errors are logged but not re-thrown — bootstrap is non-fatal
    logger.error({ err }, 'Bootstrap platform operator failed');
  }
}
