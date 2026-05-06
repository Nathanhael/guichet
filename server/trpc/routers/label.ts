import { z } from 'zod';
import { router, adminProcedure, protectedProcedure } from '../trpc.js';
import { db } from '../../db.js';
import { labels, ticketLabels, auditLog } from '../../db/schema.js';
import { eq, and, asc } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { conflict, wrapError } from '../../utils/trpcErrors.js';
import { trpcActor } from '../../services/auth/index.js';
import type { Server } from 'socket.io';

const ALLOWED_COLORS = ['blue', 'indigo', 'purple', 'emerald', 'teal', 'cyan', 'sky', 'amber', 'orange', 'rose', 'pink', 'slate'] as const;

interface RequestWithSocketIO {
  app: { get(key: 'io'): Server | undefined; get(key: string): unknown };
}

function emitToPartner(ctx: { req: unknown; user: { partnerId?: string | null } }, event: string, data: unknown) {
  const io = (ctx.req as unknown as RequestWithSocketIO).app.get('io');
  if (io && ctx.user.partnerId) {
    io.to(`partner:${ctx.user.partnerId}`).emit(event, data);
  }
}

// NOTE: label router uses protectedProcedure/adminProcedure instead of
// partnerScopedProcedure. All operations require partner context (partnerId).
export const labelRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    try {
      if (!ctx.user.partnerId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Partner context required' });
      }

      return await db.select({
        id: labels.id,
        name: labels.name,
        color: labels.color,
      })
      .from(labels)
      .where(eq(labels.partnerId, ctx.user.partnerId))
      .orderBy(asc(labels.name));
    } catch (err: unknown) {
      wrapError(err, 'Error fetching labels');
    }
  }),

  create: adminProcedure
    .input(z.object({
      name: z.string().min(1).max(50).transform(s => s.trim()),
      color: z.enum(ALLOWED_COLORS),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        trpcActor(ctx, { capability: 'destructive_admin' });
        if (!ctx.user.partnerId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No active partner' });

        const id = `l_${crypto.randomUUID()}`;
        await db.insert(labels).values({
          id,
          partnerId: ctx.user.partnerId,
          name: input.name,
          color: input.color,
        });

        await db.insert(auditLog).values({
          action: 'label.created',
          actorId: ctx.user.id,
          partnerId: ctx.user.partnerId,
          targetType: 'label',
          targetId: id,
          metadata: { name: input.name, color: input.color },
        });

        emitToPartner(ctx, 'label:created', { id, name: input.name, color: input.color });

        return { id, name: input.name, color: input.color };
      } catch (err: unknown) {
        if (err instanceof Error && 'code' in err && (err as Error & { code: string }).code === '23505') {
          throw conflict('Label name already exists for this partner');
        }
        wrapError(err, 'Error creating label');
      }
    }),

  update: adminProcedure
    .input(z.object({
      id: z.string().min(1),
      name: z.string().min(1).max(50).transform(s => s.trim()).optional(),
      color: z.enum(ALLOWED_COLORS).optional(),
    }).refine(data => data.name !== undefined || data.color !== undefined, {
      message: 'At least one field must be provided',
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        trpcActor(ctx, { capability: 'destructive_admin' });
        if (!ctx.user.partnerId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No active partner' });

        const conditions = [eq(labels.id, input.id), eq(labels.partnerId, ctx.user.partnerId)];
        const existing = await db.select().from(labels).where(and(...conditions)).limit(1);
        if (existing.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Label not found or access denied' });
        }

        const updates: Partial<{ name: string; color: string }> = {};
        if (input.name !== undefined) updates.name = input.name;
        if (input.color !== undefined) updates.color = input.color;

        await db.update(labels).set(updates).where(and(...conditions));

        const updated = { id: input.id, name: input.name ?? existing[0].name, color: input.color ?? existing[0].color };

        await db.insert(auditLog).values({
          action: 'label.updated',
          actorId: ctx.user.id,
          partnerId: ctx.user.partnerId,
          targetType: 'label',
          targetId: input.id,
          metadata: updates,
        });

        emitToPartner(ctx, 'label:updated', updated);

        return updated;
      } catch (err: unknown) {
        if (err instanceof Error && 'code' in err && (err as Error & { code: string }).code === '23505') {
          throw conflict('Label name already exists for this partner');
        }
        wrapError(err, 'Error updating label');
      }
    }),

  delete: adminProcedure
    .input(z.string().min(1))
    .mutation(async ({ input: id, ctx }) => {
      try {
        trpcActor(ctx, { capability: 'destructive_admin' });
        if (!ctx.user.partnerId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No active partner' });

        // Always scope to current partner — platform operators have partnerId set via enter-partner
        const conditions = [eq(labels.id, id), eq(labels.partnerId, ctx.user.partnerId)];

        await db.transaction(async (tx) => {
          const existing = await tx.select().from(labels).where(and(...conditions)).limit(1);
          if (existing.length === 0) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Label not found or access denied' });
          }

          await tx.delete(ticketLabels).where(eq(ticketLabels.labelId, id));
          await tx.delete(labels).where(and(...conditions));

          await tx.insert(auditLog).values({
            action: 'label.deleted',
            actorId: ctx.user.id,
            partnerId: ctx.user.partnerId,
            targetType: 'label',
            targetId: id,
          });
        });

        emitToPartner(ctx, 'label:deleted', { id });

        return { success: true };
      } catch (err: unknown) {
        wrapError(err, 'Error deleting label');
      }
    }),
});
