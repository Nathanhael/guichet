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
 * **Convention:** procedure factories (`partnerScopedProcedure`,
 * `partnerAdminProcedure`, `roleProcedure`, etc.) own role-level gating and
 * partnerId narrowing. Inside a handler body, `trpcActor(ctx)` is for
 *   (a) re-narrowing `ctx.user.partnerId` to non-null on a typed object, and
 *   (b) inline capability enforcement when the gate varies per-handler — e.g.
 *       the B2B-guest block on destructive admin actions, expressed as
 *       `trpcActor(ctx, { capability: 'destructive_admin' })`.
 *
 * Bundle A slice 6 (issue #71) deleted the `blockExternalUsers` middleware
 * and its three procedure-factory wrappers; the gate moved into the
 * `destructive_admin` capability rule in `services/auth/capabilities.ts`.
 * Use `trpcActor(ctx, { capability })` rather than re-introducing a
 * middleware indirection.
 *
 * Throws TRPCError on missing auth, missing partner scope, or capability
 * denial. `name` and `lang` are not on the JWT today — actor falls back to
 * `''` / `'en'`. Tighten when those fields arrive on the claim.
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
    isExternal: ctx.user.isExternal,
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
