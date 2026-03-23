import { router, platformProcedure, publicProcedure } from '../trpc.js';
import { query } from '../../db.js';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { revokeUserSessions } from '../../services/sessionRevocation.js';
import { db } from '../../db.js';
import { auditLog } from '../../db/schema.js';
import { randomUUID } from 'crypto';

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

  /** Public demo user list — only available when DEMO_MODE=true */
  demoList: publicProcedure
    .query(async () => {
      if (process.env.DEMO_MODE !== 'true') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Demo mode is not enabled' });
      }
      try {
        const users = await query(`
          SELECT id, name, email, lang, is_platform_operator,
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

  revokeSessions: platformProcedure
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const revokedAfter = await revokeUserSessions(input.userId);

        await db.insert(auditLog).values({
          id: randomUUID(),
          action: 'user.sessions_revoked',
          actorId: ctx.user.id,
          targetType: 'user',
          targetId: input.userId,
          metadata: { revokedAfter },
        });

        return { success: true, revokedAfter };
      } catch (err: unknown) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: err instanceof Error ? err.message : String(err)
        });
      }
    }),
});
