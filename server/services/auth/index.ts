import { db } from '../../db.js';
import { revokeUserSessions } from './sessionRevocation.js';
import { createFlipIsExternal } from './isExternalFlip.js';

export type {
  UserRole,
  Capability,
  UserActor,
  SystemActor,
  Actor,
} from './types.js';

export { SYSTEM_ACTOR, isUserActor } from './types.js';

export { RULES, can, assertCan, CapabilityDeniedError } from './capabilities.js';

export { actorFactory, trpcActor, socketActor } from './actor.js';

export type { FlipDeps, FlipResult } from './isExternalFlip.js';
export { createFlipIsExternal } from './isExternalFlip.js';

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

/**
 * Production-bound `flipIsExternal`. Closes the staleness window when a
 * user's Azure B2B-guest status changes: writes the new flag value + an
 * `auth.session_revoked` audit row in one transaction, then fires the
 * Redis-backed revocation cascade (which itself cascades to the user's
 * refresh-token families). No-op when the value is already current.
 *
 * Callers: `server/routes/sso.ts` invite-claim and re-attestation paths.
 */
export const flipIsExternal = createFlipIsExternal({ db, revokeUserSessions });
