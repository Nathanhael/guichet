import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/postgres.js';
import { users, auditLog, systemSettings } from '../db/schema.js';
import config from '../config.js';
import logger from '../utils/logger.js';
import { hashPassword } from '../utils/passwords.js';
import { encrypt } from './encryption.js';

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
        action: 'platform_operator_bootstrap',
        actorId: null,
        partnerId: null,
        targetType: 'user',
        targetId: userId,
        metadata: { email, bootstrapAction: 'promoted' },
      });

      logger.info(`Existing user promoted to platform operator: ${email}`);
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
        ? await hashPassword(config.PLATFORM_ADMIN_PASSWORD)
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
        action: 'platform_operator_bootstrap',
        actorId: null,
        partnerId: null,
        targetType: 'user',
        targetId: userId,
        metadata: { email, bootstrapAction: 'created' },
      });

      logger.info(`Platform operator bootstrapped: ${email}`);
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

/**
 * One-shot migration: re-encrypt any plaintext smtpPass / apiKey values in the
 * `mail_config` row of `system_settings`. Idempotent — rows that already have
 * only ciphertext fields are left alone.
 *
 * Guarded on the encryption key being configured, so dev machines without
 * FIELD_ENCRYPTION_SECRET / AI_KEY_ENCRYPTION_SECRET still boot cleanly
 * (the encrypt() helper would otherwise throw). The production hardening
 * check in config.ts already refuses to boot prod without the secret.
 */
export async function upgradeMailConfigEncryption(): Promise<void> {
  try {
    if (!config.FIELD_ENCRYPTION_SECRET && !config.AI_KEY_ENCRYPTION_SECRET) {
      // Skip silently on dev without a key — encrypt() would throw.
      return;
    }

    const rows = await db
      .select()
      .from(systemSettings)
      .where(eq(systemSettings.key, 'mail_config'))
      .limit(1);

    if (rows.length === 0) return;

    const stored = (rows[0].value as Record<string, unknown>) || {};
    const legacySmtpPass = typeof stored.smtpPass === 'string' ? stored.smtpPass : undefined;
    const legacyApiKey = typeof stored.apiKey === 'string' ? stored.apiKey : undefined;

    // Nothing to upgrade.
    if (!legacySmtpPass && !legacyApiKey) return;

    const upgraded: Record<string, unknown> = { ...stored };
    let smtpUpgraded = false;
    let apiUpgraded = false;

    if (legacySmtpPass && !stored.encryptedSmtpPass) {
      upgraded.encryptedSmtpPass = encrypt(legacySmtpPass);
      smtpUpgraded = true;
    }
    if (legacyApiKey && !stored.encryptedApiKey) {
      upgraded.encryptedApiKey = encrypt(legacyApiKey);
      apiUpgraded = true;
    }

    // Belt-and-braces: drop the plaintext keys regardless of which one existed.
    delete upgraded.smtpPass;
    delete upgraded.apiKey;

    await db
      .update(systemSettings)
      .set({ value: upgraded, updatedAt: new Date().toISOString() })
      .where(eq(systemSettings.key, 'mail_config'));

    await db.insert(auditLog).values({
      action: 'system.mail_config_encrypted_upgrade',
      actorId: null,
      partnerId: null,
      targetType: 'system',
      targetId: 'mail_config',
      metadata: { smtpUpgraded, apiUpgraded },
    });

    logger.info({ smtpUpgraded, apiUpgraded }, '[bootstrap] mail_config plaintext secrets re-encrypted');
  } catch (err) {
    logger.error({ err }, '[bootstrap] upgradeMailConfigEncryption failed — leaving row untouched');
  }
}
