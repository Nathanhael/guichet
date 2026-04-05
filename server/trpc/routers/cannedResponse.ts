import { z } from 'zod';
import { router, partnerScopedProcedure, partnerAdminProcedure, featureGate } from '../trpc.js';
import { db } from '../../db.js';
import { cannedResponses } from '../../db/schema.js';
import { eq, and, asc, isNull, or } from 'drizzle-orm';
import { notFound, conflict } from '../../utils/trpcErrors.js';
import { canUseSupportWorkflows } from '../../services/roles.js';

// DISABLED_FEATURE: Canned Responses — gated until feature is production-ready
const gatedPartnerScoped = partnerScopedProcedure.use(featureGate('cannedResponse'));
const gatedPartnerAdmin = partnerAdminProcedure.use(featureGate('cannedResponse'));

export const cannedResponseRouter = router({
  /**
   * List canned responses for the current partner.
   * Support/admin can see all; optionally filter by department.
   */
  list: gatedPartnerScoped
    .input(z.object({ dept: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      if (!canUseSupportWorkflows(ctx.user.role, ctx.user.isPlatformOperator)) return [];

      const conditions = [eq(cannedResponses.partnerId, ctx.user.partnerId)];

      if (input?.dept) {
        // Show responses for this dept + global ones (dept = null)
        conditions.push(or(eq(cannedResponses.dept, input.dept), isNull(cannedResponses.dept))!);
      }

      return db
        .select({
          id: cannedResponses.id,
          dept: cannedResponses.dept,
          title: cannedResponses.title,
          body: cannedResponses.body,
          shortcut: cannedResponses.shortcut,
          createdAt: cannedResponses.createdAt,
        })
        .from(cannedResponses)
        .where(and(...conditions))
        .orderBy(asc(cannedResponses.title));
    }),

  /**
   * Create a new canned response (admin only).
   */
  create: gatedPartnerAdmin
    .input(z.object({
      title: z.string().min(1).max(100),
      body: z.string().min(1).max(5000),
      dept: z.string().optional(),
      shortcut: z.string().max(50).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Validate shortcut uniqueness within partner
      if (input.shortcut) {
        const existing = await db
          .select({ id: cannedResponses.id })
          .from(cannedResponses)
          .where(and(
            eq(cannedResponses.partnerId, ctx.user.partnerId),
            eq(cannedResponses.shortcut, input.shortcut),
          ))
          .limit(1);

        if (existing.length > 0) {
          throw conflict(`Shortcut "${input.shortcut}" already exists`);
        }
      }

      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      await db.insert(cannedResponses).values({
        id,
        partnerId: ctx.user.partnerId,
        dept: input.dept || null,
        title: input.title,
        body: input.body,
        shortcut: input.shortcut || null,
        createdBy: ctx.user.id,
        createdAt: now,
        updatedAt: now,
      });

      return { id, ...input, createdAt: now };
    }),

  /**
   * Update a canned response (admin only).
   */
  update: gatedPartnerAdmin
    .input(z.object({
      id: z.string(),
      title: z.string().min(1).max(100).optional(),
      body: z.string().min(1).max(5000).optional(),
      dept: z.string().nullable().optional(),
      shortcut: z.string().max(50).nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Verify it belongs to this partner
      const existing = await db
        .select({ id: cannedResponses.id })
        .from(cannedResponses)
        .where(and(eq(cannedResponses.id, input.id), eq(cannedResponses.partnerId, ctx.user.partnerId)))
        .limit(1);

      if (existing.length === 0) throw notFound('Canned response');

      const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
      if (input.title !== undefined) updates.title = input.title;
      if (input.body !== undefined) updates.body = input.body;
      if (input.dept !== undefined) updates.dept = input.dept;
      if (input.shortcut !== undefined) updates.shortcut = input.shortcut;

      await db.update(cannedResponses).set(updates).where(and(eq(cannedResponses.id, input.id), eq(cannedResponses.partnerId, ctx.user.partnerId)));
      return { success: true };
    }),

  /**
   * Delete a canned response (admin only).
   */
  delete: gatedPartnerAdmin
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await db
        .delete(cannedResponses)
        .where(and(eq(cannedResponses.id, input.id), eq(cannedResponses.partnerId, ctx.user.partnerId)));

      return { success: true };
    }),
});
