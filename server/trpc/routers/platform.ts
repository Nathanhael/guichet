import { z } from 'zod';
import { router, platformProcedure } from '../trpc.js';
import { db } from '../../db.js';
import { partners, memberships, users } from '../../db/schema.js';
import { eq, asc, desc } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { randomUUID } from 'crypto';

export const platformRouter = router({
  // --- Partner Management ---
  listPartners: platformProcedure.query(async () => {
    try {
      return await db.select().from(partners).orderBy(asc(partners.name));
    } catch (err: unknown) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
    }
  }),

  updatePartner: platformProcedure
    .input(z.object({
      id: z.string(),
      data: z.object({
        name: z.string(),
        industry: z.string(),
        ollamaModel: z.string().optional().nullable(),
        aiEnabled: z.boolean().optional(),
      })
    }))
    .mutation(async ({ input }) => {
      await db.update(partners)
        .set({ ...input.data, updatedAt: new Date().toISOString() })
        .where(eq(partners.id, input.id));
      return { success: true };
    }),

  // --- Global User & Membership Management ---
  listGlobalUsers: platformProcedure.query(async () => {
    return await db.select().from(users).orderBy(desc(users.createdAt));
  }),

  inviteUser: platformProcedure
    .input(z.object({
      email: z.string().email(),
      name: z.string(),
      role: z.enum(['agent', 'support', 'manager', 'admin', 'platform_operator']),
      partnerId: z.string(),
      dept: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      try {
        // 1. Ensure user exists or create them (Invite mode)
        let userId: string;
        const existing = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
        
        if (existing.length > 0) {
          userId = existing[0].id;
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

        // 2. Add Membership
        const memId = `mem_${randomUUID().slice(0, 8)}`;
        await db.insert(memberships).values({
          id: memId,
          userId,
          partnerId: input.partnerId,
          role: input.role as any,
          dept: input.dept,
          createdAt: new Date().toISOString(),
        });

        return { userId, membershipId: memId };
      } catch (err: unknown) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
      }
    }),

  removeMembership: platformProcedure
    .input(z.string())
    .mutation(async ({ input }) => {
      await db.delete(memberships).where(eq(memberships.id, input));
      return { success: true };
    }),

  deleteUser: platformProcedure
    .input(z.string())
    .mutation(async ({ input }) => {
      // Soft delete
      await db.update(users)
        .set({ deletedAt: new Date().toISOString() })
        .where(eq(users.id, input));
      return { success: true };
    }),
});
