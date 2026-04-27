/**
 * Lifecycle actor builders.
 *
 * Types come from the canonical `services/auth` module; this file owns only
 * the lifecycle-flavored builders. The `socketActor` here keeps its old
 * non-null signature so existing socket-handler callsites (slices #68–#70
 * migrate them to `services/auth.socketActor` proper) continue to compile.
 */
import type { Socket } from 'socket.io';
import type { Actor, SystemActor, UserActor } from '../auth/types.js';
import { isUserActor as isUserActorAuth } from '../auth/types.js';

/** The system identity used by background sweeps (reclaim, GDPR purge). */
export const systemActor: SystemActor = {
  kind: 'system',
  id: '__system__',
  name: 'System',
};

/**
 * Build a `UserActor` from a socket that has already been identified
 * (i.e., `requireIdentified(socket)` returned true). Pulls `userId`,
 * `partnerId`, role, and B2B-guest flag straight off `socket.data`.
 *
 * Slice 1 NOTE: this remains a non-null wrapper so slice-1 callers don't
 * need to add null checks. New code should call `socketActor` from
 * `services/auth` directly (returns `UserActor | null`). Slice #72 deletes
 * this file once all socket handlers have migrated.
 */
export function socketActor(socket: Socket): UserActor {
  return {
    kind: 'user',
    userId: socket.data.userId as string,
    name: (socket.data.name as string | undefined)
      ?? (socket.data.userName as string | undefined)
      ?? '',
    role: (socket.data.role as UserActor['role']) ?? 'agent',
    partnerId: socket.data.partnerId as string,
    isPlatformOperator: Boolean(
      socket.data.isPlatformOperator ?? socket.data.authedIsPlatformOperator
    ),
    isExternal: Boolean(socket.data.isExternal),
    lang: (socket.data.lang as string | undefined) ?? 'en',
  };
}

/** Type predicate convenience for callers that branch on actor kind. */
export function isUserActor(actor: Actor): actor is UserActor {
  return isUserActorAuth(actor);
}
