import { initTRPC, TRPCError } from '@trpc/server';
import { Context } from './context.js';
import { UserRole } from '../types/index.js';
import { isPlatformAdmin, isTenantAdmin } from '../services/roles.js';

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

export const platformProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!isPlatformAdmin(ctx.user.isPlatformOperator)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Platform Operator role required' });
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

// Middleware that requires an active partner context.
// Narrows ctx.user.partnerId to string (non-null).
// Use for any procedure that needs partner-scoped data.
export const partnerScopedProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!ctx.user.partnerId) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'No active partner context' });
  }
  return next({
    ctx: {
      user: { ...ctx.user, partnerId: ctx.user.partnerId },
    },
  });
});

// Partner-scoped + admin role required
export const partnerAdminProcedure = partnerScopedProcedure.use(({ ctx, next }) => {
  if (!isTenantAdmin(ctx.user.role) && !isPlatformAdmin(ctx.user.isPlatformOperator)) {
    throw new TRPCError({ code: 'FORBIDDEN' });
  }
  return next();
});

/**
 * Dynamic role check on `protectedProcedure` (no partner guarantee).
 * Use when the endpoint does NOT need a guaranteed `partnerId` (e.g. platform-level listings).
 * For partner-scoped endpoints that also need a role gate, use `partnerRoleProcedure` instead.
 */
export const roleProcedure = (roles: UserRole[]) =>
  protectedProcedure.use(({ ctx, next }) => {
    // Platform operators can bypass role checks to manage data across any partner
    if (!roles.includes(ctx.user.role) && !isPlatformAdmin(ctx.user.isPlatformOperator)) {
      throw new TRPCError({ code: 'FORBIDDEN' });
    }
    return next();
  });

/**
 * Dynamic role check on `partnerScopedProcedure` (guarantees `partnerId` is set).
 * Use for any partner-scoped endpoint that needs both a role gate AND a guaranteed
 * non-null `partnerId`. This eliminates the need for manual `ctx.user.partnerId`
 * guards in every consumer, preventing cross-tenant data leaks.
 *
 * Prefer this over `roleProcedure` for all tenant-scoped mutations and queries.
 */
export const partnerRoleProcedure = (roles: UserRole[]) =>
  partnerScopedProcedure.use(({ ctx, next }) => {
    // Platform operators can bypass role checks to manage data across any partner
    if (!roles.includes(ctx.user.role) && !isPlatformAdmin(ctx.user.isPlatformOperator)) {
      throw new TRPCError({ code: 'FORBIDDEN' });
    }
    return next();
  });

