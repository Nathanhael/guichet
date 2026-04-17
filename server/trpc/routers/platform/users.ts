import { z } from 'zod';
import { router, platformProcedure } from '../../trpc.js';
import { db } from '../../../db.js';
import { users, memberships, partners, auditLog } from '../../../db/schema.js';
import { eq, desc, sql, isNull, and, inArray } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { randomUUID } from 'crypto';
import logger from '../../../utils/logger.js';
import { MailService } from '../../../services/mail.js';
import { renderInviteReminder } from '../../../services/mailTemplates.js';
import { revokeUserSessions } from '../../../services/sessionRevocation.js';

export const platformUsersRouter = router({
  updateUser: platformProcedure
    .input(z.object({
      id: z.string(),
      data: z.object({
        name: z.string().optional(),
        email: z.string().email().optional(),
      })
    }))
    .mutation(async ({ input, ctx }) => {
      const before = await db.select().from(users).where(eq(users.id, input.id)).limit(1);

      const allowedFields: Partial<typeof users.$inferInsert> = {};
      if (input.data.name !== undefined) allowedFields.name = input.data.name;
      if (input.data.email !== undefined) allowedFields.email = input.data.email;
      allowedFields.updatedAt = new Date().toISOString();

      await db.update(users)
        .set(allowedFields)
        .where(eq(users.id, input.id));

      if (before[0]) {
        const diff: Record<string, { from: string | null; to: string }> = {};
        if (input.data.name && input.data.name !== before[0].name) diff.name = { from: before[0].name, to: input.data.name };
        if (input.data.email && input.data.email !== before[0].email) diff.email = { from: before[0].email, to: input.data.email };

        if (Object.keys(diff).length > 0) {
          await db.insert(auditLog).values({
            id: randomUUID(),
            action: 'user.profile_updated',
            actorId: ctx.user.id,
            targetType: 'user',
            targetId: input.id,
            metadata: { changes: diff }
          });
        }
      }
      return { success: true };
    }),

  listGlobalUsers: platformProcedure
    .input(z.object({
      cursor: z.string().optional(),
      limit: z.number().min(1).max(200).default(100),
    }).optional())
    .query(async ({ input }) => {
    const limit = input?.limit ?? 100;
    const cursor = input?.cursor;

    const userColumns = {
      id: users.id,
      email: users.email,
      externalId: users.externalId,
      name: users.name,
      lang: users.lang,
      avatarUrl: users.avatarUrl,
      isPlatformOperator: users.isPlatformOperator,
      lastActiveAt: users.lastActiveAt,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
      deletedAt: users.deletedAt,
      failedLoginAttempts: users.failedLoginAttempts,
      lockedUntil: users.lockedUntil,
      mfaEnabledAt: users.mfaEnabledAt,
      platformTotpEnabledAt: users.platformTotpEnabledAt,
      notificationPreferences: users.notificationPreferences,
      accessibilityPrefs: users.accessibilityPrefs,
    };

    let query = db.select(userColumns).from(users).orderBy(desc(users.createdAt), desc(users.id));

    if (cursor) {
      const sepIdx = cursor.indexOf('|');
      if (sepIdx > 0) {
        const cursorTime = cursor.slice(0, sepIdx);
        const cursorId = cursor.slice(sepIdx + 1);
        query = query.where(
          sql`(${users.createdAt} < ${cursorTime} OR (${users.createdAt} = ${cursorTime} AND ${users.id} < ${cursorId}))`
        ) as typeof query;
      }
    }

    const allUsers = await query.limit(limit + 1);
    const hasMore = allUsers.length > limit;
    const pageUsers = hasMore ? allUsers.slice(0, limit) : allUsers;

    const userIds = pageUsers.map(u => u.id);
    const allMemberships = userIds.length > 0
      ? await db
          .select({
            id: memberships.id,
            userId: memberships.userId,
            partnerId: memberships.partnerId,
            partnerName: partners.name,
            role: memberships.role,
            departments: memberships.departments
          })
          .from(memberships)
          .innerJoin(partners, eq(memberships.partnerId, partners.id))
          .where(and(isNull(partners.deletedAt), inArray(memberships.userId, userIds)))
      : [];

    const lastItem = pageUsers[pageUsers.length - 1];
    const nextCursor = hasMore && lastItem ? `${lastItem.createdAt}|${lastItem.id}` : '';

    return {
      users: pageUsers.map(u => ({
        ...u,
        partnerMemberships: allMemberships.filter(m => m.userId === u.id),
      })),
      nextCursor,
    };
  }),

  inviteUser: platformProcedure
    .input(z.object({
      email: z.string().email(),
      name: z.string(),
      role: z.enum(['agent', 'support', 'admin', 'platform_operator']),
      partnerId: z.string(),
      departments: z.array(z.string()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        const partner = await db.select({ id: partners.id, name: partners.name })
          .from(partners)
          .where(eq(partners.id, input.partnerId))
          .limit(1);

        if (partner.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Partner not found' });
        }

        let isExistingUser = false;
        let userId: string;
        const existing = await db.select().from(users).where(eq(users.email, input.email)).limit(1);

        if (existing.length > 0) {
          userId = existing[0].id;
          isExistingUser = true;
        } else {
          userId = `u_${randomUUID().slice(0, 8)}`;

          await db.insert(users).values({
            id: userId,
            email: input.email,
            name: input.name,
            isPlatformOperator: input.role === 'platform_operator',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        }

        const existingMembership = await db.select()
          .from(memberships)
          .where(and(eq(memberships.userId, userId), eq(memberships.partnerId, input.partnerId)))
          .limit(1);

        if (existingMembership.length > 0) {
          throw new TRPCError({ code: 'CONFLICT', message: 'User already has a membership with this partner' });
        }

        const memId = `mem_${randomUUID().slice(0, 8)}`;
        await db.insert(memberships).values({
          id: memId,
          userId,
          partnerId: input.partnerId,
          role: input.role,
          departments: input.departments || []
        });

        // All partners are SSO-only: Azure sends the B2B invite for external
        // guests; internal staff are already provisioned via Entra. Guichet
        // stays silent on the initial invite to avoid a duplicate mail.
        await db.insert(auditLog).values({
          id: randomUUID(),
          action: 'member.invited',
          actorId: ctx.user.id,
          partnerId: input.partnerId,
          targetType: 'user',
          targetId: userId,
          metadata: { email: input.email, role: input.role, membershipId: memId }
        });

        return { userId, membershipId: memId, isExistingUser };
      } catch (err: unknown) {
        if (err instanceof TRPCError) throw err;
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
      }
    }),

  resendInvite: platformProcedure
    .input(z.object({
      userId: z.string(),
      partnerId: z.string()
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        const user = (await db.select({
          id: users.id,
          name: users.name,
          email: users.email,
          externalId: users.externalId,
        }).from(users).where(eq(users.id, input.userId)).limit(1))[0];
        const partner = (await db.select({
          id: partners.id,
          name: partners.name,
        }).from(partners).where(eq(partners.id, input.partnerId)).limit(1))[0];

        if (!user || !partner) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'User or Partner not found' });
        }

        const loginUrl = process.env.FRONTEND_URL || 'http://localhost:3001';
        const welcomeHtml = renderInviteReminder({
          name: user.name,
          partnerName: partner.name,
          loginUrl,
          brand: { partnerName: partner.name },
        });

        await MailService.sendMail(user.email!, `Reminder: Invitation to join ${partner.name}`, welcomeHtml);

        await db.insert(auditLog).values({
          id: randomUUID(),
          action: 'member.invite_resent',
          actorId: ctx.user.id,
          partnerId: input.partnerId,
          targetType: 'user',
          targetId: user.id,
          metadata: { email: user.email }
        });

        return { success: true };
      } catch (err: unknown) {
        if (err instanceof TRPCError) throw err;
        logger.error({ err: err instanceof Error ? err.message : String(err) }, 'tRPC: resendInvite error');
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to resend invite' });
      }
    }),

  removeMembership: platformProcedure
    .input(z.string())
    .mutation(async ({ input, ctx }) => {
      try {
        logger.info({ membershipId: input }, '[removeMembership] Attempting to revoke');
        const mem = await db.select().from(memberships).where(eq(memberships.id, input)).limit(1);

        if (!mem[0]) {
          logger.warn({ membershipId: input }, '[removeMembership] Membership not found');
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Membership not found' });
        }

        await db.delete(memberships).where(eq(memberships.id, input));
        logger.info({ membershipId: input, userId: mem[0].userId, partnerId: mem[0].partnerId }, '[removeMembership] Deleted membership');

        try {
          await db.insert(auditLog).values({
            id: randomUUID(),
            action: 'member.removed',
            actorId: ctx.user.id,
            partnerId: mem[0].partnerId,
            targetType: 'user',
            targetId: mem[0].userId,
            metadata: { membershipId: input, role: mem[0].role }
          });
          logger.info({ membershipId: input }, '[removeMembership] Logged to audit_log');
        } catch (auditErr) {
          logger.error({ err: auditErr, membershipId: input }, '[removeMembership] Failed to log to audit_log');
        }

        return { success: true };
      } catch (err: unknown) {
        if (err instanceof TRPCError) throw err;
        logger.error({ err: err instanceof Error ? err.message : String(err), membershipId: input }, '[removeMembership] Error');
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
      }
    }),

  updateMembership: platformProcedure
    .input(z.object({
      id: z.string(),
      data: z.object({
        role: z.enum(['agent', 'support', 'admin', 'platform_operator']),
        departments: z.array(z.string()).optional()
      })
    }))
    .mutation(async ({ input, ctx }) => {
      const memBefore = await db.select().from(memberships).where(eq(memberships.id, input.id)).limit(1);
      if (!memBefore[0]) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Membership not found' });
      }

      const wasPlatformOperator = memBefore[0].role === 'platform_operator';
      const willBePlatformOperator = input.data.role === 'platform_operator';
      const isDemotion = wasPlatformOperator && !willBePlatformOperator;

      if (isDemotion) {
        // Prevent self-demotion
        if (memBefore[0].userId === ctx.user.id) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Cannot demote your own platform operator role' });
        }

        // Prevent last-operator lockout: count total platform operators
        const operatorCount = await db.select({ count: sql<number>`count(*)::int` })
          .from(users)
          .where(and(eq(users.isPlatformOperator, true), isNull(users.deletedAt)));
        if (operatorCount[0].count <= 1) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Cannot demote the last platform operator' });
        }
      }

      await db.update(memberships)
        .set({
          role: input.data.role,
          departments: input.data.departments || []
        })
        .where(eq(memberships.id, input.id));

      try {
        await db.insert(auditLog).values({
          id: randomUUID(),
          action: 'member.updated',
          actorId: ctx.user.id,
          partnerId: memBefore[0].partnerId,
          targetType: 'user',
          targetId: memBefore[0].userId,
          metadata: {
            membershipId: input.id,
            oldRole: memBefore[0].role,
            newRole: input.data.role
          }
        });
      } catch (auditErr) {
        logger.error({ err: auditErr }, '[updateMembership] Audit log failed');
      }

      const mem = await db.select().from(memberships).where(eq(memberships.id, input.id)).limit(1);
      if (mem[0]) {
        if (willBePlatformOperator) {
          await db.update(users).set({ isPlatformOperator: true }).where(eq(users.id, mem[0].userId));
        } else {
          const otherPlatformMemberships = await db.select({ id: memberships.id })
            .from(memberships)
            .where(and(
              eq(memberships.userId, mem[0].userId),
              eq(memberships.role, 'platform_operator')
            ))
            .limit(1);
          if (otherPlatformMemberships.length === 0) {
            await db.update(users).set({ isPlatformOperator: false }).where(eq(users.id, mem[0].userId));
          }
        }
      }

      return { success: true };
    }),

  disableUserMfa: platformProcedure
    .input(z.string())
    .mutation(async ({ input: targetUserId, ctx }) => {
      const target = await db.select({ id: users.id, name: users.name, email: users.email, mfaEnabledAt: users.mfaEnabledAt })
        .from(users).where(eq(users.id, targetUserId)).limit(1);
      if (!target[0]) throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
      if (!target[0].mfaEnabledAt) throw new TRPCError({ code: 'BAD_REQUEST', message: 'MFA is not enabled for this user' });

      await db.update(users).set({
        mfaSecret: null,
        mfaEnabledAt: null,
        mfaRecoveryCodes: [],
        updatedAt: new Date().toISOString(),
      }).where(eq(users.id, targetUserId));

      await revokeUserSessions(targetUserId);

      await db.insert(auditLog).values({
        id: randomUUID(),
        action: 'security.mfa_disabled_by_admin',
        actorId: ctx.user.id,
        targetType: 'user',
        targetId: targetUserId,
        metadata: { targetName: target[0].name },
      });

      if (target[0].email) {
        MailService.sendMfaDisabledByAdmin(target[0].email, target[0].name, targetUserId).catch(() => {});
      }

      return { success: true };
    }),

  unlockUser: platformProcedure
    .input(z.string())
    .mutation(async ({ input: targetUserId, ctx }) => {
      const target = await db.select({ id: users.id, name: users.name, email: users.email, lockedUntil: users.lockedUntil, failedLoginAttempts: users.failedLoginAttempts })
        .from(users).where(eq(users.id, targetUserId)).limit(1);
      if (!target[0]) throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
      if (!target[0].lockedUntil && (target[0].failedLoginAttempts ?? 0) === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'User is not locked' });
      }

      await db.update(users).set({
        lockedUntil: null,
        failedLoginAttempts: 0,
        updatedAt: new Date().toISOString(),
      }).where(eq(users.id, targetUserId));

      await db.insert(auditLog).values({
        id: randomUUID(),
        action: 'security.user_unlocked_by_admin',
        actorId: ctx.user.id,
        targetType: 'user',
        targetId: targetUserId,
        metadata: { targetName: target[0].name },
      });

      if (target[0].email) {
        MailService.sendAccountUnlocked(target[0].email, target[0].name).catch(() => {});
      }

      return { success: true };
    }),

  deleteUser: platformProcedure
    .input(z.string())
    .mutation(async ({ input, ctx }) => {
      // Prevent self-deletion
      if (input === ctx.user.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Cannot delete your own account' });
      }

      // Prevent deleting the last platform operator
      const target = await db.select({ isPlatformOperator: users.isPlatformOperator })
        .from(users).where(eq(users.id, input)).limit(1);
      if (target[0]?.isPlatformOperator) {
        const operatorCount = await db.select({ count: sql<number>`count(*)::int` })
          .from(users)
          .where(and(eq(users.isPlatformOperator, true), isNull(users.deletedAt)));
        if (operatorCount[0].count <= 1) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Cannot delete the last platform operator' });
        }
      }

      await revokeUserSessions(input);

      await db.update(users)
        .set({ deletedAt: new Date().toISOString() })
        .where(eq(users.id, input));

      try {
        await db.insert(auditLog).values({
          id: randomUUID(),
          action: 'user.deleted',
          actorId: ctx.user.id,
          targetType: 'user',
          targetId: input,
          metadata: { softDelete: true }
        });
      } catch (auditErr) {
        logger.error({ err: auditErr }, '[deleteUser] Audit log failed');
      }

      return { success: true };
    }),
});
