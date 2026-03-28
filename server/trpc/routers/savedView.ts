import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { router, protectedProcedure } from '../trpc.js';
import { db } from '../../db.js';
import { savedViews } from '../../db/schema.js';
import { eq, and, asc } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { wrapError } from '../../utils/trpcErrors.js';

const MAX_SAVED_VIEWS = 20;

const filtersSchema = z.object({
  dept: z.string().optional(),
  tab: z.enum(['queue', 'archive', 'search']).optional(),
  status: z.string().optional(),
}).passthrough();

export const savedViewRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    try {
      if (!ctx.user.partnerId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Partner context required' });
      }

      return await db.select()
        .from(savedViews)
        .where(and(
          eq(savedViews.partnerId, ctx.user.partnerId),
          eq(savedViews.userId, ctx.user.id),
        ))
        .orderBy(asc(savedViews.name));
    } catch (err: unknown) {
      wrapError(err, 'Error fetching saved views');
    }
  }),

  create: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(50),
      filters: filtersSchema,
      isDefault: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        if (!ctx.user.partnerId) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Partner context required' });
        }

        const existing = await db.select({ id: savedViews.id })
          .from(savedViews)
          .where(and(
            eq(savedViews.partnerId, ctx.user.partnerId),
            eq(savedViews.userId, ctx.user.id),
          ));

        if (existing.length >= MAX_SAVED_VIEWS) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Maximum of ${MAX_SAVED_VIEWS} saved views allowed`,
          });
        }

        if (input.isDefault) {
          await db.update(savedViews)
            .set({ isDefault: false })
            .where(and(
              eq(savedViews.partnerId, ctx.user.partnerId),
              eq(savedViews.userId, ctx.user.id),
            ));
        }

        const id = `sv_${uuidv4()}`;
        const now = new Date().toISOString();

        await db.insert(savedViews).values({
          id,
          partnerId: ctx.user.partnerId,
          userId: ctx.user.id,
          name: input.name,
          filters: input.filters,
          isDefault: input.isDefault ?? false,
          createdAt: now,
          updatedAt: now,
        });

        return { id, name: input.name, filters: input.filters, isDefault: input.isDefault ?? false };
      } catch (err: unknown) {
        wrapError(err, 'Error creating saved view');
      }
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.string(),
      name: z.string().min(1).max(50).optional(),
      filters: filtersSchema.optional(),
      isDefault: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        if (!ctx.user.partnerId) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Partner context required' });
        }

        const existing = await db.select({ id: savedViews.id })
          .from(savedViews)
          .where(and(
            eq(savedViews.id, input.id),
            eq(savedViews.partnerId, ctx.user.partnerId),
            eq(savedViews.userId, ctx.user.id),
          ));

        if (existing.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Saved view not found or access denied' });
        }

        if (input.isDefault) {
          await db.update(savedViews)
            .set({ isDefault: false })
            .where(and(
              eq(savedViews.partnerId, ctx.user.partnerId),
              eq(savedViews.userId, ctx.user.id),
            ));
        }

        const updates: Partial<typeof savedViews.$inferInsert> = {
          updatedAt: new Date().toISOString(),
        };
        if (input.name !== undefined) updates.name = input.name;
        if (input.filters !== undefined) updates.filters = input.filters;
        if (input.isDefault !== undefined) updates.isDefault = input.isDefault;

        await db.update(savedViews)
          .set(updates)
          .where(and(
            eq(savedViews.id, input.id),
            eq(savedViews.partnerId, ctx.user.partnerId),
            eq(savedViews.userId, ctx.user.id),
          ));

        return { success: true };
      } catch (err: unknown) {
        wrapError(err, 'Error updating saved view');
      }
    }),

  delete: protectedProcedure
    .input(z.string())
    .mutation(async ({ input: id, ctx }) => {
      try {
        if (!ctx.user.partnerId) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Partner context required' });
        }

        const deleted = await db.delete(savedViews)
          .where(and(
            eq(savedViews.id, id),
            eq(savedViews.partnerId, ctx.user.partnerId),
            eq(savedViews.userId, ctx.user.id),
          ))
          .returning({ id: savedViews.id });

        if (deleted.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Saved view not found or access denied' });
        }

        return { success: true };
      } catch (err: unknown) {
        wrapError(err, 'Error deleting saved view');
      }
    }),
});
