import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { router, adminProcedure, protectedProcedure } from '../trpc.js';
import { db } from '../../db.js';
import { labels, ticketLabels } from '../../db/schema.js';
import { eq, and, asc } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { notFound, conflict, wrapError } from '../../utils/trpcErrors.js';
import type { Server } from 'socket.io';

interface RequestWithSocketIO {
  app: { get(key: 'io'): Server | undefined; get(key: string): unknown };
}

function emitToPartner(ctx: { req: unknown; user: { partnerId?: string | null } }, event: string, data: unknown) {
  const io = (ctx.req as unknown as RequestWithSocketIO).app.get('io');
  if (io && ctx.user.partnerId) {
    io.to(`partner:${ctx.user.partnerId}`).emit(event, data);
  }
}

// NOTE: label router intentionally uses protectedProcedure/adminProcedure instead of
// partnerScopedProcedure because platform operators can list labels across ALL partners
// (no partnerId filter). The other CRUD ops still require partner context manually.
export const labelRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    try {
      if (!ctx.user.partnerId && !ctx.user.isPlatformOperator) return [];

      const conditions = [];
      if (!ctx.user.isPlatformOperator) {
        conditions.push(eq(labels.partnerId, ctx.user.partnerId!));
      }

      return await db.select({
        id: labels.id,
        text: labels.name,
        color: labels.color,
      })
      .from(labels)
      .where(conditions.length > 0 ? conditions[0] : undefined)
      .orderBy(asc(labels.name));
    } catch (err: unknown) {
      wrapError(err, 'Error fetching labels');
    }
  }),

  create: adminProcedure
    .input(z.object({
      text: z.string().min(1),
      color: z.string().min(1),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        if (!ctx.user.partnerId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No active partner' });

        const id = `l_${uuidv4()}`;
        await db.insert(labels).values({
          id,
          partnerId: ctx.user.partnerId,
          name: input.text,
          color: input.color,
        });

        emitToPartner(ctx, 'label:created', { id, text: input.text, color: input.color });

        return { id, ...input };
      } catch (err: unknown) {
        if (err instanceof Error && 'code' in err && (err as Error & { code: string }).code === '23505') {
          throw conflict('Label name already exists for this partner');
        }
        wrapError(err, 'Error creating label');
      }
    }),

  delete: adminProcedure
    .input(z.string())
    .mutation(async ({ input: id, ctx }) => {
      try {
        const conditions = [eq(labels.id, id)];
        if (!ctx.user.isPlatformOperator) {
          conditions.push(eq(labels.partnerId, ctx.user.partnerId!));
        }

        await db.transaction(async (tx) => {
          const existing = await tx.select().from(labels).where(and(...conditions)).limit(1);
          if (existing.length === 0) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Label not found or access denied' });
          }

          await tx.delete(ticketLabels).where(eq(ticketLabels.labelId, id));
          await tx.delete(labels).where(eq(labels.id, id));
        });

        emitToPartner(ctx, 'label:deleted', { id });

        return { success: true };
      } catch (err: unknown) {
        wrapError(err, 'Error deleting label');
      }
    }),
});
