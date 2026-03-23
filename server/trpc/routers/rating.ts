import { router, roleProcedure } from '../trpc.js';
import { db } from '../../db.js';
import { ratings, tickets } from '../../db/schema.js';
import { desc, eq, inArray } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import logger from '../../utils/logger.js';

export const ratingRouter = router({
  list: roleProcedure(['admin', 'support']).query(async ({ ctx }) => {
    try {
      // Tenant isolation: only return ratings for tickets belonging to the caller's partner
      if (!ctx.user.partnerId && !ctx.user.isPlatformOperator) {
        return [];
      }

      if (ctx.user.isPlatformOperator && !ctx.user.partnerId) {
        // Platform operators without an active partner context see all
        const data = await db.select()
          .from(ratings)
          .orderBy(desc(ratings.createdAt));
        return data;
      }

      // Scope ratings to this partner's tickets
      const partnerTicketIds = db.select({ id: tickets.id })
        .from(tickets)
        .where(eq(tickets.partnerId, ctx.user.partnerId!));

      const data = await db.select()
        .from(ratings)
        .where(inArray(ratings.ticketId, partnerTicketIds))
        .orderBy(desc(ratings.createdAt));

      return data;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err: message }, 'tRPC: Error listing ratings');
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message });
    }
  }),
});
