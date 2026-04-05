import { z } from 'zod';
import { router, protectedProcedure } from '../trpc.js';
import * as presenceService from '../../services/presence.js';
import { TRPCError } from '@trpc/server';
import { canChangePresenceStatus } from '../../services/roles.js';

export const presenceRouter = router({
  getOnlineStatus: protectedProcedure
    .input(z.object({
      userId: z.string(),
      partnerId: z.string(),
    }))
    .query(async ({ input, ctx }) => {
      // Authorization: only allow querying the caller's own partner (or platform operators)
      if (!ctx.user.isPlatformOperator && input.partnerId !== ctx.user.partnerId) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized to query this partner' });
      }
      const onlineUsers = await presenceService.getOnlineUsersForPartner(input.partnerId);
      const online = onlineUsers.some(u => u.userId === input.userId);
      return { online };
    }),

  setStatus: protectedProcedure
    .input(z.object({
      userId: z.string(),
      status: z.enum(['online', 'away']),
    }))
    .mutation(async ({ input, ctx }) => {
      // Security: Only allow admins or support to change status (or user changing their own status)
      if (!canChangePresenceStatus(ctx.user.role, ctx.user.id, input.userId, ctx.user.isPlatformOperator)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized to change status' });
      }

      const partnerId = ctx.user.partnerId;
      if (!partnerId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No partner context' });
      }
      const updated = await presenceService.setUserStatus(input.userId, partnerId, input.status);
      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not online' });
      }
      return { success: true };
    }),
});
