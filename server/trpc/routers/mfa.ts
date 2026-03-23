import crypto from 'crypto';
import { z } from 'zod/v4';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc.js';
import { db } from '../../db.js';
import { users, auditLog } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { generateTotpSecret, buildTotpUri, verifyTotpToken } from '../../services/platformStepUp.js';
import { MailService } from '../../services/mail.js';
import logger from '../../utils/logger.js';

const RECOVERY_CODE_COUNT = 8;

function generateRecoveryCodes(): { plain: string[]; hashed: string[] } {
  const plain: string[] = [];
  const hashed: string[] = [];
  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
    const code = crypto.randomBytes(4).toString('hex'); // 8-char hex codes
    plain.push(code);
    hashed.push(crypto.createHash('sha256').update(code).digest('hex'));
  }
  return { plain, hashed };
}

export const mfaRouter = router({
  /**
   * Get current MFA status for the authenticated user.
   */
  getStatus: protectedProcedure.query(async ({ ctx }) => {
    const userRows = await db.select({
      mfaEnabledAt: users.mfaEnabledAt,
    }).from(users).where(eq(users.id, ctx.user.id)).limit(1);

    const user = userRows[0];
    return {
      enabled: !!user?.mfaEnabledAt,
      enabledAt: user?.mfaEnabledAt ?? '',
    };
  }),

  /**
   * Begin MFA setup — generates a secret and returns the QR URI.
   * Does NOT enable MFA yet — the user must verify a code first.
   */
  beginSetup: protectedProcedure.mutation(async ({ ctx }) => {
    const userRows = await db.select({
      email: users.email,
      mfaEnabledAt: users.mfaEnabledAt,
    }).from(users).where(eq(users.id, ctx.user.id)).limit(1);

    const user = userRows[0];
    if (user?.mfaEnabledAt) {
      throw new TRPCError({ code: 'CONFLICT', message: 'MFA is already enabled' });
    }

    const { secret, manualEntryKey } = generateTotpSecret();
    const email = user?.email || ctx.user.id;
    const uri = buildTotpUri(email, secret);

    // Store the secret (not yet enabled — mfaEnabledAt stays null)
    await db.update(users).set({ mfaSecret: secret }).where(eq(users.id, ctx.user.id));

    return { uri, manualEntryKey };
  }),

  /**
   * Verify a TOTP code and enable MFA. Returns recovery codes (shown once).
   */
  enable: protectedProcedure
    .input(z.object({ code: z.string().length(6) }))
    .mutation(async ({ ctx, input }) => {
      const userRows = await db.select({
        mfaSecret: users.mfaSecret,
        mfaEnabledAt: users.mfaEnabledAt,
        email: users.email,
        name: users.name,
      }).from(users).where(eq(users.id, ctx.user.id)).limit(1);

      const user = userRows[0];
      if (user?.mfaEnabledAt) {
        throw new TRPCError({ code: 'CONFLICT', message: 'MFA is already enabled' });
      }
      if (!user?.mfaSecret) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Call beginSetup first' });
      }

      if (!verifyTotpToken(user.mfaSecret, input.code)) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid code. Try again.' });
      }

      const { plain, hashed } = generateRecoveryCodes();

      await db.update(users).set({
        mfaEnabledAt: new Date().toISOString(),
        mfaRecoveryCodes: hashed,
      }).where(eq(users.id, ctx.user.id));

      await db.insert(auditLog).values({
        action: 'security.mfa_enabled',
        actorId: ctx.user.id,
        targetType: 'user',
        targetId: ctx.user.id,
        metadata: {},
      });

      logger.info({ userId: ctx.user.id }, '[MFA] Enabled for user');

      // Send confirmation email (fire-and-forget)
      if (user.email) {
        MailService.sendMfaEnabled(user.email, user.name).catch(() => {});
      }

      return { recoveryCodes: plain };
    }),

  /**
   * Disable MFA. Requires a valid TOTP code.
   */
  disable: protectedProcedure
    .input(z.object({ code: z.string().min(6) }))
    .mutation(async ({ ctx, input }) => {
      const userRows = await db.select({
        mfaSecret: users.mfaSecret,
        mfaEnabledAt: users.mfaEnabledAt,
        mfaRecoveryCodes: users.mfaRecoveryCodes,
      }).from(users).where(eq(users.id, ctx.user.id)).limit(1);

      const user = userRows[0];
      if (!user?.mfaEnabledAt || !user.mfaSecret) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'MFA is not enabled' });
      }

      if (!verifyTotpToken(user.mfaSecret, input.code)) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid code' });
      }

      await db.update(users).set({
        mfaSecret: null,
        mfaEnabledAt: null,
        mfaRecoveryCodes: [],
      }).where(eq(users.id, ctx.user.id));

      await db.insert(auditLog).values({
        action: 'security.mfa_disabled',
        actorId: ctx.user.id,
        targetType: 'user',
        targetId: ctx.user.id,
        metadata: {},
      });

      logger.info({ userId: ctx.user.id }, '[MFA] Disabled for user');

      return { success: true };
    }),

  /**
   * Regenerate recovery codes. Requires a valid TOTP code.
   */
  regenerateRecoveryCodes: protectedProcedure
    .input(z.object({ code: z.string().length(6) }))
    .mutation(async ({ ctx, input }) => {
      const userRows = await db.select({
        mfaSecret: users.mfaSecret,
        mfaEnabledAt: users.mfaEnabledAt,
      }).from(users).where(eq(users.id, ctx.user.id)).limit(1);

      const user = userRows[0];
      if (!user?.mfaEnabledAt || !user.mfaSecret) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'MFA is not enabled' });
      }

      if (!verifyTotpToken(user.mfaSecret, input.code)) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid code' });
      }

      const { plain, hashed } = generateRecoveryCodes();

      await db.update(users).set({ mfaRecoveryCodes: hashed }).where(eq(users.id, ctx.user.id));

      logger.info({ userId: ctx.user.id }, '[MFA] Recovery codes regenerated');

      return { recoveryCodes: plain };
    }),
});
