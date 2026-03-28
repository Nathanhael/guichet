import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { router, protectedProcedure, adminProcedure } from '../trpc.js';
import { db } from '../../db.js';
import { appFeedback, memberships } from '../../db/schema.js';
import { eq, desc, inArray, and } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import logger from '../../utils/logger.js';

/** Subquery: user IDs that belong to a given partner */
const partnerMemberIds = (partnerId: string) =>
  db.select({ userId: memberships.userId })
    .from(memberships)
    .where(eq(memberships.partnerId, partnerId));

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const feedbackRouter = router({
  list: adminProcedure.query(async ({ ctx }) => {
    try {
      let data: (typeof appFeedback.$inferSelect)[];
      if (ctx.user.isPlatformOperator && !ctx.user.partnerId) {
        data = await db.select()
          .from(appFeedback)
          .orderBy(desc(appFeedback.createdAt));
      } else if (ctx.user.partnerId) {
        data = await db.select()
          .from(appFeedback)
          .where(inArray(appFeedback.userId, partnerMemberIds(ctx.user.partnerId)))
          .orderBy(desc(appFeedback.createdAt));
      } else {
        data = [];
      }

      return data.map(f => ({
        ...f,
        treated: !!f.treated,
      }));
    } catch (err: unknown) {
      const message = errMsg(err);
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
        if (!ctx.user.partnerId) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Partner context required to submit feedback' });
        }

        const id = uuidv4();
        // Use server-side identity — never trust client-supplied userId/userName
        const entry = {
          id,
          userId: ctx.user.id,
          partnerId: ctx.user.partnerId,
          userName: '', // feedback is anonymous by design
          role: ctx.user.role,
          text: input.text.trim(),
          treated: 0,
          createdAt: new Date().toISOString(),
        };

        await db.insert(appFeedback).values(entry);
        return entry;
      } catch (err: unknown) {
        const message = errMsg(err);
        logger.error({ err: message }, 'tRPC: Error creating feedback');
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message });
      }
    }),

  markTreated: adminProcedure
    .input(z.string())
    .mutation(async ({ input: id, ctx }) => {
      try {
        if (ctx.user.partnerId) {
          await db.update(appFeedback)
            .set({ treated: 1 })
            .where(and(eq(appFeedback.id, id), inArray(appFeedback.userId, partnerMemberIds(ctx.user.partnerId))));
        } else if (ctx.user.isPlatformOperator) {
          await db.update(appFeedback)
            .set({ treated: 1 })
            .where(eq(appFeedback.id, id));
        }

        return { success: true };
      } catch (err: unknown) {
        const message = errMsg(err);
        logger.error({ err: message, id }, 'tRPC: Error treating feedback');
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message });
      }
    }),
});
