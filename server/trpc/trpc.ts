import { initTRPC, TRPCError } from '@trpc/server';
import { Context } from './context.js';
import { UserRole } from '../types/index.js';
import { isPlatformAdmin, isTenantAdmin } from '../services/roles.js';
import { DISABLED_FEATURES, type DisabledFeature } from '../constants.js';

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
 * Reads the `isExternal` flag from the JWT claim on `ctx.user`. The claim is
 * stamped at every mint site (slice #66) and refreshed atomically with any
 * DB-side flag flip via `flipIsExternal` (slice #67), which revokes every
 * pre-flip session + refresh-token family — so no stale-token path can use a
 * pre-flip claim to evade the gate. No DB lookup needed.
 *
 * Applied via `destructiveAdminProcedure` for `adminProcedure`-based routers,
 * or composed manually for `partnerAdminProcedure`-based routers (e.g.
 * webhook router's `gatedPartnerAdmin`).
 */
export const blockExternalUsers = t.middleware(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  // Platform operators are never guests by definition.
  if (isPlatformAdmin(ctx.user.isPlatformOperator)) {
    return next();
  }
  if (ctx.user.isExternal) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'This action is not available to external guest users.',
    });
  }
  return next();
});

/**
 * Admin procedure with external-guest block. Three-way dichotomy for admin
 * routes against B2B guests:
 *
 * - `destructiveAdminProcedure` — admin **mutations** a guest may not perform
 *   (secrets, grant/revoke access, tenant-structure changes).
 * - `internalAdminReadProcedure` — admin **reads** that expose internal-only
 *   PII a guest may not see (e.g. the internal admin roster).
 * - Plain `adminProcedure` — admin reads safe for guests (the default; covers
 *   the majority of routes).
 *
 * Both gated procedures share the `blockExternalUsers` middleware. Operator
 * bypass is handled inside the middleware.
 */
export const destructiveAdminProcedure = adminProcedure.use(blockExternalUsers);

/**
 * Admin read procedure that hides internal-only PII from B2B guest viewers.
 * Use for any admin **read** endpoint whose result set would leak the identity
 * or contact details of internal staff to a guest partner organization.
 *
 * Sibling of `destructiveAdminProcedure`; same `blockExternalUsers` gate,
 * different intent: this one protects what guests *see*, not what they *do*.
 */
export const internalAdminReadProcedure = adminProcedure.use(blockExternalUsers);

/**
 * Partner-scoped variant of `internalAdminReadProcedure`. Use when the
 * endpoint needs both the guest gate AND a guaranteed non-null `partnerId`
 * in `ctx.user.partnerId` (i.e. partner-scoped reads that leak internal
 * staff identity — e.g. audit-log queries that join on `users.name`).
 */
export const partnerInternalAdminReadProcedure = partnerAdminProcedure.use(blockExternalUsers);
