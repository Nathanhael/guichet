import { z } from 'zod';
import { router, adminProcedure, destructiveAdminProcedure } from '../../trpc.js';
import { db } from '../../../db.js';
import { partners, users, memberships, auditLog } from '../../../db/schema.js';
import { eq, ne, and, or, ilike, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import logger from '../../../utils/logger.js';
import { canAssignTenantRole } from '../../../services/roles.js';
import { revokeUserSessions } from '../../../services/sessionRevocation.js';
import { revokeAllUserRefreshTokens } from '../../../services/refreshToken.js';

export const partnerMembersRouter = router({
  listMembers: adminProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(50),
      offset: z.number().min(0).default(0),
      search: z.string().optional(),
      role: z.enum(['agent', 'support']).optional(),
      excludeAdmin: z.boolean().optional().default(true),
    }))
    .query(async ({ input, ctx }) => {
      try {
        const partnerId = ctx.user.partnerId;
        if (!partnerId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No active partner context' });

        const filters = [eq(memberships.partnerId, partnerId)];
        if (input.role) {
          filters.push(eq(memberships.role, input.role));
        } else if (input.excludeAdmin) {
          filters.push(ne(memberships.role, 'admin'));
        }
        if (input.search?.trim()) {
          const rawSearch = input.search.trim();
          const s = `%${rawSearch}%`;

          // ME-07 fix: Allow filtering by department name (access grants)
          // Only match department names for non-agent roles — agents show "Selects per ticket"
          // and shouldn't appear when searching department names like "Technical Support"
          const matchesDept = sql`(${memberships.role} != 'agent' AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(${partners.departments}) d
            JOIN jsonb_array_elements_text(${memberships.departments}) md(id) ON d->>'id' = md.id
            WHERE d->>'name' ILIKE ${s}
          ))`;

          filters.push(or(
            ilike(users.name, s),
            ilike(users.email, s),
            sql`${memberships.role}::text ILIKE ${s}`,
            sql`CONCAT(${memberships.role}::text, 's') ILIKE ${s}`,
            matchesDept,
            sql`CASE
              WHEN ${memberships.role} = 'support' AND jsonb_array_length(${memberships.departments}) = 0
              THEN 'Unconfigured' ILIKE ${s}
              ELSE FALSE
            END`,
            sql`CASE
              WHEN ${memberships.source} = 'manual'
              THEN 'Manual' ILIKE ${s}
              ELSE FALSE
            END`
          )!);
        }

        const result = await db
          .select({
            membershipId: memberships.id,
            userId: users.id,
            name: users.name,
            email: users.email,
            role: memberships.role,
            departments: memberships.departments,
            source: memberships.source,
            createdAt: memberships.createdAt,
            externalId: users.externalId,
            isExternal: users.isExternal,
            lastActiveAt: users.lastActiveAt,
          })
          .from(memberships)
          .innerJoin(users, eq(memberships.userId, users.id))
          .innerJoin(partners, eq(memberships.partnerId, partners.id))
          .where(and(...filters))
          .limit(input.limit)
          .offset(input.offset);

        return result;
      } catch (err: unknown) {
        logger.error({ err, search: input.search }, 'listMembers error');
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
      }
    }),

  addMemberByEmail: destructiveAdminProcedure
    .input(z.object({
      email: z.string().email(),
      role: z.enum(['support', 'admin']),
      departments: z.array(z.string()).optional()
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        const partnerId = ctx.user.partnerId;
        if (!partnerId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No active partner context' });
        if (!canAssignTenantRole(ctx.user.role, ctx.user.isPlatformOperator, input.role)) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Tenant admins cannot assign this role' });
        }

        if (input.role === 'support' && (!input.departments || input.departments.length === 0)) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Support role requires at least one department' });
        }

        const targetUser = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
        if (targetUser.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
        }

        const userId = targetUser[0].id;

        const existingMembership = await db.select().from(memberships)
          .where(and(eq(memberships.userId, userId), eq(memberships.partnerId, partnerId))).limit(1);

        if (existingMembership.length > 0) {
          throw new TRPCError({ code: 'CONFLICT', message: 'User already on this partner' });
        }

        const newMembershipId = crypto.randomUUID();

        await db.insert(memberships).values({
          id: newMembershipId,
          userId: userId,
          partnerId: partnerId,
          role: input.role,
          departments: input.role === 'support' ? (input.departments || []) : [],
          source: 'manual'
        });

        await db.insert(auditLog).values({
          action: 'member.added',
          actorId: ctx.user.id,
          partnerId: partnerId,
          targetType: 'user',
          targetId: userId,
          metadata: { role: input.role, departments: input.departments }
        });

        return { success: true };
      } catch (err: unknown) {
        if (err instanceof TRPCError) throw err;
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
      }
    }),

  inviteExternalUser: destructiveAdminProcedure
    .input(z.object({
      email: z.string().email(),
      name: z.string().min(1),
      role: z.enum(['support', 'admin']),
      departments: z.array(z.string()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        const partnerId = ctx.user.partnerId;
        if (!partnerId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No active partner context' });
        if (!canAssignTenantRole(ctx.user.role, ctx.user.isPlatformOperator, input.role)) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Tenant admins cannot assign this role' });
        }

        if (input.role === 'support' && (!input.departments || input.departments.length === 0)) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Support role requires at least one department' });
        }

        const partner = await db.select({ id: partners.id })
          .from(partners)
          .where(eq(partners.id, partnerId))
          .limit(1);

        if (partner.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Partner not found' });
        }

        let newUserId: string = '';
        let newMembershipId: string = '';

        await db.transaction(async (tx) => {
          const existingUser = await tx.select().from(users).where(eq(users.email, input.email)).limit(1);
          if (existingUser.length > 0) {
            throw new TRPCError({ code: 'CONFLICT', message: 'Email already in use' });
          }

          newUserId = crypto.randomUUID();

          await tx.insert(users).values({
            id: newUserId,
            email: input.email,
            name: input.name,
            isExternal: true,
          });

          newMembershipId = crypto.randomUUID();
          await tx.insert(memberships).values({
            id: newMembershipId,
            userId: newUserId,
            partnerId: partnerId,
            role: input.role,
            departments: input.role === 'support' ? (input.departments || []) : [],
            source: 'manual'
          });

          await tx.insert(auditLog).values({
            action: 'member.invited',
            actorId: ctx.user.id,
            partnerId: partnerId,
            targetType: 'user',
            targetId: newUserId,
            metadata: { role: input.role, departments: input.departments, email: input.email }
          });
        });

        logger.info({ userId: newUserId }, '[inviteExternalUser] User created');
        return { success: true, userId: newUserId };
      } catch (err: unknown) {
        if (err instanceof TRPCError) throw err;
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
      }
    }),

  updateMember: destructiveAdminProcedure
    .input(z.object({
      membershipId: z.string(),
      departments: z.array(z.string()).optional()
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        const partnerId = ctx.user.partnerId;
        if (!partnerId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No active partner context' });

        const membership = await db.select().from(memberships)
          .where(and(eq(memberships.id, input.membershipId), eq(memberships.partnerId, partnerId))).limit(1);

        if (membership.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Membership not found' });
        }

        if (membership[0].role === 'admin') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Admin departments are managed automatically' });
        }

        const isSupport = membership[0].role === 'support';
        const depts = membership[0].role === 'agent' ? [] : (input.departments || []);

        if (isSupport && depts.length === 0) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Support role requires at least one department' });
        }

        await db.update(memberships)
          .set({ departments: depts })
          .where(and(eq(memberships.id, input.membershipId), eq(memberships.partnerId, partnerId)));

        await db.insert(auditLog).values({
          action: 'member.updated',
          actorId: ctx.user.id,
          partnerId: partnerId,
          targetType: 'user',
          targetId: membership[0].userId,
          metadata: { departments: input.departments }
        });

        return { success: true };
      } catch (err: unknown) {
        if (err instanceof TRPCError) throw err;
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
      }
    }),

  removeMember: destructiveAdminProcedure
    .input(z.object({
      membershipId: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        const partnerId = ctx.user.partnerId;
        if (!partnerId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No active partner context' });

        const membership = await db.select().from(memberships)
          .where(and(eq(memberships.id, input.membershipId), eq(memberships.partnerId, partnerId))).limit(1);

        if (membership.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Membership not found' });
        }

        if (membership[0].userId === ctx.user.id) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Cannot remove yourself' });
        }

        const targetUser = await db.select({ id: users.id, isExternal: users.isExternal })
          .from(users).where(eq(users.id, membership[0].userId)).limit(1);

        if (targetUser.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Target user not found' });
        }

        const wasExternal = targetUser[0].isExternal;

        await db.transaction(async (tx) => {
          const userMemberships = await tx.select().from(memberships)
            .where(eq(memberships.userId, membership[0].userId));

          if (userMemberships.length <= 1 && !wasExternal) {
            throw new TRPCError({ code: 'FORBIDDEN', message: 'Cannot remove internal user\'s last membership. Platform Operator must handle this.' });
          }

          await tx.delete(memberships).where(eq(memberships.id, input.membershipId));
        });

        if (wasExternal) {
          await revokeUserSessions(membership[0].userId);
          await revokeAllUserRefreshTokens(membership[0].userId);
        }

        await db.insert(auditLog).values({
          action: 'member.removed',
          actorId: ctx.user.id,
          partnerId: partnerId,
          targetType: 'user',
          targetId: membership[0].userId,
          metadata: { wasExternal }
        });

        return { success: true };
      } catch (err: unknown) {
        if (err instanceof TRPCError) throw err;
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
      }
    }),
});
