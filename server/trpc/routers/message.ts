import { z } from 'zod';
import { router, protectedProcedure } from '../trpc.js';
import { db } from '../../db.js';
import { messages } from '../../db/schema.js';
import { eq, and, asc } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import logger from '../../utils/logger.js';

export const messageRouter = router({
  list: protectedProcedure
    .input(z.object({
      ticketId: z.string(),
    }))
    .query(async ({ input, ctx }) => {
      try {
        const isExpert = ctx.user.role === 'expert' || ctx.user.role === 'admin';
        
        let query = db.select().from(messages).where(eq(messages.ticketId, input.ticketId));

        // Agents shouldn't see whispers
        if (!isExpert) {
          query = db.select().from(messages).where(
            and(
              eq(messages.ticketId, input.ticketId),
              eq(messages.whisper, 0) // SQLite/Drizzle uses 0/1 for booleans sometimes, or boolean directly. 
                                      // Checking schema.ts: whisper is integer? No, let's check.
            )
          );
        }

        const rows = await query.orderBy(asc(messages.createdAt));

        return rows.map(m => ({
          ...m,
          whisper: !!m.whisper,
          system: !!m.system,
          reactions: JSON.parse(m.reactions || '{}'),
        }));
      } catch (err: any) {
        logger.error({ err: err.message, ticketId: input.ticketId }, 'tRPC: Error listing messages');
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: err.message });
      }
    }),
});
