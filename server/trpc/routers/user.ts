import { router, publicProcedure } from '../trpc.js';
import { query } from '../../db.js';
import { TRPCError } from '@trpc/server';

export const userRouter = router({
  list: publicProcedure
    .query(async () => {
      try {
        const users = await query('SELECT id, name, role, dept, lang FROM users');
        return users;
      } catch (err: any) {
        throw new TRPCError({ 
          code: 'INTERNAL_SERVER_ERROR', 
          message: err.message 
        });
      }
    }),
});
