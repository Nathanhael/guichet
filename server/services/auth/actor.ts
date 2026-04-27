import { TRPCError } from '@trpc/server';
import type { Context } from '../../trpc/context.js';
import type { Capability, UserActor, UserRole } from './types.js';
import { can } from './capabilities.js';

export function actorFactory(
  overrides: Partial<Omit<UserActor, 'kind'>> & { userId: string }
): UserActor {
  return {
    kind: 'user',
    userId: overrides.userId,
    name: overrides.name ?? 'Test User',
    role: overrides.role ?? 'agent',
    partnerId: overrides.partnerId ?? 'p-test',
    isPlatformOperator: overrides.isPlatformOperator ?? false,
    isExternal: overrides.isExternal ?? false,
    lang: overrides.lang ?? 'en',
  };
}

/**
 * Narrow a tRPC Context into a typed UserActor.
 *
 * Throws TRPCError if the context lacks an authenticated user, partner scope,
 * or fails the optional capability gate. Procedure factories
 * (`partnerScopedProcedure`, etc.) already gate access-level role; trpcActor
 * inside handler bodies is for type narrowing and inline capability checks.
 *
 * NOTE: ctx.user does not currently carry `name` or `lang` (JWT does not
 * include them). Slice 1 falls back to '' / 'en'; tighten in slice #71 when
 * tRPC handlers begin consuming actor.name.
 */
export function trpcActor(ctx: Context, opts?: { capability?: Capability }): UserActor {
  if (!ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Not authenticated' });
  }
  if (!ctx.user.partnerId) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Partner context required',
    });
  }
  const userLike = ctx.user as { name?: string; lang?: string };
  const actor: UserActor = {
    kind: 'user',
    userId: ctx.user.id,
    name: userLike.name ?? '',
    role: ctx.user.role as UserRole,
    partnerId: ctx.user.partnerId,
    isPlatformOperator: ctx.user.isPlatformOperator,
    isExternal: ctx.user.isExternal ?? false,
    lang: userLike.lang ?? 'en',
  };
  if (opts?.capability && !can(actor, opts.capability)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `Missing capability: ${opts.capability}`,
    });
  }
  return actor;
}
