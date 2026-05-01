import { z } from 'zod';
import { router, protectedProcedure, partnerScopedProcedure } from '../trpc.js';
import { getAvailability } from '../../services/availability/index.js';
import { TRPCError } from '@trpc/server';
import { canChangePresenceStatus } from '../../services/roles.js';

export const presenceRouter = router({
  getOnlineStatus: partnerScopedProcedure
    .input(z.object({
      userId: z.string(),
    }))
    .query(async ({ input, ctx }) => {
      const onlineUsers = await getAvailability().advanced.onlineUsers(ctx.user.partnerId);
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
      const availability = getAvailability();
      // Preserve legacy NOT_FOUND UX: setStatus is a silent no-op for never-identified users.
      const exists = (await availability.advanced.getStatus(input.userId, partnerId)) !== null;
      if (!exists) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not online' });
      }
      await availability.setStatus(input.userId, partnerId, input.status);
      return { success: true };
    }),
});
