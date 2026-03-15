import { z } from 'zod';
import { router, adminProcedure } from '../trpc.js';
import { db } from '../../db.js';
import { partners } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import logger from '../../utils/logger.js';

export const partnerRouter = router({
  getManifest: adminProcedure.query(async ({ ctx }) => {
    try {
      const partnerId = ctx.user.partnerId;
      if (!partnerId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No active partner context' });

      const result = await db.select().from(partners).where(eq(partners.id, partnerId)).limit(1);
      if (result.length === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'Partner not found' });

      return result[0];
    } catch (err: unknown) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
    }
  }),

  updateAIRules: adminProcedure
    .input(z.object({
      aiRules: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        const partnerId = ctx.user.partnerId;
        if (!partnerId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No active partner context' });

        await db.update(partners)
          .set({ aiRules: input.aiRules })
          .where(eq(partners.id, partnerId));

        logger.info({ partnerId }, 'AI Rules updated by Partner Admin');
        return { success: true };
      } catch (err: unknown) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
      }
    }),

  updateAIStrategies: adminProcedure
    .input(z.object({
      agentPromptStrategy: z.string(),
      supportPromptStrategy: z.string(),
      enableActionableAi: z.boolean(),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        const partnerId = ctx.user.partnerId;
        if (!partnerId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No active partner context' });

        await db.update(partners)
          .set({ 
            agentPromptStrategy: input.agentPromptStrategy,
            supportPromptStrategy: input.supportPromptStrategy,
            enableActionableAi: input.enableActionableAi
          })
          .where(eq(partners.id, partnerId));

        return { success: true };
      } catch (err: unknown) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
      }
    }),

  updateBusinessHours: adminProcedure
    .input(z.object({
      businessHoursStart: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
      businessHoursEnd: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
      businessHoursTimezone: z.string().min(1).nullable(),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        const partnerId = ctx.user.partnerId;
        if (!partnerId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No active partner context' });

        await db.update(partners)
          .set({ 
            businessHoursStart: input.businessHoursStart,
            businessHoursEnd: input.businessHoursEnd,
            businessHoursTimezone: input.businessHoursTimezone
          })
          .where(eq(partners.id, partnerId));

        logger.info({ partnerId }, 'Business Hours updated by Partner Admin');
        return { success: true };
      } catch (err: unknown) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
      }
    }),
});
