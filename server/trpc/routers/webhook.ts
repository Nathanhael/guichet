import { z } from 'zod';
import { randomBytes } from 'crypto';
import { router, partnerAdminProcedure } from '../trpc.js';
import { db } from '../../db.js';
import { webhooks, webhookLogs } from '../../db/schema.js';
import { eq, and, desc } from 'drizzle-orm';
import { notFound } from '../../utils/trpcErrors.js';
import { validateWebhookUrl } from '../../services/webhookDispatch.js';

const WEBHOOK_EVENTS = [
  'ticket.created',
  'ticket.closed',
  'ticket.assigned',
  'ticket.reopened',
  'message.created',
  'rating.submitted',
  'user.created',
  'user.deleted',
  '*',
] as const;

const webhookEventsSchema = z.array(z.enum(WEBHOOK_EVENTS)).min(1);

/** Verify a webhook exists and belongs to the current partner. */
async function verifyWebhookOwnership(id: string, partnerId: string) {
  const rows = await db
    .select({ id: webhooks.id })
    .from(webhooks)
    .where(and(eq(webhooks.id, id), eq(webhooks.partnerId, partnerId)))
    .limit(1);

  if (rows.length === 0) throw notFound('Webhook');
  return rows[0];
}

export const webhookRouter = router({
  /** List all webhooks for the current partner */
  list: partnerAdminProcedure.query(async ({ ctx }) => {
    return db
      .select({
        id: webhooks.id,
        url: webhooks.url,
        events: webhooks.events,
        description: webhooks.description,
        active: webhooks.active,
        createdAt: webhooks.createdAt,
      })
      .from(webhooks)
      .where(eq(webhooks.partnerId, ctx.user.partnerId))
      .orderBy(desc(webhooks.createdAt));
  }),

  /** Create a new webhook endpoint */
  create: partnerAdminProcedure
    .input(z.object({
      url: z.string().url().max(2000),
      events: webhookEventsSchema,
      description: z.string().max(200).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // SSRF protection: validate URL before registering
      await validateWebhookUrl(input.url);

      const id = crypto.randomUUID();
      const secret = randomBytes(32).toString('hex');
      const now = new Date().toISOString();

      await db.insert(webhooks).values({
        id,
        partnerId: ctx.user.partnerId,
        url: input.url,
        secret,
        events: input.events,
        description: input.description || null,
        active: true,
        createdBy: ctx.user.id,
        createdAt: now,
        updatedAt: now,
      });

      return { id, secret };
    }),

  /** Update a webhook */
  update: partnerAdminProcedure
    .input(z.object({
      id: z.string(),
      url: z.string().url().max(2000).optional(),
      events: webhookEventsSchema.optional(),
      description: z.string().max(200).nullable().optional(),
      active: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await verifyWebhookOwnership(input.id, ctx.user.partnerId);

      // SSRF protection: validate URL if being updated
      if (input.url !== undefined) {
        await validateWebhookUrl(input.url);
      }

      const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
      if (input.url !== undefined) updates.url = input.url;
      if (input.events !== undefined) updates.events = input.events;
      if (input.description !== undefined) updates.description = input.description;
      if (input.active !== undefined) updates.active = input.active;

      await db.update(webhooks).set(updates).where(and(eq(webhooks.id, input.id), eq(webhooks.partnerId, ctx.user.partnerId)));
      return { success: true };
    }),

  /** Regenerate the signing secret for a webhook */
  regenerateSecret: partnerAdminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await verifyWebhookOwnership(input.id, ctx.user.partnerId);

      const newSecret = randomBytes(32).toString('hex');
      await db.update(webhooks)
        .set({ secret: newSecret, updatedAt: new Date().toISOString() })
        .where(and(eq(webhooks.id, input.id), eq(webhooks.partnerId, ctx.user.partnerId)));

      return { secret: newSecret };
    }),

  /** Delete a webhook */
  delete: partnerAdminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await db
        .delete(webhooks)
        .where(and(eq(webhooks.id, input.id), eq(webhooks.partnerId, ctx.user.partnerId)));

      return { success: true };
    }),

  /** Get recent delivery logs for a webhook */
  logs: partnerAdminProcedure
    .input(z.object({
      webhookId: z.string(),
      limit: z.number().min(1).max(100).optional(),
    }))
    .query(async ({ ctx, input }) => {
      // Verify webhook belongs to partner
      const hook = await db
        .select({ id: webhooks.id })
        .from(webhooks)
        .where(and(eq(webhooks.id, input.webhookId), eq(webhooks.partnerId, ctx.user.partnerId)))
        .limit(1);

      if (hook.length === 0) return [];

      return db
        .select({
          id: webhookLogs.id,
          event: webhookLogs.event,
          statusCode: webhookLogs.statusCode,
          error: webhookLogs.error,
          durationMs: webhookLogs.durationMs,
          createdAt: webhookLogs.createdAt,
        })
        .from(webhookLogs)
        .where(eq(webhookLogs.webhookId, input.webhookId))
        .orderBy(desc(webhookLogs.createdAt))
        .limit(input.limit || 25);
    }),

  /** Test-fire a webhook with a sample payload */
  test: partnerAdminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Fetch the specific webhook (verifies ownership and gets secret/url)
      const rows = await db
        .select()
        .from(webhooks)
        .where(and(eq(webhooks.id, input.id), eq(webhooks.partnerId, ctx.user.partnerId)))
        .limit(1);

      if (rows.length === 0) throw notFound('Webhook');

      const hook = rows[0];

      // Deliver only to this specific webhook, not all partner webhooks
      const { deliverWebhookTest } = await import('../../services/webhookDispatch.js');
      deliverWebhookTest(hook, 'ticket.created', {
        _test: true,
        ticketId: 'test-000',
        agentName: 'Test Agent',
        message: 'This is a test webhook delivery from Tessera.',
      });

      return { success: true };
    }),
});
