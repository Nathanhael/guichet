import { z } from 'zod';
import { router, protectedProcedure } from '../trpc.js';
import { db } from '../../db.js';
import { messages, tickets } from '../../db/schema.js';
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

        // Ownership check for agents
        if (!isExpert) {
          const ticketResult = await db.select({ agentId: tickets.agentId })
            .from(tickets)
            .where(eq(tickets.id, input.ticketId))
            .limit(1);
          
          if (ticketResult.length === 0 || ticketResult[0].agentId !== ctx.user.id) {
            throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized to view these messages' });
          }
        }
        
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
      } catch (err: unknown) {
        if (err instanceof TRPCError) throw err;
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ err: message, ticketId: input.ticketId }, 'tRPC: Error listing messages');
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message });
      }
    }),
});
