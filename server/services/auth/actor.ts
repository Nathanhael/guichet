import { TRPCError } from '@trpc/server';
import type { Socket } from 'socket.io';
import type { Context } from '../../trpc/context.js';
import type { UserActor, UserRole } from './types.js';

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
    lang: overrides.lang ?? 'en',
  };
}

/**
 * Narrow a tRPC Context into a typed UserActor.
 *
 * Procedure factories (`partnerScopedProcedure`, `partnerAdminProcedure`,
 * `roleProcedure`, etc.) own role-level gating and partnerId narrowing.
 * Inside a handler body, `trpcActor(ctx)` is for re-narrowing
 * `ctx.user.partnerId` to non-null on a typed object.
 *
 * Throws TRPCError on missing auth or missing partner scope. `name` and
 * `lang` are not on the JWT today — actor falls back to `''` / `'en'`.
 * Tighten when those fields arrive on the claim.
 */
export function trpcActor(ctx: Context): UserActor {
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
  return {
    kind: 'user',
    userId: ctx.user.id,
    name: userLike.name ?? '',
    role: ctx.user.role as UserRole,
    partnerId: ctx.user.partnerId,
    isPlatformOperator: ctx.user.isPlatformOperator,
    lang: userLike.lang ?? 'en',
  };
}

/**
 * Build a UserActor from an authenticated, identified Socket.io socket.
 *
 * Returns null and emits a `socket.emit('error', ...)` when the socket is
 * not identified or lacks partner scope. Callers should `if (!actor) return;`
 * immediately.
 *
 * Reads `socket.data` fields populated by `setupJwtMiddleware` (handshake)
 * and the `socket:identify` handler.
 */
export function socketActor(socket: Socket): UserActor | null {
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

  if (!userId || !role || !partnerId) {
    socket.emit('error', { message: 'Partner scope required' });
    return null;
  }

  return {
    kind: 'user',
    userId,
    name,
    role,
    partnerId,
    isPlatformOperator,
    lang,
  };
}
