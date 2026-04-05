import { Server, Socket } from 'socket.io';
import { jwtVerify } from 'jose';
import { parse as parseCookie } from 'cookie';
import * as presenceService from '../services/presence.js';
import {
  findTicketForJoin,
  findTicketForClose,
  findTicketOwner,
  findTicketParticipants,
  findTicketForMessage,
  findRecentClosedTickets,
  findActiveTicketsForAgent,
  findActiveTicketsForSupport,
  findTicketForTransfer,
  findPartnerLabels,
  createTicket,
  assignSupport,
  findUpdatedParticipants,
  updateParticipants,
  closeTicket,
  updateTicketSla,
  returnTicketToQueue,
  replaceTicketLabels,
  insertRating,
} from '../services/ticketQueries.js';
import { getBusinessHoursStatus, broadcastQueuePositions, broadcastAgentStatus, BusinessHoursSchedule } from '../services/businessHours.js';
import logger from '../utils/logger.js';
import config from '../config.js';
import { Ticket, UserRole } from '../types/index.js';
import { socketioConnectionsActive, socketioEventsTotal } from '../utils/metrics.js';
import { isValidMediaUrl } from '../utils/security.js';
import { mapMessageRow } from '../utils/messageMapper.js';
import { requirePartnerScope, requirePartnerScopeWith } from './partnerScope.js';
import { canUseSupportWorkflows, isPlatformAdmin } from '../services/roles.js';
import { findPartnerConfig } from '../services/partnerQueries.js';
import { findUserById, findMembership, findSenderInfo, findUserName } from '../services/userQueries.js';
import {
  insertMessage,
  findTicketMessagesPaginated,
  findTicketLabelIds,
  findMessageForEdit,
  findMessageForDelete,
  updateMessageText,
  softDeleteMessage,
  markDelivered,
  markRead,
  type SocketMessage,
} from '../services/messageQueries.js';
import { isRevoked } from '../services/sessionRevocation.js';
import { runSyncGuards, guardRepetition } from '../services/guards.js';
import * as statusTracking from '../services/statusTracking.js';
import { getRedisClients } from '../utils/redis.js';
import { invalidateSummary, autoSummarizeOnClose, scoreSentiment } from '../services/ai/index.js';
import { parseSlaConfig, getEffectiveSla, calculateSlaDueDate } from '../services/sla.js';
import { Rooms } from '../utils/rooms.js';
import { insertSystemMessage, insertWhisperMessage } from '../services/systemMessage.js';
import { findPartnerDepartments, transferTicketToDepartment } from '../services/transferService.js';
import { sendPush } from '../services/pushNotification.js';
import {
  VIEWER_TTL_SECONDS,
  MAX_BATCH_DELETE,
  MAX_MESSAGE_LENGTH,
  MAX_EDIT_WINDOW_MS,
  MAX_LABELS_PER_TICKET,
  MAX_NOTE_LENGTH,
  RECENT_CLOSED_TICKETS_LIMIT,
} from '../constants.js';

const jwtSecret = new TextEncoder().encode(config.JWT_SECRET);

interface TicketNewPayload {
  agentId?: string; // Deprecated — server uses socket.data.userId instead
  agentLang: string;
  dept: string;
  references?: Array<{ label: string; value: string }>;
  text?: string;
  mediaUrl?: string;
}

interface SupportJoinPayload {
  ticketId: string;
  supportLang: string;
}

interface SupportLeavePayload {
  ticketId: string;
  supportId: string;
  supportName: string;
}

interface TicketClosePayload {
  ticketId: string;
  closedBy?: string;
  closingNotes?: string;
}

interface MessageSendPayload {
  ticketId: string;
  senderId: string;
  text: string;
  mediaUrl?: string;
  whisper?: boolean;
}

interface Participant {
  id: string;
  name: string;
}

interface SenderInfo {
  name: string;
  role: string;
  lang: string;
}


let ioInstance: Server | null = null;

// ── HI-07 fix: Collision Detection via Redis ────────────────────────────────
// Viewer tracking now uses Redis Hashes so it works across multiple server instances.
// Key: `ticket:viewers:{ticketId}` → Hash { socketId: JSON({ userId, userName }) }
// Each entry has a 5-minute TTL refreshed on activity; stale viewers auto-expire.

const VIEWER_KEY_PREFIX = 'ticket:viewers:';

// Local index: socketId → Set<ticketId> — for efficient cleanup on disconnect
const socketTickets = new Map<string, Set<string>>();

async function addViewer(ticketId: string, socketId: string, userId: string, userName: string) {
  try {
    const { pubClient } = getRedisClients();
    if (!pubClient) return;
    const key = `${VIEWER_KEY_PREFIX}${ticketId}`;
    await pubClient.hSet(key, socketId, JSON.stringify({ userId, userName }));
    await pubClient.expire(key, VIEWER_TTL_SECONDS);
    // Track locally for disconnect cleanup
    if (!socketTickets.has(socketId)) socketTickets.set(socketId, new Set());
    socketTickets.get(socketId)!.add(ticketId);
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, '[collision] Redis addViewer error');
  }
}

async function removeViewer(ticketId: string, socketId: string) {
  try {
    const { pubClient } = getRedisClients();
    if (!pubClient) return;
    await pubClient.hDel(`${VIEWER_KEY_PREFIX}${ticketId}`, socketId);
    socketTickets.get(socketId)?.delete(ticketId);
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, '[collision] Redis removeViewer error');
  }
}

async function removeViewerFromAll(socketId: string): Promise<string[]> {
  const tickets = socketTickets.get(socketId);
  if (!tickets || tickets.size === 0) {
    socketTickets.delete(socketId);
    return [];
  }
  const affectedTickets = Array.from(tickets);
  try {
    const { pubClient } = getRedisClients();
    if (!pubClient) return affectedTickets;
    const pipeline = pubClient.multi();
    for (const ticketId of affectedTickets) {
      pipeline.hDel(`${VIEWER_KEY_PREFIX}${ticketId}`, socketId);
    }
    await pipeline.exec();
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, '[collision] Redis removeViewerFromAll error');
  }
  socketTickets.delete(socketId);
  return affectedTickets;
}

async function getViewers(ticketId: string): Promise<Array<{ userId: string; userName: string }>> {
  try {
    const { pubClient } = getRedisClients();
    if (!pubClient) return [];
    const entries = await pubClient.hGetAll(`${VIEWER_KEY_PREFIX}${ticketId}`);
    // Deduplicate by userId (same user may have multiple sockets)
    const seen = new Map<string, { userId: string; userName: string }>();
    for (const val of Object.values(entries)) {
      try {
        const entry = JSON.parse(val) as { userId: string; userName: string };
        if (!seen.has(entry.userId)) {
          seen.set(entry.userId, entry);
        }
      } catch { /* skip malformed entries */ }
    }
    return Array.from(seen.values());
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, '[collision] Redis getViewers error');
    return [];
  }
}

async function broadcastViewers(io: Server, ticketId: string) {
  const viewers = await getViewers(ticketId);
  io.to(Rooms.ticket(ticketId)).emit('ticket:viewers', { ticketId, viewers });
}

export function broadcastPartnerDeactivation(partnerId: string) {
  if (ioInstance) {
    ioInstance.to(Rooms.partner(partnerId)).emit('partner:deactivated', { partnerId });
  }
}

export function broadcastUserDeactivation(userId: string) {
  if (ioInstance) {
    logger.info({ userId }, '[socket] Broadcasting user deactivation kill switch');
    ioInstance.to(Rooms.user(userId)).emit('user:deactivated', { userId });
  }
}

/** Guard: check if the JWT has expired since the handshake */
function isTokenExpired(socket: Socket): boolean {
  const exp = socket.data.tokenExp as number | undefined;
  if (!exp) return true;
  return Math.floor(Date.now() / 1000) >= exp;
}

/** Interval (ms) between periodic revocation checks on active sockets */
const REVOCATION_CHECK_INTERVAL_MS = 60 * 1000; // 60 seconds (safety net — primary revocation is via Pub/Sub)

/** Guard: require socket to be identified before processing events */
function requireIdentified(socket: Socket): boolean {
  if (isTokenExpired(socket)) {
    logger.info({ socketId: socket.id, userId: socket.data.userId }, '[socket] Token expired, disconnecting');
    socket.emit('auth:expired', { message: 'Token expired — please re-authenticate' });
    socket.disconnect(true);
    return false;
  }
  if (!socket.data.userId || !socket.data.partnerId) {
    socket.emit('error', { message: 'Not authenticated — call socket:identify first' });
    return false;
  }

  // Periodic revocation check — safety net fallback (runs at most once every 60s).
  // PRIMARY revocation is handled by the Redis Pub/Sub subscriber in
  // registerSocketHandlers() which disconnects revoked sockets within milliseconds.
  // This periodic check exists as a fallback in case a Pub/Sub message is missed.
  // NOTE: The check is fire-and-forget — the event that triggers it still completes
  // even if revocation is detected. The revoked socket is disconnected asynchronously,
  // so one additional event may execute.
  const now = Date.now();
  const lastCheck = (socket.data.lastRevocationCheck as number) || 0;
  if (now - lastCheck > REVOCATION_CHECK_INTERVAL_MS) {
    socket.data.lastRevocationCheck = now;
    // Fire-and-forget: check revocation asynchronously. If revoked, disconnect.
    isRevoked({
      userId: socket.data.userId as string,
      jti: socket.data.jti as string | undefined,
      iat: socket.data.iat as number | undefined,
    }).then((revoked) => {
      if (revoked) {
        logger.info({ socketId: socket.id, userId: socket.data.userId }, '[socket] Session revoked, disconnecting');
        socket.emit('auth:expired', { message: 'Session revoked — please re-authenticate' });
        socket.disconnect(true);
      }
    }).catch(() => {
      // If Redis is down, isRevoked fails closed — disconnect to be safe
      socket.emit('auth:expired', { message: 'Session verification failed — please re-authenticate' });
      socket.disconnect(true);
    });
  }

  return true;
}

export function registerSocketHandlers(io: Server) {
  ioInstance = io;

  // ── Redis Pub/Sub: instant session revocation ──────────────────────────────
  // When a token or user session is revoked, we receive the event here and
  // immediately disconnect all matching sockets. This eliminates the previous
  // 5-minute polling window (REVOCATION_CHECK_INTERVAL_MS).
  const { subClient } = getRedisClients();
  if (subClient) {
    import('../services/sessionRevocation.js').then(({ REVOCATION_CHANNEL }) => {
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

  // ---- Socket-level JWT authentication middleware ----
  io.use(async (socket, next) => {
    try {
      let token = socket.handshake.auth?.token as string | undefined;
      if (!token && socket.handshake.headers?.cookie) {
        const cookies = parseCookie(socket.handshake.headers.cookie);
        token = cookies['tessera_token'];
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

  io.on('connection', (socket: Socket) => {
    logger.info({ socketId: socket.id }, '[socket] connected');
    socketioConnectionsActive.inc();

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
          socket.emit('error', { message: 'User not found' });
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
            socket.emit('error', { message: 'Not authorized for this partner' });
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
        socket.data.identified = true;

        await presenceService.identifyUser(userId, effectiveRole, name, partnerId, isPlatformOp);

        // Join partner-wide room (for events all users need: partner:deactivated, hours:closed, etc.)
        socket.join(Rooms.partner(partnerId));

        // Staff (support/admin/platform) get a separate room for ticket-level broadcasts.
        // Agents must NOT receive other users' ticket data — they only see their own via ticket:created:self.
        if (isSupport) {
          socket.join(Rooms.staff(partnerId));
          await presenceService.broadcastOnlineSupport(partnerId);
        }

        // Join private user room for individual kill switches
        socket.join(Rooms.user(userId));

        if (effectiveRole === 'agent') {
          broadcastAgentStatus(userId, true);
        }

        // Restore persisted status to client and open status tracking row
        if (isSupport) {
          const persistedStatus = await presenceService.getUserStatus(userId, partnerId);
          await statusTracking.logTransition(userId, partnerId, persistedStatus || 'online');
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

    socket.on('ticket:new', async (data: TicketNewPayload) => {
      if (!requireIdentified(socket)) return;
      if (socket.data.role !== 'agent') return socket.emit('error', { message: 'Only agents can create tickets' });
      socketioEventsTotal.inc({ event: 'ticket:new' });

      try {
        const partnerId = socket.data.partnerId;
        const partnerRow = partnerId ? await findPartnerConfig(partnerId) : null;

        if (partnerRow && partnerRow.status !== 'active') {
          return socket.emit('error', { message: 'Partner is currently inactive.' });
        }

        const partnerHours = partnerRow ? {
          businessHoursSchedule: partnerRow.businessHoursSchedule as BusinessHoursSchedule | null,
          businessHoursStart: partnerRow.businessHoursStart,
          businessHoursEnd: partnerRow.businessHoursEnd,
          businessHoursTimezone: partnerRow.businessHoursTimezone,
        } : undefined;

        const businessHoursStatus = getBusinessHoursStatus(partnerHours);
        if (!businessHoursStatus.isOpen) {
          return socket.emit('hours:closed', {
            code: 'BUSINESS_HOURS_CLOSED',
            message: businessHoursStatus.message,
            status: businessHoursStatus,
          });
        }

        const { agentLang, dept, references = [], text, mediaUrl } = data;
        const agentId = socket.data.userId; // Server-side identity — never trust client-supplied agentId
        if (!agentId || !agentLang || !dept) return socket.emit('error', { message: 'Missing required fields' });
        if (!partnerId) return socket.emit('error', { message: 'No partner context' });
        if (mediaUrl && !isValidMediaUrl(mediaUrl)) return socket.emit('error', { message: 'Invalid media URL' });

        // Re-open detection — JS-side exact value match
        let reopened = false;
        let reopenCount = 0;
        const incomingValues = (references || []).map(r => r.value).filter(Boolean);
        if (incomingValues.length > 0) {
          const recentClosed = await findRecentClosedTickets(partnerId, RECENT_CLOSED_TICKETS_LIMIT);
          const match = recentClosed.find(t => {
            try {
              const raw = typeof t.references === 'string' ? JSON.parse(t.references) : t.references;
              const ticketRefs: Array<{ label: string; value: string }> = Array.isArray(raw) ? raw : [];
              return ticketRefs.some(r => incomingValues.includes(r.value));
            } catch { return false; }
          });
          if (match) {
            reopened = true;
            reopenCount = (match.reopenCount || 0) + 1;
          }
        }

        const agentUser = await findUserName(agentId);
        const ticket: Ticket = { id: crypto.randomUUID(), dept, agentId, agentName: agentUser?.name || agentId, agentLang, references, status: 'open', supportId: null, createdAt: new Date().toISOString(), participants: '[]' };
        await createTicket({ id: ticket.id, partnerId, dept: ticket.dept, agentId: ticket.agentId, agentName: ticket.agentName, agentLang: ticket.agentLang, references, status: ticket.status, createdAt: ticket.createdAt, participants: [], reopened, reopenCount });

        let message: SocketMessage | null = null;
        if (text?.trim()) {
          message = await insertMessage({
            ticketId: ticket.id,
            senderId: agentId,
            senderName: agentUser?.name || agentId,
            senderRole: 'agent',
            senderLang: agentLang,
            text: text,
            mediaUrl: mediaUrl,
          });
        }
        // Calculate SLA due dates based on partner config (respects business hours if enabled)
        const slaConfig = parseSlaConfig(partnerRow?.slaConfig);
        const sla = getEffectiveSla(slaConfig, dept);
        const createdDate = new Date(ticket.createdAt);
        const slaOpts = {
          businessHoursOnly: slaConfig?.businessHoursOnly,
          partnerHours: partnerHours,
        };
        const slaResponseDueAt = calculateSlaDueDate(createdDate, sla.responseMs, slaOpts).toISOString();
        const slaResolutionDueAt = calculateSlaDueDate(createdDate, sla.resolutionMs, slaOpts).toISOString();
        await updateTicketSla(ticket.id, slaResponseDueAt, slaResolutionDueAt);
        const ticketWithSla = { ...ticket, slaResponseDueAt, slaResolutionDueAt, slaBreached: false };

        socket.join(Rooms.ticket(ticket.id));
        socket.emit('ticket:created:self', { ticket: { ...ticketWithSla, participants: [], labels: [] }, message });
        // Broadcast to staff only — agents must not see other users' tickets (CR-04 socket-layer fix)
        io.to(Rooms.staff(partnerId)).emit('ticket:created', { ticket: { ...ticketWithSla, participants: [], labels: [] }, firstMessage: message });
        await broadcastQueuePositions(partnerId);
      } catch (err: unknown) {
        logger.error({ err: err instanceof Error ? err.message : String(err) }, '[ticket:new] error');
        socket.emit('error', { message: 'Failed to create ticket' });
      }
    });

    socket.on('support:join', async ({ ticketId, supportLang }: SupportJoinPayload) => {
      if (!requireIdentified(socket)) return;
      socketioEventsTotal.inc({ event: 'support:join' });
      try {
        // Use verified identity from socket.data — never trust client-supplied supportId/supportName
        const supportId = socket.data.userId;
        const supportName = socket.data.name;
        const callerPartnerId = socket.data.partnerId;

        // Authorization: only support/admin roles can join
        if (!socket.data.isSupport) {
          return socket.emit('error', { message: 'Not authorized to join tickets' });
        }

        const ticket = await requirePartnerScopeWith(socket, ticketId, findTicketForJoin);
        if (!ticket) return;

        // HI-01 fix: Prevent joining closed tickets — this would silently re-open them
        if (ticket.status === 'closed') {
          return socket.emit('error', { message: 'Cannot join a closed ticket' });
        }

        await assignSupport(ticketId, supportId, supportName, supportLang);

        // Read back updated participants for broadcast
        const participants = (await findUpdatedParticipants(ticketId)) || [];
        socket.join(Rooms.ticket(ticketId));
        const { messages: msgRows, hasMore, nextCursor } = await findTicketMessagesPaginated(ticketId, { limit: 100 });
        const msgs = msgRows.map(mapMessageRow);
        const labelIds = await findTicketLabelIds(ticketId);
        socket.emit('ticket:history', { ticketId, messages: msgs, labels: labelIds, hasMore, nextCursor });
        io.to(Rooms.ticket(ticketId)).emit('support:joined', { ticketId, supportId, supportName, participants });
        await broadcastQueuePositions(callerPartnerId);
        if (ticket.agentId) {
          sendPush(ticket.agentId, {
            title: 'Support joined your ticket',
            body: `${socket.data.name} joined your conversation`,
            ticketId,
            type: 'joined',
            tag: `ticket-${ticketId}`,
          });
        }
      } catch (err: unknown) { logger.error({ err: err instanceof Error ? err.message : String(err) }, '[support:join] error'); }
    });

    socket.on('message:loadMore', async ({ ticketId, cursor }: { ticketId: string; cursor: string }) => {
      if (!requireIdentified(socket)) return;
      if (!ticketId || !cursor) return;

      try {
        const ticket = await requirePartnerScope(socket, ticketId);
        if (!ticket) return;

        const { messages: msgRows, hasMore, nextCursor } = await findTicketMessagesPaginated(ticketId, {
          limit: 50,
          beforeCursor: cursor,
        });

        socket.emit('message:morePage', {
          ticketId,
          messages: msgRows.map(mapMessageRow),
          hasMore,
          nextCursor,
        });
      } catch (err: unknown) {
        logger.error({ err: err instanceof Error ? err.message : String(err), ticketId }, '[message:loadMore] error');
      }
    });

    socket.on('status:set', async ({ status }: { status: string }) => {
      if (!requireIdentified(socket)) return;
      const VALID_STATUSES = ['online', 'away'] as const;
      if (!VALID_STATUSES.includes(status as typeof VALID_STATUSES[number])) return;
      const userId = socket.data.userId;
      const partnerId = socket.data.partnerId;
      if (userId && partnerId) {
        await presenceService.setUserStatus(userId, partnerId, status);
        await statusTracking.logTransition(userId, partnerId, status);
      }
    });

    socket.on('support:leave', async ({ ticketId }: SupportLeavePayload) => {
      if (!requireIdentified(socket)) return;
      socketioEventsTotal.inc({ event: 'support:leave' });
      try {
        // Use verified identity — never trust client-supplied supportId/supportName
        const supportId = socket.data.userId;
        const supportName = socket.data.name;

        const ticket = await requirePartnerScopeWith(socket, ticketId, findTicketParticipants);
        if (!ticket) return;

        // Verify caller is actually a participant in this ticket
        const currentParticipants: Participant[] = (ticket.participants as unknown as Participant[]) || [];
        const isParticipant = currentParticipants.some((p: Participant) => p.id === supportId);
        if (!isParticipant) {
          return socket.emit('error', { message: 'You are not a participant of this ticket' });
        }

        let participants = currentParticipants.filter((p: Participant) => p.id !== supportId);
        await updateParticipants(ticketId, participants);
        socket.leave(Rooms.ticket(ticketId));
        io.to(Rooms.ticket(ticketId)).emit('support:left', { ticketId, supportId, supportName, participants });
      } catch (err: unknown) { logger.error({ err: err instanceof Error ? err.message : String(err) }, '[support:leave] error'); }
    });

    socket.on('ticket:close', async ({ ticketId, closingNotes }: Omit<TicketClosePayload, 'closedBy'>) => {
      if (!requireIdentified(socket)) return;
      socketioEventsTotal.inc({ event: 'ticket:close' });
      try {
        const senderId = socket.data.userId;
        const senderName = socket.data.name;
        if (!senderId) return socket.emit('error', { message: 'Not authenticated' });

        // Authorization: only support/admin roles can close tickets
        if (!socket.data.isSupport) {
          return socket.emit('error', { message: 'Only support staff can close tickets' });
        }

        const ticket = await requirePartnerScopeWith(socket, ticketId, findTicketForClose);
        if (!ticket) return;

        if (ticket.status === 'closed') {
          return; // Already closed
        }

        // Limit closing notes length to prevent abuse
        const sanitizedNotes = closingNotes ? closingNotes.slice(0, MAX_NOTE_LENGTH) : '';
        const now = await closeTicket(ticketId, senderName || 'System', sanitizedNotes);
        io.to(Rooms.ticket(ticketId)).emit('ticket:closed', { ticketId, status: 'closed', closedAt: now, closedBy: senderName || 'System', supportId: ticket.supportId ?? undefined, supportName: ticket.supportName ?? undefined });
        await broadcastQueuePositions(ticket.partnerId);
        if (ticket.agentId) {
          sendPush(ticket.agentId, {
            title: 'How was your experience?',
            body: 'Your ticket has been closed. Rate your support.',
            ticketId,
            type: 'rating',
            tag: `ticket-${ticketId}`,
          });
        }

        // Fire-and-forget AI auto-summarize
        autoSummarizeOnClose(ticket.partnerId, senderId, ticketId, io).catch(() => {});
      } catch (err: unknown) { logger.error({ err: err instanceof Error ? err.message : String(err) }, '[ticket:close] error'); }
    });

    // ── Rating Submit ──────────────────────────────────────────────────────────
    socket.on('rating:submit', async ({ ticketId, rating, comment }: { ticketId: string; rating: number; comment: string | null }) => {
      if (!requireIdentified(socket)) return;
      socketioEventsTotal.inc({ event: 'rating:submit' });
      try {
        if (!ticketId || typeof rating !== 'number' || rating < 1 || rating > 5) {
          logger.warn('[rating:submit] invalid payload');
          return;
        }
        const intRating = Math.round(rating);
        const agentId = socket.data.userId; // Server-side identity — never trust client-supplied agentId

        // Tenant isolation: verify ticket belongs to caller's partner and caller is the agent
        // Read support_id from the ticket instead of trusting client-provided value
        const ticket = await requirePartnerScopeWith(socket, ticketId, findTicketOwner);
        if (!ticket) return;
        if (ticket.agentId !== socket.data.userId) {
          return socket.emit('error', { message: 'Only the ticket agent can submit a rating' });
        }
        if (!ticket.supportId) {
          return socket.emit('error', { message: 'No support user assigned to this ticket' });
        }
        const supportId = ticket.supportId;

        const id = crypto.randomUUID();
        const safeComment = comment ? comment.slice(0, MAX_NOTE_LENGTH) : null;
        await insertRating({ id, ticketId, agentId: agentId!, supportId, partnerId: socket.data.partnerId, rating: intRating, comment: safeComment });
        io.to(Rooms.ticket(ticketId)).emit('rating:submitted', { ticketId, agentId, supportId, rating: intRating });
      } catch (err: unknown) { logger.error({ err: err instanceof Error ? err.message : String(err) }, '[rating:submit] error'); }
    });

    socket.on('message:send', async ({ ticketId, text, mediaUrl, whisper }: Omit<MessageSendPayload, 'senderId'>) => {
      if (!requireIdentified(socket)) return;
      socketioEventsTotal.inc({ event: 'message:send' });
      try {
        const senderId = socket.data.userId;
        if (!senderId) return socket.emit('error', { message: 'Not authenticated' });
        logger.info({ ticketId, senderId }, '[message:send] Received');
        if (!ticketId || !text) return;
        if (mediaUrl && !isValidMediaUrl(mediaUrl)) return socket.emit('error', { message: 'Invalid media URL' });
        const ticket = await requirePartnerScopeWith(socket, ticketId, findTicketForMessage);
        logger.info({ ticketFound: !!ticket, status: ticket?.status }, '[message:send] Ticket lookup');
        if (!ticket || ticket.status === 'closed') return;

        let sender = await findSenderInfo(senderId, ticket.partnerId) as SenderInfo | undefined;

        // CR-03 fix: Platform operators have no membership row — fall back to socket.data
        if (!sender && socket.data.authedIsPlatformOperator) {
          sender = {
            name: socket.data.name as string || senderId,
            role: 'platform_operator',
            lang: (socket.data.lang as string) || 'en',
          };
          logger.info({ senderId }, '[message:send] Platform operator fallback — no membership row');
        }

        logger.info({ senderFound: !!sender, role: sender?.role }, '[message:send] Sender lookup');
        if (!sender) return logger.error({ senderId }, '[message:send] sender not found or no membership for ticket partner');

        // Authorization: only support/admin can send whispers
        const isWhisper = whisper && socket.data.isSupport;
        if (whisper && !isWhisper) {
          logger.warn({ senderId, role: sender.role }, '[message:send] Non-support user attempted whisper');
        }

        // CR-02: Run content moderation guards (skip for whispers — internal staff notes)
        let guardedText = text;
        if (!isWhisper) {
          // Synchronous guards always run (fail closed — no try/catch bypass)
          const syncResult = runSyncGuards(text);
          if (!syncResult.ok) {
            logger.warn({ senderId, code: syncResult.code }, '[message:send] Blocked by content guard');
            return socket.emit('error', { message: `Message blocked: ${syncResult.code}` });
          }
          guardedText = syncResult.text;

          // Redis-dependent repetition guard (fail open if Redis unavailable)
          try {
            const { pubClient } = getRedisClients();
            const repResult = await guardRepetition(pubClient as Parameters<typeof guardRepetition>[0], guardedText, senderId);
            if (!repResult.ok) {
              logger.warn({ senderId, code: repResult.code }, '[message:send] Blocked by content guard');
              return socket.emit('error', { message: `Message blocked: ${repResult.code}` });
            }
          } catch (guardErr) {
            // Fail open for Redis-dependent guard only — sync guards already passed
            logger.error({ err: guardErr instanceof Error ? guardErr.message : String(guardErr) }, '[message:send] Repetition guard error (Redis)');
          }
        }

        const msgPayload = await insertMessage({
          ticketId,
          senderId,
          senderName: sender.name,
          senderRole: sender.role,
          senderLang: sender.lang,
          text: guardedText,
          mediaUrl,
          whisper: isWhisper,
        });
        const messageId = msgPayload.id;

        if (isWhisper) {
          // CR-01: Whisper messages must only be sent to support/admin sockets, never to end-users
          const roomSockets = await io.in(Rooms.ticket(ticketId)).fetchSockets();
          for (const s of roomSockets) {
            if (s.data.isSupport) {
              s.emit('message:new', msgPayload);
            }
          }
        } else {
          io.to(Rooms.ticket(ticketId)).emit('message:new', msgPayload);
        }
        logger.info({ messageId, whisper: !!isWhisper }, '[message:send] Emitted message:new');
        // Push notification to agent when support replies (fire-and-forget)
        if (socket.data.isSupport && !isWhisper && ticket.agentId) {
          sendPush(ticket.agentId, {
            title: 'New message from support',
            body: `${sender.name}: ${guardedText.slice(0, 100)}`,
            ticketId,
            type: 'reply',
            tag: `ticket-${ticketId}`,
          });
        }
        // Invalidate cached AI summary for this ticket (fire-and-forget)
        invalidateSummary(ticketId).catch(() => {});
        // Fire-and-forget sentiment scoring (skip whispers — internal notes shouldn't affect sentiment)
        // ME-01 fix: Score on guardedText (what's stored/displayed), not raw pre-guard text
        if (!isWhisper) {
          scoreSentiment(ticket.partnerId, senderId, messageId, guardedText).catch(() => {});
        }
      } catch (err: unknown) { logger.error({ err: err instanceof Error ? err.message : String(err) }, '[message:send] error'); }
    });

    socket.on('typing:start', ({ ticketId }: { ticketId: string, senderName?: string }) => {
      if (!requireIdentified(socket)) return;
      // Only emit if socket is actually in the ticket room (i.e., is a participant)
      if (!ticketId || !socket.rooms.has(Rooms.ticket(ticketId))) return;
      socket.to(Rooms.ticket(ticketId)).emit('typing:update', { ticketId, senderName: socket.data.name, typing: true });
    });

    socket.on('typing:stop', ({ ticketId }: { ticketId: string, senderName?: string }) => {
      if (!requireIdentified(socket)) return;
      if (!ticketId || !socket.rooms.has(Rooms.ticket(ticketId))) return;
      socket.to(Rooms.ticket(ticketId)).emit('typing:update', { ticketId, senderName: socket.data.name, typing: false });
    });

    socket.on('message:delivered', async ({ ticketId, messageId }: { ticketId: string, messageId: string }) => {
      if (!requireIdentified(socket)) return;
      if (!ticketId || !messageId) return;
      try {
        // Tenant isolation: verify ticket belongs to caller's partner
        const ticket = await requirePartnerScope(socket, ticketId);
        if (!ticket) return;

        // Only update messages that belong to this ticket
        const now = await markDelivered(messageId, ticketId);
        io.to(Rooms.ticket(ticketId)).emit('message:status', { messageId, ticketId, status: 'delivered', timestamp: now });
      } catch (err: unknown) { logger.error({ err: err instanceof Error ? err.message : String(err) }, '[message:delivered] error'); }
    });

    socket.on('message:read', async ({ ticketId, messageIds }: { ticketId: string, messageIds: string[] }) => {
      if (!requireIdentified(socket)) return;
      if (!ticketId || !messageIds?.length) return;
      try {
        // Tenant isolation: verify ticket belongs to caller's partner
        const ticket = await requirePartnerScope(socket, ticketId);
        if (!ticket) return;

        // Limit array length to prevent DoS
        const limitedIds = messageIds.slice(0, MAX_BATCH_DELETE);

        // Batch update: scope to ticket_id for safety
        const now = await markRead(limitedIds, ticketId);

        // Broadcast status for each message
        for (const messageId of limitedIds) {
          io.to(Rooms.ticket(ticketId)).emit('message:status', { messageId, ticketId, status: 'read', timestamp: now });
        }
      } catch (err: unknown) { logger.error({ err: err instanceof Error ? err.message : String(err) }, '[message:read] error'); }
    });

    // ── Message Edit ─────────────────────────────────────────────────────────
    socket.on('message:edit', async ({ ticketId, messageId, text: newText }: { ticketId: string; messageId: string; text: string }) => {
      if (!requireIdentified(socket)) return;
      socketioEventsTotal.inc({ event: 'message:edit' });
      try {
        const senderId = socket.data.userId;
        if (!senderId || !ticketId || !messageId || !newText?.trim()) return;
        if (newText.trim().length > MAX_MESSAGE_LENGTH) return socket.emit('error', { message: 'Message too long' });

        // Verify ticket belongs to caller's partner
        const ticket = await requirePartnerScope(socket, ticketId);
        if (!ticket) return;

        // Only allow editing own messages within 15 minutes
        const msg = await findMessageForEdit(messageId, ticketId);
        if (!msg) return;
        if (msg.senderId !== senderId) return socket.emit('error', { message: 'Can only edit your own messages' });
        if (msg.system) return socket.emit('error', { message: 'Cannot edit system messages' });
        if (msg.deletedAt) return socket.emit('error', { message: 'Cannot edit deleted messages' });

        const ageMs = Date.now() - new Date(msg.createdAt).getTime();
        if (ageMs > MAX_EDIT_WINDOW_MS) return socket.emit('error', { message: 'Edit window has expired (15 min)' });

        // CR-01 fix: Run content moderation guards on edited text (mirrors message:send)
        let guardedText = newText.trim();
        const syncResult = runSyncGuards(guardedText);
        if (!syncResult.ok) {
          logger.warn({ senderId, code: syncResult.code }, '[message:edit] Blocked by content guard');
          return socket.emit('error', { message: `Edit blocked: ${syncResult.code}` });
        }
        guardedText = syncResult.text;

        // Redis-dependent repetition guard (fail open if Redis unavailable)
        try {
          const { pubClient } = getRedisClients();
          const repResult = await guardRepetition(pubClient as Parameters<typeof guardRepetition>[0], guardedText, senderId);
          if (!repResult.ok) {
            logger.warn({ senderId, code: repResult.code }, '[message:edit] Blocked by content guard');
            return socket.emit('error', { message: `Edit blocked: ${repResult.code}` });
          }
        } catch (guardErr) {
          logger.error({ err: guardErr instanceof Error ? guardErr.message : String(guardErr) }, '[message:edit] Repetition guard error (Redis)');
        }

        const now = await updateMessageText(messageId, guardedText);

        io.to(Rooms.ticket(ticketId)).emit('message:edited', { ticketId, messageId, text: guardedText, editedAt: now });
      } catch (err: unknown) { logger.error({ err: err instanceof Error ? err.message : String(err) }, '[message:edit] error'); }
    });

    // ── Message Delete ────────────────────────────────────────────────────────
    socket.on('message:delete', async ({ ticketId, messageId }: { ticketId: string; messageId: string }) => {
      if (!requireIdentified(socket)) return;
      socketioEventsTotal.inc({ event: 'message:delete' });
      try {
        const senderId = socket.data.userId;
        if (!senderId || !ticketId || !messageId) return;

        const ticket = await requirePartnerScope(socket, ticketId);
        if (!ticket) return;

        const msg = await findMessageForDelete(messageId, ticketId);
        if (!msg) return;

        // Support/admin can delete any non-system message; others only their own
        if (!socket.data.isSupport && msg.senderId !== senderId) {
          return socket.emit('error', { message: 'Can only delete your own messages' });
        }
        if (msg.system) return socket.emit('error', { message: 'Cannot delete system messages' });
        if (msg.deletedAt) return; // Already deleted

        const now = await softDeleteMessage(messageId);

        io.to(Rooms.ticket(ticketId)).emit('message:deleted', { ticketId, messageId, deletedAt: now });
      } catch (err: unknown) { logger.error({ err: err instanceof Error ? err.message : String(err) }, '[message:delete] error'); }
    });

    // ── Ticket Transfer ──────────────────────────────────────────────────────
    socket.on('ticket:transfer', async ({ ticketId, departmentId, note }: { ticketId: string; departmentId?: string; note?: string }) => {
      if (!requireIdentified(socket)) return;
      socketioEventsTotal.inc({ event: 'ticket:transfer' });
      try {
        const senderId = socket.data.userId;
        const senderName = socket.data.name;
        const callerPartnerId = socket.data.partnerId;

        if (!socket.data.isSupport) {
          return socket.emit('error', { message: 'Only support staff can transfer tickets' });
        }

        const ticket = await requirePartnerScopeWith(socket, ticketId, findTicketForTransfer);
        if (!ticket) return;

        if (departmentId) {
          // Transfer to a different department
          const depts = await findPartnerDepartments(callerPartnerId);
          const targetDept = depts.find(d => d.id === departmentId);
          if (!targetDept) return socket.emit('error', { message: 'Department not found' });

          // Optional whisper note for context handoff
          if (note?.trim()) {
            const senderInfo = await findSenderInfo(senderId, callerPartnerId);
            const whisperMsg = await insertWhisperMessage(
              ticketId, senderId, senderName,
              senderInfo?.role || 'support', senderInfo?.lang || 'en',
              note.trim(),
            );
            io.to(Rooms.ticket(ticketId)).emit('message:new', whisperMsg);
          }

          // Update ticket: new department, clear support assignment, re-open
          await transferTicketToDepartment(ticketId, departmentId);

          // System message
          const sysText = `Ticket transferred to ${targetDept.name} by ${senderName}`;
          const sysMsg = await insertSystemMessage(ticketId, sysText);
          io.to(Rooms.ticket(ticketId)).emit('message:new', sysMsg);

          const transferPayload = {
            ticketId,
            fromId: senderId,
            fromName: senderName,
            toDepartment: departmentId,
            toDepartmentName: targetDept.name,
          };

          // Emit to ticket room (for the user/agent) AND partner room (for support sidebars)
          io.to(Rooms.ticket(ticketId)).emit('ticket:transferred', transferPayload);
          io.to(Rooms.partner(callerPartnerId)).emit('ticket:transferred', transferPayload);

          // Remove ALL support sockets from ticket room
          const ticketRoom = Rooms.ticket(ticketId);
          const socketsInRoom = await io.in(ticketRoom).fetchSockets();
          for (const s of socketsInRoom) {
            if (s.data.isSupport) s.leave(ticketRoom);
          }

          // Broadcast queue positions for both departments
          await broadcastQueuePositions(callerPartnerId);
        } else {
          // Return to queue — same department, unassign support
          await returnTicketToQueue(ticketId);

          const sysText = `${senderName} returned ticket to queue`;
          const sysMsg = await insertSystemMessage(ticketId, sysText);
          io.to(Rooms.ticket(ticketId)).emit('message:new', sysMsg);
          io.to(Rooms.ticket(ticketId)).emit('ticket:transferred', {
            ticketId,
            fromId: senderId,
            fromName: senderName,
            toId: null,
            toName: null,
          });

          // Remove sender from ticket room
          socket.leave(Rooms.ticket(ticketId));

          await broadcastQueuePositions(callerPartnerId);
        }
      } catch (err: unknown) {
        logger.error({ err: err instanceof Error ? err.message : String(err) }, '[ticket:transfer] error');
      }
    });

    socket.on('ticket:labels:update', async ({ ticketId, labels }: { ticketId: string, labels: string[] }) => {
      if (!requireIdentified(socket)) return;
      const role = socket.data.role;
      if (role === 'agent') {
        return socket.emit('error', { message: 'Not authorized to update labels' });
      }
      try {
        if (!ticketId || !Array.isArray(labels)) return;
        const senderId = socket.data.userId;
        if (!senderId) return socket.emit('error', { message: 'Not authenticated' });

        // ME-07 fix: Cap label array size to prevent oversized IN clause
        if (labels.length > MAX_LABELS_PER_TICKET) {
          return socket.emit('error', { message: `Too many labels (max ${MAX_LABELS_PER_TICKET})` });
        }

        const ticket = await requirePartnerScope(socket, ticketId);
        if (!ticket) return;

        // Validate that all labels belong to this partner
        if (labels.length > 0) {
          const partnerLabels = await findPartnerLabels(ticket.partnerId, labels);
          const validIds = new Set(partnerLabels.map(l => l.id));
          const invalidLabels = labels.filter(l => !validIds.has(l));
          if (invalidLabels.length > 0) {
            return socket.emit('error', { message: 'Invalid label IDs' });
          }
        }

        await replaceTicketLabels(ticketId, labels);
        io.to(Rooms.ticket(ticketId)).emit('ticket:labels:updated', { ticketId, labels });
      } catch (err: unknown) {
        logger.error({ err: err instanceof Error ? err.message : String(err), ticketId }, '[ticket:labels:update] error');
      }
    });

    // ── Collision Detection: ticket viewing ───────────────────────────────────
    socket.on('ticket:viewing', async ({ ticketId }: { ticketId: string }) => {
      if (!requireIdentified(socket)) return;
      if (!socket.data.isSupport) return;
      if (!ticketId) return;

      // Tenant isolation: verify ticket belongs to caller's partner
      const ticket = await requirePartnerScope(socket, ticketId);
      if (!ticket) return;

      const userId = socket.data.userId as string;
      const userName = socket.data.name as string;

      // Join the socket room if not already in it
      if (!socket.rooms.has(Rooms.ticket(ticketId))) {
        socket.join(Rooms.ticket(ticketId));
      }

      await addViewer(ticketId, socket.id, userId, userName);
      await broadcastViewers(io, ticketId);
    });

    socket.on('ticket:left', async ({ ticketId }: { ticketId: string }) => {
      if (!requireIdentified(socket)) return;
      if (!ticketId) return;
      await removeViewer(ticketId, socket.id);
      await broadcastViewers(io, ticketId);
    });

    socket.on('disconnect', async () => {
      socketioConnectionsActive.dec();
      const userId = socket.data.userId;
      const partnerId = socket.data.partnerId;
      const userName = socket.data.name;

      // Clear typing indicators for all ticket rooms this socket was in
      if (userId && userName) {
        for (const room of socket.rooms) {
          if (room.startsWith('ticket:')) {
            const ticketId = room.replace('ticket:', '');
            socket.to(room).emit('typing:update', { ticketId, senderName: userName, typing: false });
          }
        }
      }

      // Clear viewer tracking for this socket and broadcast updates
      const affectedTickets = await removeViewerFromAll(socket.id);
      for (const ticketId of affectedTickets) {
        await broadcastViewers(io, ticketId);
      }

      if (userId && partnerId) {
        try {
          const result = await presenceService.decrementUserCount(userId, partnerId);
          if (result && result.removed) {
            if (result.role === 'agent') {
              broadcastAgentStatus(userId, false);
            }
            // Close status tracking row when user fully disconnects (all roles)
            await statusTracking.closeOpenRow(userId, partnerId);
          }
        } catch (err) {
          // M-06: Don't let presence errors crash the disconnect handler
          logger.error({ err: err instanceof Error ? err.message : String(err), userId }, '[socket] Presence decrement error on disconnect');
        }
      }
    });
  });

  // Periodic cleanup of stale local socketTickets index (every 5 minutes)
  // Redis entries auto-expire via TTL; this cleans the local socketId→ticketId mapping.
  // .unref() prevents this timer from keeping the process alive on shutdown
  setInterval(() => {
    for (const [socketId] of socketTickets) {
      if (!io.sockets.sockets.has(socketId)) {
        socketTickets.delete(socketId);
      }
    }
  }, 5 * 60 * 1000).unref();
}
