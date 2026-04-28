import { TRPCError } from '@trpc/server';
import type { Socket } from 'socket.io';
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

/**
 * Build a UserActor from an authenticated, identified Socket.io socket.
 *
 * Returns null and emits a `socket.emit('error', ...)` when the socket is
 * not identified, lacks partner scope, or fails the optional capability gate.
 * Callers should `if (!actor) return;` immediately.
 *
 * Reads `socket.data` fields populated by `setupJwtMiddleware` (handshake)
 * and the `socket:identify` handler. `isExternal` comes from the JWT at
 * handshake; the identify handler must NOT clobber it.
 */
export function socketActor(socket: Socket, opts?: { capability?: Capability }): UserActor | null {
  const data = socket.data as Record<string, unknown>;
  if (!data.identified) {
    socket.emit('error', { message: 'Not identified' });
    return null;
  }

  const userId = data.userId as string | undefined;
  const role = data.role as UserRole | undefined;
  const partnerId = data.partnerId as string | undefined;
  const name = (data.name as string | undefined) ?? '';
  const lang = (data.lang as string | undefined) ?? 'en';
  const isPlatformOperator = Boolean(data.isPlatformOperator);
  const isExternal = Boolean(data.isExternal);

  if (!userId || !role || !partnerId) {
    socket.emit('error', { message: 'Partner scope required' });
    return null;
  }

  const actor: UserActor = {
    kind: 'user',
    userId,
    name,
    role,
    partnerId,
    isPlatformOperator,
    isExternal,
    lang,
  };

  if (opts?.capability && !can(actor, opts.capability)) {
    socket.emit('error', { message: `Missing capability: ${opts.capability}` });
    return null;
  }

  return actor;
}
