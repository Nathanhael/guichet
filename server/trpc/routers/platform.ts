import { z } from 'zod';
import { router, platformProcedure } from '../trpc.js';
import { db } from '../../db.js';
import { partners, memberships, users } from '../../db/schema.js';
import { eq, asc } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import logger from '../../utils/logger.js';

export const platformRouter = router({
  listPartners: platformProcedure.query(async () => {
    try {
      return await db.select().from(partners).orderBy(asc(partners.name));
    } catch (err: unknown) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
    }
  }),

  upsertPartner: platformProcedure
    .input(z.object({
      id: z.string(),
      name: z.string(),
      industry: z.string(),
      primaryColor: z.string(),
      secondaryColor: z.string(),
      ref1Label: z.string(),
      ref2Label: z.string(),
      aiRules: z.string().optional(),
      departments: z.string(), // JSON string
      aiEnabled: z.boolean().default(true),
    }))
    .mutation(async ({ input }) => {
      try {
        await db.insert(partners).values({
          ...input,
          createdAt: new Date().toISOString(),
        }).onConflictDoUpdate({
          target: partners.id,
          set: {
            name: input.name,
            industry: input.industry,
            primaryColor: input.primaryColor,
            secondaryColor: input.secondaryColor,
            ref1Label: input.ref1Label,
            ref2Label: input.ref2Label,
            aiRules: input.aiRules,
            departments: input.departments,
            aiEnabled: input.aiEnabled,
          }
        });
        return { success: true };
      } catch (err: unknown) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
      }
    }),

  listMemberships: platformProcedure
    .input(z.object({ partnerId: z.string() }))
    .query(async ({ input }) => {
      return await db.select({
        id: memberships.id,
        userId: memberships.userId,
        userName: users.name,
        role: memberships.role,
        dept: memberships.dept,
      })
      .from(memberships)
      .join(users, eq(memberships.userId, users.id))
      .where(eq(memberships.partnerId, input.partnerId));
    }),

  addMembership: platformProcedure
    .input(z.object({
      userId: z.string(),
      partnerId: z.string(),
      role: z.string(),
      dept: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const id = `mem_${Date.now()}`;
      await db.insert(memberships).values({
        id,
        ...input,
        createdAt: new Date().toISOString(),
      });
      return { id };
    }),

  removeMembership: platformProcedure
    .input(z.string())
    .mutation(async ({ input }) => {
      await db.delete(memberships).where(eq(memberships.id, input));
      return { success: true };
    }),
});
