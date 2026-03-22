import { initTRPC, TRPCError } from '@trpc/server';
import { Context } from './context.js';
import { UserRole } from '../types/index.js';

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
export const platformProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!ctx.user.isPlatformOperator) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Platform Operator role required' });
  }
  return next();
});

// Middleware for admin users (Partner Admins)
export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== 'admin' && !ctx.user.isPlatformOperator) {
    throw new TRPCError({ code: 'FORBIDDEN' });
  }
  return next();
});

// Helper for dynamic role checks
export const roleProcedure = (roles: UserRole[]) => 
  protectedProcedure.use(({ ctx, next }) => {
    // Platform operators can bypass role checks to manage data across any partner
    if (!roles.includes(ctx.user.role) && !ctx.user.isPlatformOperator) {
      throw new TRPCError({ code: 'FORBIDDEN' });
    }
    return next();
  });
