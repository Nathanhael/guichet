import { router, roleProcedure } from '../trpc.js';
import { db } from '../../db.js';
import { ratings } from '../../db/schema.js';
import { desc } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import logger from '../../utils/logger.js';

export const ratingRouter = router({
  list: roleProcedure(['admin', 'expert']).query(async () => {
    try {
      const data = await db.select()
        .from(ratings)
        .orderBy(desc(ratings.createdAt));
      
      return data;
    } catch (err: any) {
      logger.error({ err: err.message }, 'tRPC: Error listing ratings');
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: err.message });
    }
  }),
});
