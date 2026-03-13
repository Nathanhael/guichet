import { router, publicProcedure } from '../trpc.js';
import { query } from '../../db.js';
import { TRPCError } from '@trpc/server';

export const userRouter = router({
  list: publicProcedure
    .query(async () => {
      try {
        const users = await query(`
          SELECT u.id, u.name, u.lang, m.role, m.dept 
          FROM users u
          LEFT JOIN memberships m ON u.id = m.user_id AND m.partner_id = 'telecom-01'
        `);
        return users;
      } catch (err: unknown) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: err instanceof Error ? err.message : String(err)
        });
      }
    }),
});
