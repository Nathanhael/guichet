import { z } from 'zod';
import { randomBytes } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { router, adminProcedure } from '../trpc.js';
import { db } from '../../db.js';
import { webhooks, webhookLogs } from '../../db/schema.js';
import { eq, and, desc } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';

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

export const webhookRouter = router({
  /** List all webhooks for the current partner */
  list: adminProcedure.query(async ({ ctx }) => {
    if (!ctx.user.partnerId) return [];

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
  create: adminProcedure
    .input(z.object({
      url: z.string().url().max(2000),
      events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
      description: z.string().max(200).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.partnerId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No partner context' });
      }

      const id = uuidv4();
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
  update: adminProcedure
    .input(z.object({
      id: z.string(),
      url: z.string().url().max(2000).optional(),
      events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).optional(),
      description: z.string().max(200).nullable().optional(),
      active: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.partnerId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No partner context' });
      }

      const existing = await db
        .select({ id: webhooks.id })
        .from(webhooks)
        .where(and(eq(webhooks.id, input.id), eq(webhooks.partnerId, ctx.user.partnerId)))
        .limit(1);

      if (existing.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Webhook not found' });
      }

      const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
      if (input.url !== undefined) updates.url = input.url;
      if (input.events !== undefined) updates.events = input.events;
      if (input.description !== undefined) updates.description = input.description;
      if (input.active !== undefined) updates.active = input.active;

      await db.update(webhooks).set(updates).where(eq(webhooks.id, input.id));
      return { success: true };
    }),

  /** Regenerate the signing secret for a webhook */
  regenerateSecret: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.partnerId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No partner context' });
      }

      const existing = await db
        .select({ id: webhooks.id })
        .from(webhooks)
        .where(and(eq(webhooks.id, input.id), eq(webhooks.partnerId, ctx.user.partnerId)))
        .limit(1);

      if (existing.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Webhook not found' });
      }

      const newSecret = randomBytes(32).toString('hex');
      await db.update(webhooks)
        .set({ secret: newSecret, updatedAt: new Date().toISOString() })
        .where(eq(webhooks.id, input.id));

      return { secret: newSecret };
    }),

  /** Delete a webhook */
  delete: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.partnerId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No partner context' });
      }

      await db
        .delete(webhooks)
        .where(and(eq(webhooks.id, input.id), eq(webhooks.partnerId, ctx.user.partnerId)));

      return { success: true };
    }),

  /** Get recent delivery logs for a webhook */
  logs: adminProcedure
    .input(z.object({
      webhookId: z.string(),
      limit: z.number().min(1).max(100).optional(),
    }))
    .query(async ({ ctx, input }) => {
      if (!ctx.user.partnerId) return [];

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
  test: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.partnerId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No partner context' });
      }

      const hook = await db
        .select()
        .from(webhooks)
        .where(and(eq(webhooks.id, input.id), eq(webhooks.partnerId, ctx.user.partnerId)))
        .limit(1);

      if (hook.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Webhook not found' });
      }

      // Fire a test event
      const { fireWebhooks } = await import('../../services/webhookDispatch.js');
      fireWebhooks(ctx.user.partnerId, 'ticket.created', {
        _test: true,
        ticketId: 'test-000',
        agentName: 'Test Agent',
        message: 'This is a test webhook delivery from Tessera.',
      });

      return { success: true };
    }),
});
