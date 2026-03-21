import { z } from 'zod';
import { router, adminProcedure } from '../trpc.js';
import { db } from '../../db.js';
import { partners, users, memberships, auditLog } from '../../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import logger from '../../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';
import { randomBytes } from 'crypto';

// simple slugify helper
function makeSlug(text: string) {
  return text.toString().toLowerCase().trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

export const partnerRouter = router({
  getManifest: adminProcedure.query(async ({ ctx }) => {
    try {
      const partnerId = ctx.user.partnerId;
      if (!partnerId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No active partner context' });

      const result = await db.select().from(partners).where(eq(partners.id, partnerId)).limit(1);
      if (result.length === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'Partner not found' });

      return result[0];
    } catch (err: unknown) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
    }
  }),

  updateBusinessHours: adminProcedure
    .input(z.object({
      businessHoursStart: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
      businessHoursEnd: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
      businessHoursTimezone: z.string().min(1).nullable(),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        const partnerId = ctx.user.partnerId;
        if (!partnerId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No active partner context' });

        await db.update(partners)
          .set({ 
            businessHoursStart: input.businessHoursStart,
            businessHoursEnd: input.businessHoursEnd,
            businessHoursTimezone: input.businessHoursTimezone
          })
          .where(eq(partners.id, partnerId));

        logger.info({ partnerId }, 'Business Hours updated by Partner Admin');
        return { success: true };
      } catch (err: unknown) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
      }
    }),

  updateDepartments: adminProcedure
    .input(z.object({
      departments: z.array(z.object({
        id: z.string().optional(),
        name: z.string().min(1),
        description: z.string().optional(),
      })),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        const partnerId = ctx.user.partnerId;
        if (!partnerId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No active partner context' });

        const mappedDepartments = input.departments.map(d => ({
          id: d.id ? d.id : makeSlug(d.name),
          name: d.name,
          description: d.description || ''
        }));

        await db.update(partners)
          .set({ departments: mappedDepartments })
          .where(eq(partners.id, partnerId));

        await db.insert(auditLog).values({
          action: 'partner.config_updated',
          actorId: ctx.user.id,
          partnerId: partnerId,
          targetType: 'partner',
          targetId: partnerId,
          metadata: { details: 'Departments updated' }
        });

        logger.info({ partnerId, count: mappedDepartments.length }, 'Departments updated by Partner Admin');
        return { success: true };
      } catch (err: unknown) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
      }
    }),

  listMembers: adminProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(50),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ input, ctx }) => {
      try {
        const partnerId = ctx.user.partnerId;
        if (!partnerId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No active partner context' });

        const result = await db
          .select({
            membershipId: memberships.id,
            userId: users.id,
            name: users.name,
            email: users.email,
            role: memberships.role,
            departments: memberships.departments,
            createdAt: memberships.createdAt
          })
          .from(memberships)
          .innerJoin(users, eq(memberships.userId, users.id))
          .where(eq(memberships.partnerId, partnerId))
          .limit(input.limit)
          .offset(input.offset);

        return result;
      } catch (err: unknown) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
      }
    }),

  addMemberByEmail: adminProcedure
    .input(z.object({
      email: z.string().email(),
      role: z.enum(['agent', 'support']),
      departments: z.array(z.string()).optional()
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        const partnerId = ctx.user.partnerId;
        if (!partnerId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No active partner context' });

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

        const newMembershipId = uuidv4();

        await db.insert(memberships).values({
          id: newMembershipId,
          userId: userId,
          partnerId: partnerId,
          role: input.role,
          departments: input.departments || []
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

  inviteExternalUser: adminProcedure
    .input(z.object({
      email: z.string().email(),
      name: z.string().min(1),
      role: z.enum(['agent', 'support']),
      departments: z.array(z.string()).optional()
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        const partnerId = ctx.user.partnerId;
        if (!partnerId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No active partner context' });

        // 1. Look up partner auth method
        const partner = await db.select({ authMethod: partners.authMethod })
          .from(partners)
          .where(eq(partners.id, partnerId))
          .limit(1);

        if (partner.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Partner not found' });
        }

        const isLocal = partner[0].authMethod === 'local';

        // 2. Check for existing user
        const existingUser = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
        if (existingUser.length > 0) {
          throw new TRPCError({ code: 'CONFLICT', message: 'Email already in use' });
        }

        // 3. Create user — with or without password based on auth method
        let tempPassword: string | null = null;
        const newUserId = uuidv4();

        let hashedPassword: string | undefined;
        if (isLocal) {
          tempPassword = randomBytes(12).toString('base64url');
          const { hash } = await import('bcryptjs');
          hashedPassword = await hash(tempPassword, 10);
        }

        await db.insert(users).values({
          id: newUserId,
          email: input.email,
          name: input.name,
          password: hashedPassword,
        });

        // 4. Create membership
        const newMembershipId = uuidv4();
        await db.insert(memberships).values({
          id: newMembershipId,
          userId: newUserId,
          partnerId: partnerId,
          role: input.role,
          departments: input.departments || []
        });

        // 5. Audit log
        await db.insert(auditLog).values({
          action: 'member.invited',
          actorId: ctx.user.id,
          partnerId: partnerId,
          targetType: 'user',
          targetId: newUserId,
          metadata: { role: input.role, departments: input.departments, email: input.email, authMethod: partner[0].authMethod }
        });

        // Never log plaintext passwords
        logger.info({ userId: newUserId, email: input.email, authMethod: partner[0].authMethod }, '[inviteExternalUser] User created');
        return { success: true, userId: newUserId, tempPassword: tempPassword ?? '' };
      } catch (err: unknown) {
        if (err instanceof TRPCError) throw err;
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
      }
    }),

  updateMember: adminProcedure
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

        await db.update(memberships)
          .set({ departments: input.departments || [] })
          .where(eq(memberships.id, input.membershipId));

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

  removeMember: adminProcedure
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

        const userMemberships = await db.select().from(memberships)
          .where(eq(memberships.userId, membership[0].userId));

        if (userMemberships.length <= 1) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Cannot remove user\'s last membership. Platform Operator must handle this.' });
        }

        await db.delete(memberships).where(eq(memberships.id, input.membershipId));

        await db.insert(auditLog).values({
          action: 'member.removed',
          actorId: ctx.user.id,
          partnerId: partnerId,
          targetType: 'user',
          targetId: membership[0].userId,
          metadata: {}
        });

        return { success: true };
      } catch (err: unknown) {
        if (err instanceof TRPCError) throw err;
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
      }
    }),
});