import { z } from 'zod';
import { router, protectedProcedure, adminProcedure } from '../trpc.js';
import { db } from '../../db.js';
import { appFeedback } from '../../db/schema.js';
import { eq, desc, and } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import logger from '../../utils/logger.js';

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const feedbackRouter = router({
  list: adminProcedure.query(async ({ ctx }) => {
    try {
      let data: (typeof appFeedback.$inferSelect)[];
      if (ctx.user.isPlatformOperator && !ctx.user.partnerId) {
        // IM-07: Platform operators without partner context must not see cross-tenant feedback
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Partner context required to list feedback. Use enter-partner first.' });
      } else if (ctx.user.partnerId) {
        // Scope by the row's own partnerId column, not by membership subquery.
        // A multi-partner user's feedback submitted while active in partner B
        // would otherwise leak into partner A's admin view (and be treatable
        // by A's admin) simply because the user is also a member of A.
        data = await db.select()
          .from(appFeedback)
          .where(eq(appFeedback.partnerId, ctx.user.partnerId))
          .orderBy(desc(appFeedback.createdAt));
      } else {
        data = [];
      }

      return data.map(f => ({
        ...f,
        treated: !!f.treated,
      }));
    } catch (err: unknown) {
      logger.error({ err: errMsg(err) }, 'tRPC: Error listing feedback');
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' });
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

        const id = crypto.randomUUID();
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
        logger.error({ err: errMsg(err) }, 'tRPC: Error creating feedback');
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' });
      }
    }),

  markTreated: adminProcedure
    .input(z.string())
    .mutation(async ({ input: id, ctx }) => {
      try {
        // H-7: Platform operators without partner context must not modify cross-tenant feedback
        if (ctx.user.isPlatformOperator && !ctx.user.partnerId) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Partner context required to mark feedback. Use enter-partner first.' });
        }

        if (ctx.user.partnerId) {
          await db.update(appFeedback)
            .set({ treated: 1 })
            .where(and(eq(appFeedback.id, id), eq(appFeedback.partnerId, ctx.user.partnerId)));
        }

        return { success: true };
      } catch (err: unknown) {
        logger.error({ err: errMsg(err), id }, 'tRPC: Error treating feedback');
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' });
      }
    }),
});
