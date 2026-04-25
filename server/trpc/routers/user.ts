import { router, platformProcedure, publicProcedure, protectedProcedure } from '../trpc.js';
import config from '../../config.js';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { revokeUserSessions } from '../../services/sessionRevocation.js';
import { db } from '../../db.js';
import { auditLog, users, memberships, partners } from '../../db/schema.js';
import { eq, and, isNull, desc, asc, sql, count } from 'drizzle-orm';
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

  /** Public demo user list — only available when DEMO_MODE=true */
  demoList: publicProcedure
    .query(async () => {
      if (!config.DEMO_MODE) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Demo mode is not enabled' });
      }
      try {
        // IM-04: Only return minimum fields for demo login UI — no privilege exposure
        // Return per-membership entries so each role+partner combo is distinct.
        // This prevents the old bug where Map() non-deterministically picked a role
        // for multi-membership users, causing role mismatch between picker and routing.
        const membershipRows = await db
          .select({
            id: users.id,
            name: users.name,
            email: users.email,
            lang: users.lang,
            isPlatformOperator: users.isPlatformOperator,
            membershipId: memberships.id,
            role: memberships.role,
            partnerId: memberships.partnerId,
            partnerName: partners.name,
          })
          .from(users)
          .innerJoin(memberships, eq(users.id, memberships.userId))
          .innerJoin(partners, and(eq(memberships.partnerId, partners.id), eq(partners.status, 'active')))
          .where(isNull(users.deletedAt))
          .orderBy(asc(users.name), asc(partners.name));

        // Platform operators may have no memberships — include them as standalone entries
        const membershipUserIds = new Set(membershipRows.map(r => r.id));
        const platformRows = await db
          .select({
            id: users.id,
            name: users.name,
            email: users.email,
            lang: users.lang,
            isPlatformOperator: users.isPlatformOperator,
          })
          .from(users)
          .where(and(isNull(users.deletedAt), eq(users.isPlatformOperator, true)));

        const standaloneOperators = platformRows
          .filter(p => !membershipUserIds.has(p.id))
          .map(p => ({
            ...p,
            membershipId: null as string | null,
            role: null as string | null,
            partnerId: null as string | null,
            partnerName: null as string | null,
          }));

        return [...membershipRows, ...standaloneOperators];
      } catch (err: unknown) {
        wrapError(err, 'demo list users');
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
   * Return the current authenticated user's identity payload. Client
   * components (UserMenu, GuestBadge, etc.) need a fresh `isExternal` flag
   * without relying on stale data from the login response. Also serves as
   * the canonical "current user" query point.
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
        isExternal: users.isExternal,
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
      isExternal: !!row.isExternal,
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
