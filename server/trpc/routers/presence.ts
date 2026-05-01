import { z } from 'zod';
import { router, protectedProcedure, partnerScopedProcedure } from '../trpc.js';
import { getAvailability } from '../../services/availability/instance.js';
import { TRPCError } from '@trpc/server';
import { canChangePresenceStatus } from '../../services/roles.js';

export const presenceRouter = router({
  getOnlineStatus: partnerScopedProcedure
    .input(z.object({
      userId: z.string(),
    }))
    .query(async ({ input, ctx }) => {
      const online = await getAvailability().isOnline(input.userId, ctx.user.partnerId);
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

      // The availability module handles "user not identified" as a silent no-op
      // (no Redis hash exists). To preserve the legacy NOT_FOUND error, gate on
      // online state first.
      const isOnline = await getAvailability().isOnline(input.userId, partnerId);
      if (!isOnline) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not online' });
      }
      await getAvailability().setStatus(input.userId, partnerId, input.status);
      return { success: true };
    }),
});
