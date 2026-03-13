import { z } from 'zod';
import { router, protectedProcedure, adminProcedure } from '../trpc.js';
import { db } from '../../db.js';
import { cannedResponses } from '../../db/schema.js';
import { eq, asc } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import logger from '../../utils/logger.js';

export const cannedResponseRouter = router({
  list: protectedProcedure.query(async () => {
    try {
      const data = await db.select()
        .from(cannedResponses)
        .orderBy(asc(cannedResponses.shortcut));
      return data;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err: message }, 'tRPC: Error fetching canned responses');
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message });
    }
  }),

  create: adminProcedure
    .input(z.object({
      shortcut: z.string().min(1),
      text: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      try {
        const id = `cr${Date.now()}`;
        await db.insert(cannedResponses).values({
          id,
          shortcut: input.shortcut,
          text: input.text,
        });
        return { id, ...input };
      } catch (err: unknown) {
        if (err instanceof Error && 'code' in err && (err as Error & { code: string }).code === '23505') {
          throw new TRPCError({ code: 'CONFLICT', message: 'Shortcut already exists' });
        }
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ err: message }, 'tRPC: Error creating canned response');
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message });
      }
    }),

  delete: adminProcedure
    .input(z.string())
    .mutation(async ({ input: id }) => {
      try {
        const result = await db.delete(cannedResponses).where(eq(cannedResponses.id, id));
        return { success: true };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ err: message, id }, 'tRPC: Error deleting canned response');
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message });
      }
    }),
});
