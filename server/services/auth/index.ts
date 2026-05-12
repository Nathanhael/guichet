export type {
  UserRole,
  UserActor,
  SystemActor,
  Actor,
} from './types.js';

export { SYSTEM_ACTOR, isUserActor } from './types.js';

export { actorFactory, trpcActor, socketActor } from './actor.js';

// Session lifecycle — folded into services/auth/ in Bundle A slice 7 (#72).
// JWT mint + cookie helpers, refresh-token rotation, and the Redis-backed
// session-revocation API all live here now. Importers should pull from this
// barrel rather than reaching for deep paths.
export {
  buildAuthResponse,
  buildAuthToken,
  setAuthCookie,
  clearAuthCookie,
  listUserMemberships,
  getEnterPartnerContext,
  parseExpiryToSeconds,
} from './authSession.js';
export type { SessionMembership } from './authSession.js';

export {
  createRefreshToken,
  rotateRefreshToken,
  revokeFamily,
  revokeAllUserRefreshTokens,
  cleanupExpiredTokens,
} from './refreshToken.js';

export {
  REVOCATION_CHANNEL,
  revokeToken,
  revokeUserSessions,
  isRevoked,
} from './sessionRevocation.js';
export type { RevocationEvent, RevocationPayload } from './sessionRevocation.js';
