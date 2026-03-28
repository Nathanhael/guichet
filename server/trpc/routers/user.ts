import { router, platformProcedure, publicProcedure, protectedProcedure } from '../trpc.js';
import { query } from '../../db.js';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { revokeUserSessions } from '../../services/sessionRevocation.js';
import { db } from '../../db.js';
import { auditLog, users } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { verifyPassword, hashPassword, validatePasswordStrength, isPasswordReused, PASSWORD_HISTORY_LIMIT } from '../../utils/passwords.js';
import logger from '../../utils/logger.js';

export const userRouter = router({
  list: platformProcedure
    .query(async () => {
      try {
        const users = await query(`
          SELECT id, name, lang, is_platform_operator,
            (SELECT role FROM memberships WHERE user_id = users.id LIMIT 1) as role
          FROM users
          WHERE deleted_at IS NULL
          ORDER BY is_platform_operator DESC, name ASC
        `);
        return users;
      } catch (err: unknown) {
        logger.error({ err: err instanceof Error ? err.message : String(err) }, 'tRPC: user query error');
        if (err instanceof TRPCError) throw err;
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' });
      }
    }),

  /** Public demo user list — only available when DEMO_MODE=true */
  demoList: publicProcedure
    .query(async () => {
      if (process.env.DEMO_MODE !== 'true') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Demo mode is not enabled' });
      }
      try {
        // Only return minimum fields needed for demo login UI — no email exposure
        const users = await query(`
          SELECT id, name, lang, is_platform_operator,
            (SELECT role FROM memberships WHERE user_id = users.id LIMIT 1) as role
          FROM users
          WHERE deleted_at IS NULL
          ORDER BY is_platform_operator DESC, name ASC
        `);
        return users;
      } catch (err: unknown) {
        logger.error({ err: err instanceof Error ? err.message : String(err) }, 'tRPC: user query error');
        if (err instanceof TRPCError) throw err;
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' });
      }
    }),

  revokeSessions: platformProcedure
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const revokedAfter = await revokeUserSessions(input.userId);

        await db.insert(auditLog).values({
          id: randomUUID(),
          action: 'user.sessions_revoked',
          actorId: ctx.user.id,
          targetType: 'user',
          targetId: input.userId,
          metadata: { revokedAfter },
        });

        return { success: true, revokedAfter };
      } catch (err: unknown) {
        logger.error({ err: err instanceof Error ? err.message : String(err) }, 'tRPC: user query error');
        if (err instanceof TRPCError) throw err;
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' });
      }
    }),

  /**
   * Self-service password change for authenticated users.
   * Requires current password, validates strength and history.
   */
  changePassword: protectedProcedure
    .input(z.object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(10),
    }))
    .mutation(async ({ input, ctx }) => {
      const userRows = await db.select({
        password: users.password,
        email: users.email,
        name: users.name,
        passwordHistory: users.passwordHistory,
      }).from(users).where(eq(users.id, ctx.user.id)).limit(1);

      const user = userRows[0];
      if (!user?.password) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Password change not available for SSO accounts' });
      }

      // Verify current password
      const valid = await verifyPassword(user.password, input.currentPassword);
      if (!valid) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Current password is incorrect' });
      }

      // Validate new password strength
      const strength = validatePasswordStrength(input.newPassword, {
        email: user.email ?? undefined,
        name: user.name,
      });
      if (!strength.valid) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: strength.errors.join('. ') });
      }

      // Check password history
      const history = (user.passwordHistory as string[]) || [];
      if (await isPasswordReused(input.newPassword, history)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Password was recently used. Choose a different one.' });
      }

      // Hash and save
      const hashedNew = await hashPassword(input.newPassword);
      const updatedHistory = [user.password, ...history].slice(0, PASSWORD_HISTORY_LIMIT);

      await db.update(users).set({
        password: hashedNew,
        passwordChangedAt: new Date().toISOString(),
        passwordHistory: updatedHistory,
      }).where(eq(users.id, ctx.user.id));

      // Revoke all sessions so user must re-login with new password
      await revokeUserSessions(ctx.user.id);

      await db.insert(auditLog).values({
        action: 'security.password_changed',
        actorId: ctx.user.id,
        targetType: 'user',
        targetId: ctx.user.id,
        metadata: {},
      });

      logger.info({ userId: ctx.user.id }, '[user] Password changed via self-service');

      return { success: true };
    }),

  /** Get notification preferences for the current user */
  getNotificationPrefs: protectedProcedure.query(async ({ ctx }) => {
    const rows = await db.select({ notificationPreferences: users.notificationPreferences })
      .from(users).where(eq(users.id, ctx.user.id)).limit(1);
    return (rows[0]?.notificationPreferences ?? {}) as Record<string, boolean>;
  }),

  /** Update notification preferences (merge, not replace) */
  updateNotificationPrefs: protectedProcedure
    .input(z.object({
      accountLocked: z.boolean().optional(),
      mfaEnabled: z.boolean().optional(),
      mfaDisabled: z.boolean().optional(),
      passwordChanged: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const rows = await db.select({ notificationPreferences: users.notificationPreferences })
        .from(users).where(eq(users.id, ctx.user.id)).limit(1);
      const current = (rows[0]?.notificationPreferences ?? {}) as Record<string, boolean>;
      const merged = { ...current, ...input };

      await db.update(users).set({
        notificationPreferences: merged,
        updatedAt: new Date().toISOString(),
      }).where(eq(users.id, ctx.user.id));

      await db.insert(auditLog).values({
        action: 'user.notification_prefs_updated',
        actorId: ctx.user.id,
        targetType: 'user',
        targetId: ctx.user.id,
        metadata: input,
      });

      return merged;
    }),

  updateAccessibilityPrefs: protectedProcedure
    .input(
      z.object({
        dyslexicMode: z.boolean().optional(),
        bionicReading: z.boolean().optional(),
        monochromeMode: z.boolean().optional(),
        focusMode: z.boolean().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user.id;

      const [row] = await db
        .select({ accessibilityPrefs: users.accessibilityPrefs })
        .from(users)
        .where(eq(users.id, userId));

      const current = (row?.accessibilityPrefs as Record<string, boolean>) ?? {};
      const merged = { ...current, ...input };

      await db
        .update(users)
        .set({ accessibilityPrefs: merged, updatedAt: new Date().toISOString() })
        .where(eq(users.id, userId));

      return { success: true };
    }),
});
