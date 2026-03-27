import { z } from 'zod';
import { router, roleProcedure } from '../trpc.js';
import { db } from '../../db.js';
import { topicAlerts } from '../../db/schema.js';
import { eq, and, desc } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';

function requirePartnerId(ctx: { user: { partnerId?: string } }): string {
  if (!ctx.user.partnerId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No partner context' });
  return ctx.user.partnerId;
}

type AlertStatus = 'active' | 'acknowledged' | 'resolved';

async function setAlertStatus(alertId: string, partnerId: string, fields: { status: AlertStatus; resolvedAt?: string }) {
  await db
    .update(topicAlerts)
    .set(fields)
    .where(and(eq(topicAlerts.id, alertId), eq(topicAlerts.partnerId, partnerId)));
  return { success: true };
}

export const alertsRouter = router({
  list: roleProcedure(['admin'])
    .input(z.object({
      status: z.enum(['active', 'acknowledged', 'resolved']).optional(),
      limit: z.number().min(1).max(100).default(50),
    }))
    .query(async ({ input, ctx }) => {
      const partnerId = requirePartnerId(ctx);
      const filters = [eq(topicAlerts.partnerId, partnerId)];
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

  acknowledge: roleProcedure(['admin'])
    .input(z.string())
    .mutation(async ({ input, ctx }) => {
      return setAlertStatus(input, requirePartnerId(ctx), { status: 'acknowledged' });
    }),

  resolve: roleProcedure(['admin'])
    .input(z.string())
    .mutation(async ({ input, ctx }) => {
      return setAlertStatus(input, requirePartnerId(ctx), {
        status: 'resolved',
        resolvedAt: new Date().toISOString(),
      });
    }),
});
