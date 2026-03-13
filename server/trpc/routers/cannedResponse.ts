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
    } catch (err: any) {
      logger.error({ err: err.message }, 'tRPC: Error fetching canned responses');
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: err.message });
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
      } catch (err: any) {
        if (err.code === '23505') {
          throw new TRPCError({ code: 'CONFLICT', message: 'Shortcut already exists' });
        }
        logger.error({ err: err.message }, 'tRPC: Error creating canned response');
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: err.message });
      }
    }),

  delete: adminProcedure
    .input(z.string())
    .mutation(async ({ input: id }) => {
      try {
        const result = await db.delete(cannedResponses).where(eq(cannedResponses.id, id));
        return { success: true };
      } catch (err: any) {
        logger.error({ err: err.message, id }, 'tRPC: Error deleting canned response');
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: err.message });
      }
    }),
});
