import { z } from 'zod';
import { router, platformProcedure } from '../../trpc.js';
import { db } from '../../../db.js';
import { auditLog, systemSettings } from '../../../db/schema.js';
import { eq, desc, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { randomUUID } from 'crypto';
import { getRedisClients } from '../../../utils/redis.js';
import logger from '../../../utils/logger.js';
import { MailService } from '../../../services/mail.js';
import { renderTestEmail } from '../../../services/mailTemplates.js';
import { encrypt } from '../../../services/encryption.js';
import { APP_NAME } from '../../../constants.js';

export const platformSystemRouter = router({
  getSystemHealth: platformProcedure.query(async () => {
    let lastPurgeAt: string | null = null;
    let gdprSuccess = false;

    try {
      const lastPurge = await db.select({ createdAt: auditLog.createdAt })
        .from(auditLog)
        .where(eq(auditLog.action, 'system.gdpr_purge'))
        .orderBy(desc(auditLog.createdAt))
        .limit(1);
      lastPurgeAt = lastPurge[0]?.createdAt || null;
      gdprSuccess = !!lastPurge[0];
    } catch (err) {
      logger.error({ err }, 'Health Check: Audit Log error');
    }

    const health = {
      postgres: false,
      redis: false,
      postgresConnections: 0,
      redisMemoryUsed: '0',
      gdprLastRun: lastPurgeAt || 'Never',
      gdprSuccess,
      gdprRecordsPurged: 0,
      gdprNextPurge: (() => {
        const next = new Date();
        next.setUTCDate(next.getUTCDate() + 1);
        next.setUTCHours(2, 0, 0, 0);
        return next.toISOString();
      })(),
    };

    try {
      const pgRes = await db.execute(sql`SELECT count(*) FROM pg_stat_activity`);
      health.postgres = true;
      health.postgresConnections = parseInt(String(pgRes.rows[0].count), 10);
    } catch (err) {
      logger.error({ err }, 'Health Check: Postgres error');
    }

    try {
      const { pubClient } = getRedisClients();
      if (pubClient) {
        await Promise.race([
          pubClient.ping(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Redis ping timeout')), 2000))
        ]);

        health.redis = true;
        const memoryInfo = await pubClient.info('memory');
        const match = memoryInfo.match(/used_memory_human:([^\r\n]+)/);
        if (match) {
          health.redisMemoryUsed = match[1];
        }
      }
    } catch (err) {
      logger.error({ err }, 'Health Check: Redis error');
    }

    return health;
  }),

  getMailConfig: platformProcedure.query(async () => {
    try {
      const config = await db.select()
        .from(systemSettings)
        .where(eq(systemSettings.key, 'mail_config'))
        .limit(1);

      const raw = (config[0]?.value as Record<string, unknown>) || { provider: 'none' };
      // Never return secrets (ciphertext OR plaintext) to the client — only
      // booleans indicating presence. Legacy plaintext `smtpPass` / `apiKey`
      // rows still exist in older installs until upgradeMailConfigEncryption
      // runs, so the has-flag must consider both forms.
      const { smtpPass, apiKey, encryptedSmtpPass, encryptedApiKey, ...safe } = raw;
      const hasSecret = (v: unknown) => typeof v === 'string' && v.length > 0;
      return {
        ...safe,
        hasSmtpPass: hasSecret(encryptedSmtpPass) || hasSecret(smtpPass),
        hasApiKey: hasSecret(encryptedApiKey) || hasSecret(apiKey),
      };
    } catch (err: unknown) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
    }
  }),

  updateMailConfig: platformProcedure
    .input(z.object({
      provider: z.enum(['none', 'smtp', 'resend', 'sendgrid']),
      apiKey: z.string().optional(),
      smtpHost: z.string().optional(),
      smtpPort: z.number().optional(),
      smtpUser: z.string().optional(),
      smtpPass: z.string().optional(),
      smtpSecure: z.boolean().default(true),
      fromEmail: z.string().email(),
      fromName: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        const before = await db.select().from(systemSettings).where(eq(systemSettings.key, 'mail_config')).limit(1);

        const existing = (before[0]?.value as Record<string, unknown>) || {};
        // Strip the plaintext secrets from the input before they hit the
        // stored object — they will be re-added only as ciphertext below.
        const { smtpPass: inputSmtpPass, apiKey: inputApiKey, ...inputRest } = input;
        const merged: Record<string, unknown> = { ...inputRest };

        // --- smtpPass handling ---
        if (inputSmtpPass) {
          // Client supplied a new value → encrypt fresh.
          merged.encryptedSmtpPass = encrypt(inputSmtpPass);
        } else if (existing.encryptedSmtpPass) {
          // Client omitted → keep existing ciphertext.
          merged.encryptedSmtpPass = existing.encryptedSmtpPass;
        } else if (typeof existing.smtpPass === 'string' && existing.smtpPass.length > 0) {
          // Legacy plaintext present → lazy upgrade to ciphertext on this write.
          merged.encryptedSmtpPass = encrypt(existing.smtpPass);
        }

        // --- apiKey handling (same rules) ---
        if (inputApiKey) {
          merged.encryptedApiKey = encrypt(inputApiKey);
        } else if (existing.encryptedApiKey) {
          merged.encryptedApiKey = existing.encryptedApiKey;
        } else if (typeof existing.apiKey === 'string' && existing.apiKey.length > 0) {
          merged.encryptedApiKey = encrypt(existing.apiKey);
        }

        // Belt-and-braces: the stored value MUST NOT contain plaintext secret
        // keys, even if some future code path tries to re-introduce them.
        delete (merged as Record<string, unknown>).smtpPass;
        delete (merged as Record<string, unknown>).apiKey;

        await db.insert(systemSettings)
          .values({
            key: 'mail_config',
            value: merged,
            updatedAt: new Date().toISOString()
          })
          .onConflictDoUpdate({
            target: systemSettings.key,
            set: { value: merged, updatedAt: new Date().toISOString() }
          });

        await db.insert(auditLog).values({
          id: randomUUID(),
          action: 'system.mail_config_updated',
          actorId: ctx.user.id,
          targetType: 'system',
          targetId: 'mail_config',
          metadata: {
            provider: input.provider,
            fromEmail: input.fromEmail,
            hasBefore: !!before[0]
          }
        });

        return { success: true };
      } catch (err: unknown) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
      }
    }),

  sendTestEmail: platformProcedure
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ input, ctx }) => {
      const html = renderTestEmail({ operatorId: ctx.user.id, timestamp: new Date().toLocaleString() });
      const success = await MailService.sendMail(input.email, `${APP_NAME} - Mail Configuration Test`, html);
      if (!success) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to send test email. Check server logs.' });
      }
      return { success: true };
    }),
});
