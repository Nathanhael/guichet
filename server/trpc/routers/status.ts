import { z } from 'zod';
import { router, protectedProcedure } from '../trpc.js';
import { TRPCError } from '@trpc/server';
import { inArray } from 'drizzle-orm';
import { db } from '../../db.js';
import { users } from '../../db/schema.js';
import * as statusTracking from '../../services/statusTracking.js';
import * as presenceService from '../../services/presence.js';

export const statusRouter = router({
  /** Get current online statuses for all support staff in the caller's partner */
  getTeamStatus: protectedProcedure
    .query(async ({ ctx }) => {
      const partnerId = ctx.user.partnerId;
      if (!partnerId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No partner context' });
      }
      const onlineUsers = await presenceService.getOnlineUsersForPartner(partnerId);
      if (onlineUsers.length === 0) return [];
      // Batch-fetch isExternal for the team so the client can render GUEST
      // badges. One query for the whole team regardless of size — cheap, no
      // N+1 risk.
      const ids = onlineUsers.map((u) => u.userId);
      const flagRows = await db
        .select({ id: users.id, isExternal: users.isExternal })
        .from(users)
        .where(inArray(users.id, ids));
      const externalById = new Map(flagRows.map((r) => [r.id, !!r.isExternal]));
      return onlineUsers.map((u) => ({
        userId: u.userId,
        name: u.name,
        role: u.role,
        status: u.status,
        isExternal: externalById.get(u.userId) ?? false,
      }));
    }),

  /** Get daily time-in-status for a single agent (self or admin) */
  getAgentStats: protectedProcedure
    .input(z.object({
      userId: z.string(),
      fromDate: z.string(),
      toDate: z.string(),
    }))
    .query(async ({ input, ctx }) => {
      const partnerId = ctx.user.partnerId;
      if (!partnerId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No partner context' });
      }
      const isSelf = ctx.user.id === input.userId;
      const isAdmin = ctx.user.role === 'admin' || ctx.user.isPlatformOperator;
      if (!isSelf && !isAdmin) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized' });
      }
      return statusTracking.getAgentDailyStats(input.userId, partnerId, input.fromDate, input.toDate);
    }),

  /** Get daily time-in-status for all agents in partner (admin only) */
  getTeamStats: protectedProcedure
    .input(z.object({
      fromDate: z.string(),
      toDate: z.string(),
    }))
    .query(async ({ input, ctx }) => {
      const partnerId = ctx.user.partnerId;
      if (!partnerId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No partner context' });
      }
      if (ctx.user.role !== 'admin' && !ctx.user.isPlatformOperator) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access required' });
      }
      return statusTracking.getTeamDailyStats(partnerId, input.fromDate, input.toDate);
    }),
});
