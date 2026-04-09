import { z } from 'zod';
import { router, partnerAdminProcedure } from '../trpc.js';
import { db } from '../../db.js';
import { topicAlerts } from '../../db/schema.js';
import { eq, and, desc } from 'drizzle-orm';

type AlertStatus = 'active' | 'acknowledged' | 'resolved';

async function setAlertStatus(alertId: string, partnerId: string, fields: { status: AlertStatus; resolvedAt?: string }) {
  await db
    .update(topicAlerts)
    .set(fields)
    .where(and(eq(topicAlerts.id, alertId), eq(topicAlerts.partnerId, partnerId)));
  return { success: true };
}

export const alertsRouter = router({
  list: partnerAdminProcedure
    .input(z.object({
      status: z.enum(['active', 'acknowledged', 'resolved']).optional(),
      limit: z.number().min(1).max(100).default(50),
    }))
    .query(async ({ input, ctx }) => {
      const filters = [eq(topicAlerts.partnerId, ctx.user.partnerId)];
      if (input.status) {
        filters.push(eq(topicAlerts.status, input.status));
      }

      return db
        .select()
        .from(topicAlerts)
        .where(and(...filters))
        .orderBy(desc(topicAlerts.createdAt))
        .limit(input.limit);
    }),

  acknowledge: partnerAdminProcedure
    .input(z.string())
    .mutation(async ({ input, ctx }) => {
      return setAlertStatus(input, ctx.user.partnerId, { status: 'acknowledged' });
    }),

  resolve: partnerAdminProcedure
    .input(z.string())
    .mutation(async ({ input, ctx }) => {
      return setAlertStatus(input, ctx.user.partnerId, {
        status: 'resolved',
        resolvedAt: new Date().toISOString(),
      });
    }),
});
