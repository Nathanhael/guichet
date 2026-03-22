import { router, platformProcedure } from '../trpc.js';
import { query } from '../../db.js';
import { TRPCError } from '@trpc/server';

export const userRouter = router({
  list: platformProcedure
    .query(async () => {
      try {
        const users = await query(`
          SELECT id, name, lang, is_platform_operator,
            (SELECT role FROM memberships WHERE user_id = users.id LIMIT 1) as role
          FROM users
          WHERE deleted_at IS NULL
          ORDER BY is_platform_operator DESC, name ASC
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
