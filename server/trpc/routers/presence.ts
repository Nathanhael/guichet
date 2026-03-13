import { z } from 'zod';
import { router, protectedProcedure } from '../trpc.js';
import * as presenceService from '../../services/presence.js';

export const presenceRouter = router({
  getOnlineStatus: protectedProcedure
    .input(z.object({
      userId: z.string(),
    }))
    .query(({ input }) => {
      const online = presenceService.getOnlineUsers().has(input.userId);
      return { online };
    }),
});
