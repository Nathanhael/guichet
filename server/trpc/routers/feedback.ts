import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { router, protectedProcedure, adminProcedure } from '../trpc.js';
import { db } from '../../db.js';
import { appFeedback, memberships } from '../../db/schema.js';
import { eq, desc, inArray } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import logger from '../../utils/logger.js';

export const feedbackRouter = router({
  list: adminProcedure.query(async ({ ctx }) => {
    try {
      // Tenant isolation: scope feedback to users who belong to the caller's partner
      // Platform operators without active partner see all
      let data: (typeof appFeedback.$inferSelect)[];
      if (ctx.user.isPlatformOperator && !ctx.user.partnerId) {
        data = await db.select()
          .from(appFeedback)
          .orderBy(desc(appFeedback.createdAt));
      } else if (ctx.user.partnerId) {
        // Find user IDs with membership in this partner
        const partnerUserIds = db.select({ userId: memberships.userId })
          .from(memberships)
          .where(eq(memberships.partnerId, ctx.user.partnerId!));

        data = await db.select()
          .from(appFeedback)
          .where(inArray(appFeedback.userId, partnerUserIds))
          .orderBy(desc(appFeedback.createdAt));
      } else {
        data = [];
      }

      return data.map(f => ({
        ...f,
        treated: !!f.treated,
      }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err: message }, 'tRPC: Error listing feedback');
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message });
    }
  }),

  create: protectedProcedure
    .input(z.object({
      text: z.string().min(1),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        const id = uuidv4();
        // Use server-side identity — never trust client-supplied userId/userName
        const entry = {
          id,
          userId: ctx.user.id,
          userName: '', // feedback is anonymous by design
          role: ctx.user.role,
          text: input.text.trim(),
          treated: 0,
          createdAt: new Date().toISOString(),
        };

        await db.insert(appFeedback).values(entry);
        return entry;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ err: message }, 'tRPC: Error creating feedback');
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message });
      }
    }),

  markTreated: adminProcedure
    .input(z.string())
    .mutation(async ({ input: id }) => {
      try {
        await db.update(appFeedback)
          .set({ treated: 1 })
          .where(eq(appFeedback.id, id));
        
        return { success: true };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ err: message, id }, 'tRPC: Error treating feedback');
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message });
      }
    }),
});
