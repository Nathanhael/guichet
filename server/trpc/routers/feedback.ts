import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { router, protectedProcedure, adminProcedure } from '../trpc.js';
import { db } from '../../db.js';
import { appFeedback } from '../../db/schema.js';
import { eq, desc } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import logger from '../../utils/logger.js';

export const feedbackRouter = router({
  list: adminProcedure.query(async () => {
    try {
      const data = await db.select()
        .from(appFeedback)
        .orderBy(desc(appFeedback.createdAt));
      
      return data.map(f => ({
        ...f,
        treated: !!f.treated,
      }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err: message }, 'tRPC: Error listing feedback');
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message });
    }
  }),

  create: protectedProcedure
    .input(z.object({
      userId: z.string().min(1),
      userName: z.string().min(1),
      role: z.enum(['agent', 'expert']),
      text: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      try {
        const id = uuidv4();
        const entry = {
          id,
          userId: input.userId,
          userName: input.userName,
          role: input.role,
          text: input.text.trim(),
          treated: 0,
          createdAt: new Date().toISOString(),
        };

        await db.insert(appFeedback).values(entry);
        return entry;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ err: message }, 'tRPC: Error creating feedback');
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message });
      }
    }),

  markTreated: adminProcedure
    .input(z.string())
    .mutation(async ({ input: id }) => {
      try {
        await db.update(appFeedback)
          .set({ treated: 1 })
          .where(eq(appFeedback.id, id));
        
        return { success: true };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ err: message, id }, 'tRPC: Error treating feedback');
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message });
      }
    }),
});
