import { initTRPC, TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { Context } from './context.js';
import { UserRole } from '../types/index.js';
import { isPlatformAdmin, isTenantAdmin } from '../services/roles.js';
import { DISABLED_FEATURES, type DisabledFeature } from '../constants.js';
import { db } from '../db.js';
import { users } from '../db/schema.js';

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

/**
 * Middleware that blocks all procedures for a disabled feature.
 * Usage: `partnerScopedProcedure.use(featureGate('featureName'))`
 *
 * Returns FORBIDDEN with a clear message when the feature is in DISABLED_FEATURES.
 * To re-enable, remove the feature name from DISABLED_FEATURES in constants.ts.
 */
export const featureGate = (feature: DisabledFeature) =>
  t.middleware(({ next }) => {
    if (DISABLED_FEATURES.includes(feature)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `Feature "${feature}" is not yet available`,
      });
    }
    return next();
  });

/**
 * Blocks Azure B2B guest users (`users.isExternal = true`) from destructive
 * admin mutations. Guests keep read access to admin panels but cannot touch
 * secrets, grant/revoke access, or mutate tenant structure.
 *
 * Platform operators always bypass: they are never marked as external by
 * definition (SSO callback only sets isExternal from Azure B2B claims, and
 * platform operators authenticate via our staff SSO path with `acct=member`).
 *
 * This middleware fetches `users.isExternal` from the DB on each call because
 * the JWT does not carry the flag — adding it would require rotation of all
 * existing tokens across 5 mint sites. The DB hit only fires on destructive
 * admin mutations, which are rare. Revisit if traffic patterns change.
 *
 * Applied via `destructiveAdminProcedure` for `adminProcedure`-based routers,
 * or composed manually for `partnerAdminProcedure`-based routers (e.g.
 * webhook router's `gatedPartnerAdmin`).
 *
 * See docs/superpowers/plans/2026-04-16-partner-sso-b2b-guest.md.
 */
export const blockExternalUsers = t.middleware(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  // Platform operators are never guests — skip the DB round-trip.
  if (isPlatformAdmin(ctx.user.isPlatformOperator)) {
    return next();
  }
  const row = await db
    .select({ isExternal: users.isExternal })
    .from(users)
    .where(eq(users.id, ctx.user.id))
    .limit(1);
  if (row[0]?.isExternal) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'This action is not available to external guest users.',
    });
  }
  return next();
});

/**
 * Admin procedure with external-guest block. Use for any admin mutation that
 * touches secrets, grants/revokes access, or mutates tenant structure.
 * Reads stay on the plain `adminProcedure`.
 */
export const destructiveAdminProcedure = adminProcedure.use(blockExternalUsers);
