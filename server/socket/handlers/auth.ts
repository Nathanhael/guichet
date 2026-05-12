import { Socket, Server } from 'socket.io';
import { jwtVerify } from 'jose';
import { parse as parseCookie } from 'cookie';
import config from '../../config.js';
import logger from '../../utils/logger.js';

import { Rooms } from '../../utils/rooms.js';
import { getRedisClients } from '../../utils/redis.js';
import { getAvailability } from '../../services/availability/index.js';
import { findUserById, findMembership } from '../../services/userQueries.js';
import { findActiveTicketsForAgent, findActiveTicketsForSupport } from '../../services/ticketQueries.js';
import { broadcastAgentStatus } from '../../services/businessHours.js';
import { canUseSupportWorkflows, isPlatformAdmin } from '../../services/roles.js';
import { isRevoked } from '../../services/auth/sessionRevocation.js';
import { UserRole } from '../../types/index.js';
import { type HandlerContext } from './types.js';

/**
 * Install a middleware that pre-joins partner/staff/user/ticket rooms using
 * the JWT-verified identity BEFORE `connect` resolves on the client.
 *
 * Without this, there is a race window between socket connect and the
 * client-emitted `socket:identify` round-trip during which broadcasts (e.g.
 * `ticket:created` fanned out to `Rooms.staff(partnerId)`) miss support
 * sockets that are connected but not yet in the staff room. The symptom is
 * "agent creates ticket, support doesn't see it until both refresh."
 *
 * Identity resolution here is intentionally minimal — just enough to decide
 * room membership. Full identity (name, presence, status restore) remains in
 * the `socket:identify` handler. Duplicate `socket.join` calls are no-ops, so
 * the two paths are idempotent.
 */
export function setupIdentityMiddleware(io: Server): void {
  io.use(async (socket, next) => {
    const userId = socket.data.authedUserId as string | undefined;
    const partnerId = socket.data.authedPartnerId as string | undefined;
    const isPlatformOp = !!socket.data.authedIsPlatformOperator;

    if (!userId || !partnerId) {
      // No partner context (e.g. platform operator pre-enter-partner) — skip
      // room pre-join; `socket:identify` handler will reject if identity is
      // truly missing.
      return next();
    }

    try {
      const membership = await findMembership(userId, partnerId);
      const effectiveRole: UserRole | null = membership
        ? (membership.role as UserRole)
        : (isPlatformAdmin(isPlatformOp) ? 'admin' : null);

      if (!effectiveRole) {
        // No membership and not a platform operator — let the identify
        // handler emit `auth:expired` and disconnect (familiar UX path).
        return next();
      }

      const isSupport = canUseSupportWorkflows(effectiveRole, isPlatformOp);

      socket.join(Rooms.partner(partnerId));
      socket.join(Rooms.user(userId));
      if (isSupport) socket.join(Rooms.staff(partnerId));

      let activeTickets: { id: string }[] = [];
      if (effectiveRole === 'agent') {
        activeTickets = await findActiveTicketsForAgent(userId, partnerId);
      } else if (isSupport) {
        activeTickets = await findActiveTicketsForSupport(userId, partnerId);
      }
      for (const t of activeTickets) socket.join(Rooms.ticket(t.id));

      logger.info({ socketId: socket.id, userId, partnerId, role: effectiveRole, isSupport, ticketRooms: activeTickets.length }, '[socket identity mw] rooms pre-joined');
      next();
    } catch (err) {
      // Non-fatal: degrade to identify-only behavior on DB errors.
      logger.error({ err: err instanceof Error ? err.message : String(err), socketId: socket.id }, '[socket identity mw] failed — falling back to socket:identify');
      next();
    }
  });
}

const jwtSecret = new TextEncoder().encode(config.JWT_SECRET);

/**
 * Subscribe to the Redis revocation channel and immediately disconnect
 * any socket whose token or user session has been revoked.
 * Called once by the orchestrator before accepting connections.
 */
export function setupRevocationPubSub(io: Server): void {
  // ── Redis Pub/Sub: instant session revocation ──────────────────────────────
  // When a token or user session is revoked, we receive the event here and
  // immediately disconnect all matching sockets. This eliminates the previous
  // 5-minute polling window (REVOCATION_CHECK_INTERVAL_MS).
  const { subClient } = getRedisClients();
  if (subClient) {
    import('../../services/auth/sessionRevocation.js').then(({ REVOCATION_CHANNEL }) => {
      subClient.subscribe(REVOCATION_CHANNEL, (message: string) => {
        try {
          const event = JSON.parse(message) as { type: string; jti?: string; userId?: string; revokedAfter?: number };
          const sockets = io.sockets.sockets;

          for (const [, socket] of sockets) {
            let shouldDisconnect = false;

            if (event.type === 'token' && event.jti && socket.data.jti === event.jti) {
              shouldDisconnect = true;
            }

            if (event.type === 'user' && event.userId && socket.data.userId === event.userId) {
              const iat = socket.data.iat as number | undefined;
              if (!iat || (event.revokedAfter && iat <= event.revokedAfter)) {
                shouldDisconnect = true;
              }
            }

            if (shouldDisconnect) {
              logger.info({ socketId: socket.id, userId: socket.data.userId, eventType: event.type }, '[socket] Instant revocation via Pub/Sub');
              socket.emit('auth:expired', { message: 'Session revoked — please re-authenticate' });
              socket.disconnect(true);
            }
          }
        } catch (err) {
          logger.error({ err: err instanceof Error ? err.message : String(err) }, '[socket] Failed to process revocation event');
        }
      });
      logger.info('[socket] Subscribed to session revocation channel');
    }).catch(err => {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, '[socket] Failed to subscribe to revocation channel');
    });
  }
}

/**
 * Install the Socket.io JWT authentication middleware.
 * Extracts the JWT from cookies (or handshake auth), verifies it,
 * checks revocation, and attaches verified identity to socket.data.
 * Called once by the orchestrator before accepting connections.
 */
export function setupJwtMiddleware(io: Server): void {
  // ---- Socket-level JWT authentication middleware ----
  io.use(async (socket, next) => {
    try {
      let token = socket.handshake.auth?.token as string | undefined;
      if (!token && socket.handshake.headers?.cookie) {
        const cookies = parseCookie(socket.handshake.headers.cookie);
        token = cookies['guichet_token'];
      }
      if (!token) {
        return next(new Error('Authentication required'));
      }

      const { payload: decoded } = await jwtVerify(token, jwtSecret, { algorithms: ['HS256'] }) as {
        payload: { userId: string; role: string; partnerId?: string; jti?: string; iat?: number; exp?: number; isPlatformOperator?: boolean };
      };

      const revoked = await isRevoked({ userId: decoded.userId, jti: decoded.jti, iat: decoded.iat });
      if (revoked) {
        return next(new Error('Session revoked'));
      }

      // Attach verified identity to socket data
      socket.data.authedUserId = decoded.userId;
      socket.data.authedPartnerId = decoded.partnerId; // H-8: store JWT partnerId for validation
      socket.data.authedIsPlatformOperator = !!decoded.isPlatformOperator;
      socket.data.tokenExp = decoded.exp; // seconds since epoch
      socket.data.jti = decoded.jti;
      socket.data.iat = decoded.iat;
      next();
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, '[socket] JWT auth failed');
      next(new Error('Invalid token'));
    }
  });
}

/**
 * Register the `socket:identify` handler on a newly connected socket.
 * This handler validates the client-supplied partner context against the JWT,
 * looks up the user/membership, joins the appropriate rooms, restores presence
 * and status, and re-joins active ticket rooms.
 */
export function register(socket: Socket, _ctx: HandlerContext): void {
  socket.on('socket:identify', async ({ userId: clientUserId, partnerId }: { userId?: string, role?: string, name?: string, partnerId: string }) => {
    // Use the verified identity from JWT middleware — never trust client-supplied userId
    const userId = socket.data.authedUserId as string;
    if (!userId) {
      socket.emit('error', { message: 'Not authenticated' });
      socket.disconnect();
      return;
    }

    // H-9: Warn when client session is stale — client thinks it's a different user than the JWT proves.
    // This happens when multiple users log in from the same browser (cookie overwrite).
    if (clientUserId && clientUserId !== userId) {
      logger.warn({ socketId: socket.id, jwtUserId: userId, clientUserId }, '[socket] userId mismatch — client session stale, JWT belongs to different user');
    }

    // H-8: Validate client-supplied partnerId against JWT's partnerId
    // Platform operators may enter any partner (their JWT partnerId changes on enter-partner),
    // but regular users must match exactly.
    const jwtPartnerId = socket.data.authedPartnerId as string | undefined;
    if (jwtPartnerId && partnerId !== jwtPartnerId) {
      logger.warn({ socketId: socket.id, userId, clientPartnerId: partnerId, jwtPartnerId }, '[socket] partnerId mismatch — client supplied different partnerId than JWT');
      socket.emit('error', { message: 'Partner context mismatch — please re-authenticate' });
      socket.disconnect();
      return;
    }

    try {
      const isPlatformOp = !!socket.data.authedIsPlatformOperator;

      // Look up the user's name from the DB (don't trust client-supplied name)
      const userRow = await findUserById(userId);
      if (!userRow) {
        // JWT references a deleted user (e.g. after DB reseed) — force client to log out
        logger.warn({ socketId: socket.id, userId }, '[socket] JWT user no longer exists — forcing re-auth');
        socket.emit('auth:expired', { message: 'Account no longer exists — please sign in again' });
        socket.disconnect();
        return;
      }
      const name = userRow.name || userId;

      // Validate that user has a membership for the requested partner
      const membership = await findMembership(userId, partnerId);
      let effectiveRole: UserRole;
      if (!membership) {
        // No membership — check if user is a platform operator
        if (!isPlatformAdmin(isPlatformOp)) {
          // JWT references a partner the user no longer belongs to (e.g. after reseed / membership removal)
          logger.warn({ socketId: socket.id, userId, partnerId }, '[socket] JWT partner membership missing — forcing re-auth');
          socket.emit('auth:expired', { message: 'Partner access revoked — please sign in again' });
          socket.disconnect();
          return;
        }
        effectiveRole = 'admin';
      } else {
        effectiveRole = membership.role as UserRole;
      }

      const isSupport = canUseSupportWorkflows(effectiveRole, isPlatformOp);

      // All async lookups succeeded — assign socket.data atomically
      socket.data.userId = userId;
      socket.data.role = effectiveRole;
      socket.data.name = name;
      socket.data.partnerId = partnerId;
      socket.data.isSupport = isSupport;
      socket.data.lang = userRow.lang || 'en';
      // Surface isPlatformOperator on socket.data alongside the other identity
      // fields so socketActor() (services/auth) can read it without falling back
      // to the handshake-only `authedIsPlatformOperator` key.
      socket.data.isPlatformOperator =
        effectiveRole === 'platform_operator' || socket.data.authedIsPlatformOperator === true;
      socket.data.identified = true;

      const availability = getAvailability();

      // availability.socket.attach: SADD socket id, upsertIdentity (preserves status on reconnect),
      // clear offlineAt, open transition-log row on first connect, broadcast support:online (if support)
      // or agents:online (if agent). Replaces legacy presenceService.identifyUser + statusTracking.logTransition.
      await availability.socket.attach({
        userId,
        partnerId,
        socketId: socket.id,
        role: effectiveRole,
        name,
        isPlatformOperator: isPlatformOp,
      });

      // Join partner-wide room (broadcasts handled by socket.attach above for support/agent).
      socket.join(Rooms.partner(partnerId));
      if (isSupport) socket.join(Rooms.staff(partnerId));
      socket.join(Rooms.user(userId));
      if (isPlatformOp) socket.join(Rooms.platformOperators());

      if (effectiveRole === 'agent') {
        // socket.attach already emitted agents:online to the staff room — no second broadcast needed.
        // broadcastAgentStatus is the businessHours module's separate signal, kept as-is.
        broadcastAgentStatus(userId, true);
      }

      // Restore persisted status to the client (status:restored event) — only emit if non-default.
      if (isSupport) {
        const persistedStatus = await availability.advanced.getStatus(userId, partnerId);
        if (persistedStatus && persistedStatus !== 'online') {
          socket.emit('status:restored', { status: persistedStatus });
        }
      }

      // Re-join active ticket rooms
      try {
        let activeTickets: { id: string }[] = [];
        if (effectiveRole === 'agent') {
          activeTickets = await findActiveTicketsForAgent(userId, partnerId);
        } else if (isSupport) {
          activeTickets = await findActiveTicketsForSupport(userId, partnerId);
        }
        for (const t of activeTickets) socket.join(Rooms.ticket(t.id));
      } catch (err: unknown) { logger.error({ err: err instanceof Error ? err.message : String(err) }, '[socket:identify] failed to rejoin ticket rooms'); }
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err), socketId: socket.id }, '[socket] identify failed');
      socket.emit('error', { message: 'Identification failed' });
      socket.disconnect();
    }
  });
}
