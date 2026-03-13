import { z } from 'zod';
import { router, publicProcedure, adminProcedure } from '../trpc.js';
import { db } from '../../db.js';
import { labels, ticketLabels } from '../../db/schema.js';
import { eq, asc } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import type { Server } from 'socket.io';
import logger from '../../utils/logger.js';

interface RequestWithSocketIO {
  app: { get(key: 'io'): Server | undefined; get(key: string): unknown };
}

export const labelRouter = router({
  list: publicProcedure.query(async () => {
    try {
      const data = await db.select({
        id: labels.id,
        text: labels.name,
        color: labels.color,
      })
      .from(labels)
      .orderBy(asc(labels.name));
      
      return data;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err: message }, 'tRPC: Error fetching labels');
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message });
    }
  }),

  create: adminProcedure
    .input(z.object({
      text: z.string().min(1),
      color: z.string().min(1),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        const id = 'l' + Date.now();
        await db.insert(labels).values({
          id,
          name: input.text,
          color: input.color,
        });

        const io = (ctx.req as unknown as RequestWithSocketIO).app.get('io');
        if (io) {
          io.emit('label:created', { id, text: input.text, color: input.color });
        }

        return { id, ...input };
      } catch (err: unknown) {
        if (err instanceof Error && 'code' in err && (err as Error & { code: string }).code === '23505') {
          throw new TRPCError({ code: 'CONFLICT', message: 'Label name already exists' });
        }
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ err: message }, 'tRPC: Error creating label');
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message });
      }
    }),

  delete: adminProcedure
    .input(z.string())
    .mutation(async ({ input: id, ctx }) => {
      try {
        await db.transaction(async (tx) => {
          await tx.delete(ticketLabels).where(eq(ticketLabels.labelId, id));
          await tx.delete(labels).where(eq(labels.id, id));
        });

        const io = (ctx.req as unknown as RequestWithSocketIO).app.get('io');
        if (io) {
          io.emit('label:deleted', { id });
        }

        return { success: true };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ err: message, labelId: id }, 'tRPC: Error deleting label');
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message });
      }
    }),
});
