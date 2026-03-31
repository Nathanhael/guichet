import { TRPCError } from '@trpc/server';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { db } from '../../db.js';
import { auditLog, users } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { router, platformBaseProcedure } from '../trpc.js';
import { checkLockout, recordFailedLogin, resetFailedLogins } from '../../services/accountLockout.js';
import { buildAuthToken, setAuthCookie, parseExpiryToSeconds } from '../../services/authSession.js';
import config from '../../config.js';
import {
  buildTotpUri,
  generateTotpSecret,
  getCurrentUnixTime,
  getPlatformStepUpExpiry,
  isPlatformStepUpSatisfied,
  verifyTotpToken,
} from '../../services/platformStepUp.js';

async function getPlatformSecurityUser(userId: string) {
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      isPlatformOperator: users.isPlatformOperator,
      platformTotpSecret: users.platformTotpSecret,
      platformTotpEnabledAt: users.platformTotpEnabledAt,
      lockedUntil: users.lockedUntil,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return rows[0];
}

function buildStatusResponse(input: {
  hasSecret: boolean;
  enabledAt: string | null;
  platformStepUpAt?: number;
}) {
  const stepUpSatisfied = isPlatformStepUpSatisfied(input.platformStepUpAt);
  return {
    mfaEnabled: !!input.enabledAt,
    mfaPending: input.hasSecret && !input.enabledAt,
    stepUpSatisfied,
    stepUpExpiresAt: stepUpSatisfied ? getPlatformStepUpExpiry(input.platformStepUpAt) : null,
  };
}

export const platformSecurityRouter = router({
  getStatus: platformBaseProcedure.query(async ({ ctx }) => {
    // When step-up is not required, auto-satisfy so all tabs are accessible
    if (!config.REQUIRE_PLATFORM_STEP_UP) {
      return {
        mfaEnabled: false,
        mfaPending: false,
        stepUpSatisfied: true,
        stepUpExpiresAt: null,
      };
    }

    const user = await getPlatformSecurityUser(ctx.user.id);
    if (!user) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
    }

    return buildStatusResponse({
      hasSecret: !!user.platformTotpSecret,
      enabledAt: user.platformTotpEnabledAt || null,
      platformStepUpAt: ctx.user.platformStepUpAt,
    });
  }),

  beginSetup: platformBaseProcedure.mutation(async ({ ctx }) => {
    const user = await getPlatformSecurityUser(ctx.user.id);
    if (!user) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
    }

    if (user.platformTotpEnabledAt) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Platform MFA is already enabled' });
    }

    const { secret, manualEntryKey } = generateTotpSecret();
    await db
      .update(users)
      .set({
        platformTotpSecret: secret,
        platformTotpEnabledAt: null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(users.id, user.id));

    await db.insert(auditLog).values({
      id: randomUUID(),
      action: 'security.platform_mfa_setup_started',
      actorId: ctx.user.id,
      targetType: 'user',
      targetId: ctx.user.id,
      metadata: {},
    });

    return {
      manualEntryKey,
      otpauthUrl: buildTotpUri(user.email || user.id, secret),
    };
  }),

  enable: platformBaseProcedure
    .input(z.object({ code: z.string().min(6).max(8) }))
    .mutation(async ({ input, ctx }) => {
      const user = await getPlatformSecurityUser(ctx.user.id);
      if (!user || !user.platformTotpSecret) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Platform MFA setup has not started' });
      }

      const lockout = checkLockout(user);
      if (lockout.locked) {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'Account temporarily locked' });
      }

      if (!verifyTotpToken(user.platformTotpSecret, input.code)) {
        await recordFailedLogin(ctx.user.id);
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid verification code' });
      }

      await resetFailedLogins(ctx.user.id);

      const enabledAt = new Date().toISOString();
      const platformStepUpAt = getCurrentUnixTime();

      await db
        .update(users)
        .set({
          platformTotpEnabledAt: enabledAt,
          updatedAt: enabledAt,
        })
        .where(eq(users.id, user.id));

      await db.insert(auditLog).values({
        id: randomUUID(),
        action: 'security.platform_mfa_enabled',
        actorId: ctx.user.id,
        targetType: 'user',
        targetId: ctx.user.id,
        metadata: {},
      });

      const token = await buildAuthToken({
        userId: ctx.user.id,
        role: ctx.user.role,
        partnerId: ctx.user.partnerId,
        membershipId: ctx.user.membershipId,
        isPlatformOperator: true,
        platformStepUpAt,
      });

      setAuthCookie(ctx.res, token, parseExpiryToSeconds(config.ACCESS_TOKEN_EXPIRY));

      return {
        stepUpExpiresAt: getPlatformStepUpExpiry(platformStepUpAt),
      };
    }),

  verify: platformBaseProcedure
    .input(z.object({ code: z.string().min(6).max(8) }))
    .mutation(async ({ input, ctx }) => {
      const user = await getPlatformSecurityUser(ctx.user.id);
      if (!user?.platformTotpSecret || !user.platformTotpEnabledAt) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Platform MFA is not enabled' });
      }

      if (!verifyTotpToken(user.platformTotpSecret, input.code)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid verification code' });
      }

      const platformStepUpAt = getCurrentUnixTime();
      const token = await buildAuthToken({
        userId: ctx.user.id,
        role: ctx.user.role,
        partnerId: ctx.user.partnerId,
        membershipId: ctx.user.membershipId,
        isPlatformOperator: true,
        platformStepUpAt,
      });

      setAuthCookie(ctx.res, token, parseExpiryToSeconds(config.ACCESS_TOKEN_EXPIRY));

      await db.insert(auditLog).values({
        id: randomUUID(),
        action: 'security.platform_step_up_verified',
        actorId: ctx.user.id,
        targetType: 'user',
        targetId: ctx.user.id,
        metadata: {},
      });

      return {
        stepUpExpiresAt: getPlatformStepUpExpiry(platformStepUpAt),
      };
    }),
});
