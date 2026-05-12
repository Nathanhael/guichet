import { router, platformProcedure, protectedProcedure } from '../trpc.js';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { revokeUserSessions } from '../../services/auth/index.js';
import { db } from '../../db.js';
import { auditLog, users, memberships } from '../../db/schema.js';
import { eq, isNull, desc, asc, sql, count } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { wrapError } from '../../utils/trpcErrors.js';

export const userRouter = router({
  list: platformProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(500).default(100),
      offset: z.number().int().min(0).default(0),
    }).default({ limit: 100, offset: 0 }))
    .query(async ({ input }) => {
      try {
        const userRows = await db
          .select({
            id: users.id,
            name: users.name,
            lang: users.lang,
            isPlatformOperator: users.isPlatformOperator,
            roles: sql<string[]>`(SELECT json_agg(DISTINCT ${memberships.role}) FROM ${memberships} WHERE ${memberships.userId} = ${users.id})`,
          })
          .from(users)
          .where(isNull(users.deletedAt))
          .orderBy(desc(users.isPlatformOperator), asc(users.name))
          .limit(input.limit)
          .offset(input.offset);

        const [{ total }] = await db
          .select({ total: count() })
          .from(users)
          .where(isNull(users.deletedAt));

        return { users: userRows, total };
      } catch (err: unknown) {
        wrapError(err, 'list users');
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
        wrapError(err, 'revoke user sessions');
      }
    }),

  /**
   * Return the current authenticated user's identity payload. Serves as the
   * canonical "current user" query point.
   */
  me: protectedProcedure.query(async ({ ctx }) => {
    const rows = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        lang: users.lang,
        avatarUrl: users.avatarUrl,
        isPlatformOperator: users.isPlatformOperator,
      })
      .from(users)
      .where(eq(users.id, ctx.user.id))
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
    }
    return {
      id: row.id,
      name: row.name,
      email: row.email ?? '',
      lang: (row.lang ?? 'en') as 'nl' | 'fr' | 'en',
      avatarUrl: row.avatarUrl ?? null,
      isPlatformOperator: !!row.isPlatformOperator,
      // Role + departments are JWT-bound (partner-scoped), pulled from context.
      role: ctx.user.role,
      partnerId: ctx.user.partnerId ?? null,
      departments: ctx.user.departments,
    };
  }),

  /**
   * Get the current user's locale + sync metadata. Used by `LanguageSwitcher`
   * to render the "SYNCED FROM SSO" badge and the "UNLOCK SSO SYNC" button.
   */
  getLocaleInfo: protectedProcedure.query(async ({ ctx }) => {
    const rows = await db
      .select({
        lang: users.lang,
        langLocked: users.langLocked,
        externalId: users.externalId,
      })
      .from(users)
      .where(eq(users.id, ctx.user.id))
      .limit(1);
    const row = rows[0];
    return {
      lang: (row?.lang ?? 'en') as string,
      langLocked: row?.langLocked ?? false,
      hasSso: !!row?.externalId,
    };
  }),

  /**
   * Set the current user's locale and/or toggle the SSO sync lock.
   *
   * Product rule (see `docs/superpowers/specs/2026-04-15-sso-locale-sync-design.md`):
   * - Picking a language manually sets `langLocked=true` so subsequent SSO
   *   logins don't overwrite the user's choice.
   * - Unlocking (`lockFromSso: false`) re-enables SSO sync; no lang change.
   */
  setLocale: protectedProcedure
    .input(
      z.object({
        lang: z.enum(['nl', 'fr', 'en']).optional(),
        lockFromSso: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const patch: { lang?: string; langLocked?: boolean; updatedAt: string } = {
        updatedAt: new Date().toISOString(),
      };
      if (input.lang) patch.lang = input.lang;
      if (typeof input.lockFromSso === 'boolean') patch.langLocked = input.lockFromSso;

      if (Object.keys(patch).length === 1) {
        // Only `updatedAt` set → caller passed no real changes. Return current state.
        const rows = await db
          .select({ lang: users.lang, langLocked: users.langLocked })
          .from(users)
          .where(eq(users.id, ctx.user.id))
          .limit(1);
        return { lang: rows[0]?.lang ?? 'en', langLocked: rows[0]?.langLocked ?? false };
      }

      await db.update(users).set(patch).where(eq(users.id, ctx.user.id));

      await db.insert(auditLog).values({
        action: 'user.locale.changed',
        actorId: ctx.user.id,
        targetType: 'user',
        targetId: ctx.user.id,
        metadata: {
          ...(input.lang && { lang: input.lang }),
          ...(typeof input.lockFromSso === 'boolean' && { langLocked: input.lockFromSso }),
        },
      });

      return {
        lang: patch.lang ?? (await db
          .select({ lang: users.lang })
          .from(users)
          .where(eq(users.id, ctx.user.id))
          .limit(1))[0]?.lang ?? 'en',
        langLocked: patch.langLocked ?? false,
      };
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
