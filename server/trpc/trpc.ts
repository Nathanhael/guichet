import { initTRPC, TRPCError } from '@trpc/server';
import { Context } from './context.js';
import { UserRole } from '../types/index.js';
import { isPlatformAdmin, isTenantAdmin } from '../services/roles.js';
import { isPlatformStepUpSatisfied } from '../services/platformStepUp.js';

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

// Middleware for authenticated users
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  return next({
    ctx: {
      user: ctx.user,
    },
  });
});

// Middleware for Platform Operators (Developers)
export const platformBaseProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!isPlatformAdmin(ctx.user.isPlatformOperator)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Platform Operator role required' });
  }
  return next();
});

export const platformProcedure = platformBaseProcedure.use(({ ctx, next }) => {
  if (!isPlatformStepUpSatisfied(ctx.user.platformStepUpAt)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Platform step-up required' });
  }
  return next();
});

// Middleware for admin users (Partner Admins)
export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!isTenantAdmin(ctx.user.role) && !isPlatformAdmin(ctx.user.isPlatformOperator)) {
    throw new TRPCError({ code: 'FORBIDDEN' });
  }
  return next();
});

// Helper for dynamic role checks
export const roleProcedure = (roles: UserRole[]) => 
  protectedProcedure.use(({ ctx, next }) => {
    // Platform operators can bypass role checks to manage data across any partner
    if (!roles.includes(ctx.user.role) && !isPlatformAdmin(ctx.user.isPlatformOperator)) {
      throw new TRPCError({ code: 'FORBIDDEN' });
    }
    return next();
  });
