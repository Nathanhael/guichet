import { z } from 'zod';
import { router, protectedProcedure } from '../trpc.js';
import * as presenceService from '../../services/presence.js';
import { TRPCError } from '@trpc/server';

export const presenceRouter = router({
  getOnlineStatus: protectedProcedure
    .input(z.object({
      userId: z.string(),
      partnerId: z.string(),
    }))
    .query(async ({ input }) => {
      const onlineUsers = await presenceService.getOnlineUsersForPartner(input.partnerId);
      const online = onlineUsers.some(u => u.userId === input.userId);
      return { online };
    }),

  setStatus: protectedProcedure
    .input(z.object({
      userId: z.string(),
      status: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      // Security: Only allow admins or support to change status (or user changing their own status)
      if (ctx.user.role !== 'admin' && ctx.user.role !== 'support' && ctx.user.id !== input.userId) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized to change status' });
      }

      const updated = await presenceService.setUserStatus(input.userId, input.status);
      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not online' });
      }
      return { success: true };
    }),
});
