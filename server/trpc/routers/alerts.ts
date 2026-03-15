import { z } from 'zod';
import { router, roleProcedure, protectedProcedure } from '../trpc.js';
import { db } from '../../db.js';
import { topicAlerts } from '../../db/schema.js';
import { eq, and, desc } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';

export const alertsRouter = router({
  /**
   * List all alerts for the current partner.
   * Accessible by Admins and Managers.
   */
  list: roleProcedure(['admin', 'manager'])
    .input(z.object({
      status: z.enum(['active', 'acknowledged', 'resolved']).optional(),
      limit: z.number().min(1).max(100).default(50),
    }))
    .query(async ({ input, ctx }) => {
      try {
        const filters = [eq(topicAlerts.partnerId, ctx.user.partnerId)];
        if (input.status) {
          filters.push(eq(topicAlerts.status, input.status));
        }

        return await db
          .select()
          .from(topicAlerts)
          .where(and(...filters))
          .orderBy(desc(topicAlerts.createdAt))
          .limit(input.limit);
      } catch (err: unknown) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
      }
    }),

  /**
   * Mark an alert as acknowledged.
   */
  acknowledge: roleProcedure(['admin', 'manager'])
    .input(z.string())
    .mutation(async ({ input, ctx }) => {
      try {
        const result = await db
          .update(topicAlerts)
          .set({ status: 'acknowledged' })
          .where(
            and(
              eq(topicAlerts.id, input),
              eq(topicAlerts.partnerId, ctx.user.partnerId)
            )
          );
        return { success: true };
      } catch (err: unknown) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
      }
    }),

  /**
   * Mark an alert as resolved.
   */
  resolve: roleProcedure(['admin', 'manager'])
    .input(z.string())
    .mutation(async ({ input, ctx }) => {
      try {
        const result = await db
          .update(topicAlerts)
          .set({ 
            status: 'resolved',
            resolvedAt: new Date().toISOString()
          })
          .where(
            and(
              eq(topicAlerts.id, input),
              eq(topicAlerts.partnerId, ctx.user.partnerId)
            )
          );
        return { success: true };
      } catch (err: unknown) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
      }
    }),
});
