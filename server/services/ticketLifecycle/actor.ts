/**
 * Actor builders. Each transport surface gets its own helper; the lifecycle
 * module sees only the resulting `Actor` value.
 */
import type { Socket } from 'socket.io';
import type { Actor, SystemActor, UserActor } from './types.js';

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
 */
export function socketActor(socket: Socket): UserActor {
  const role = (socket.data.role as UserActor['role']) ?? 'agent';
  return {
    kind: 'user',
    id: socket.data.userId as string,
    name: (socket.data.userName as string | undefined) ?? '',
    role,
    isSupport: role === 'support' || role === 'admin' || role === 'platform_operator',
    isExternal: !!socket.data.isExternal,
    lang: (socket.data.lang as string | undefined) ?? 'en',
    partnerId: socket.data.partnerId as string,
  };
}

/** Type predicate convenience for callers that branch on actor kind. */
export function isUserActor(actor: Actor): actor is UserActor {
  return actor.kind === 'user';
}
