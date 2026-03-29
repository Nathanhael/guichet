import { Server, Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import { parse as parseCookie } from 'cookie';
import * as presenceService from '../services/presence.js';
import { query, get, run, transaction } from '../db.js';
import { getBusinessHoursStatus, broadcastQueuePositions, broadcastAgentStatus, BusinessHoursSchedule } from '../services/businessHours.js';
import logger from '../utils/logger.js';
import config from '../config.js';
import { Ticket, Message, User, UserRole } from '../types/index.js';
import { socketioConnectionsActive, socketioEventsTotal } from '../utils/metrics.js';
import { isValidMediaUrl } from '../utils/security.js';
import { mapMessageRow } from '../utils/messageMapper.js';
import { canUseSupportWorkflows, isPlatformAdmin } from '../services/roles.js';
import { isRevoked } from '../services/sessionRevocation.js';
import { runSyncGuards, guardRepetition } from '../services/guards.js';
import { getRedisClients } from '../utils/redis.js';
import { invalidateSummary } from '../services/ai/summaryCache.js';
import { autoSummarizeOnClose } from '../services/ai/autoSummarize.js';
import { scoreSentiment } from '../services/ai/sentiment.js';
import { parseSlaConfig, getEffectiveSla, calculateSlaDueDate } from '../services/sla.js';
import { Rooms } from '../utils/rooms.js';
import { insertSystemMessage } from '../services/systemMessage.js';
import {
  VIEWER_TTL_SECONDS,
  MAX_BATCH_DELETE,
  MAX_MESSAGE_LENGTH,
  MAX_EDIT_WINDOW_MS,
  MAX_LABELS_PER_TICKET,
  MAX_NOTE_LENGTH,
  RECENT_CLOSED_TICKETS_LIMIT,
} from '../constants.js';

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

interface TicketLabelRow {
  labelId: string;
}

interface SenderInfo {
  name: string;
  role: string;
  lang: string;
}

interface TicketRow {
  id: string;
  partner_id: string;
  dept: string;
  agent_id: string;
  agent_lang: string;
  support_id: string | null;
  support_name: string | null;
  support_lang: string | null;
  support_joined_at: string | null;
  status: string;
  participants: string;
  created_at: string;
}

interface TicketParticipantsRow {
  participants: string;
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
const REVOCATION_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

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

  // Periodic revocation check — runs at most once every 5 minutes per socket.
  // SECURITY TRADE-OFF: Between checks, a revoked session can still send socket
  // messages for up to REVOCATION_CHECK_INTERVAL_MS (currently 5 minutes). This is
  // an accepted trade-off for performance: synchronous Redis checks on every socket
  // event would eliminate the window but significantly increase Redis load (especially
  // under high message throughput). NOTE: The check is fire-and-forget — the event
  // that triggers it still completes even if revocation is detected. The revoked
  // socket is disconnected asynchronously, so one additional event may execute.
  // For high-security deployments requiring near-instant revocation, consider:
  // (a) reducing REVOCATION_CHECK_INTERVAL_MS (increases Redis calls linearly),
  // (b) switching to synchronous per-event revocation checks with Redis connection
  // pooling, or (c) using Redis Pub/Sub to push revocation events to socket servers.
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

      const decoded = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] }) as {
        userId: string; role: string; partnerId?: string; jti?: string; iat?: number; exp?: number;
        isPlatformOperator?: boolean;
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

    socket.on('socket:identify', async ({ partnerId }: { userId?: string, role?: string, name?: string, partnerId: string }) => {
      // Use the verified identity from JWT middleware — never trust client-supplied userId
      const userId = socket.data.authedUserId as string;
      if (!userId) {
        socket.emit('error', { message: 'Not authenticated' });
        socket.disconnect();
        return;
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
        // Look up the user's name from the DB (don't trust client-supplied name)
        const userRow = await get('SELECT name, is_platform_operator FROM users WHERE id = $1', [userId]) as { name: string; isPlatformOperator: boolean } | undefined;
        if (!userRow) {
          socket.emit('error', { message: 'User not found' });
          socket.disconnect();
          return;
        }
        const name = userRow.name || userId;

        // Validate that user has a membership for the requested partner
        const membership = await get('SELECT role FROM memberships WHERE user_id = $1 AND partner_id = $2', [userId, partnerId]) as { role: string } | undefined;
        let effectiveRole: UserRole;
        if (!membership) {
          // No membership — check if user is a platform operator
          if (!isPlatformAdmin(!!socket.data.authedIsPlatformOperator)) {
            socket.emit('error', { message: 'Not authorized for this partner' });
            socket.disconnect();
            return;
          }
          effectiveRole = 'admin';
        } else {
          effectiveRole = membership.role as UserRole;
        }

        socket.data.userId = userId;
        socket.data.role = effectiveRole;
        socket.data.name = name;
        socket.data.partnerId = partnerId;
        socket.data.isSupport = canUseSupportWorkflows(effectiveRole, !!socket.data.authedIsPlatformOperator);

        await presenceService.identifyUser(userId, effectiveRole, name, partnerId, !!socket.data.authedIsPlatformOperator);

        // Join partner-wide room (for events all users need: partner:deactivated, hours:closed, etc.)
        socket.join(Rooms.partner(partnerId));

        // Staff (support/admin/platform) get a separate room for ticket-level broadcasts.
        // Agents must NOT receive other users' ticket data — they only see their own via ticket:created:self.
        if (socket.data.isSupport) {
          socket.join(Rooms.staff(partnerId));
          await presenceService.broadcastOnlineSupport(partnerId);
        }

        // Join private user room for individual kill switches
        socket.join(Rooms.user(userId));

        if (effectiveRole === 'agent') {
          broadcastAgentStatus(userId, true);
        }

        // Re-join active ticket rooms
        try {
          let activeTickets: { id: string }[] = [];
          if (effectiveRole === 'agent') {
            activeTickets = await query("SELECT id FROM tickets WHERE agent_id = $1 AND partner_id = $2 AND status != 'closed'", [userId, partnerId]) as { id: string }[];
          } else if (socket.data.isSupport) {
            activeTickets = await query("SELECT id FROM tickets WHERE (support_id = $1 OR participants::jsonb @> $3::jsonb) AND partner_id = $2 AND status != 'closed'", [userId, partnerId, JSON.stringify([{ id: userId }])]) as { id: string }[];
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

      const partnerId = socket.data.partnerId;
      const partnerRow = partnerId ? await get('SELECT status, business_hours_schedule, business_hours_start, business_hours_end, business_hours_timezone, sla_config FROM partners WHERE id = $1', [partnerId]) as { status: string; business_hours_schedule: unknown; business_hours_start: string | null; business_hours_end: string | null; business_hours_timezone: string | null; sla_config: unknown } | undefined : null;
      
      if (partnerRow && partnerRow.status !== 'active') {
        return socket.emit('error', { message: 'Partner is currently inactive.' });
      }

      const partnerHours = partnerRow ? {
        businessHoursSchedule: partnerRow.business_hours_schedule as BusinessHoursSchedule | null,
        businessHoursStart: partnerRow.business_hours_start,
        businessHoursEnd: partnerRow.business_hours_end,
        businessHoursTimezone: partnerRow.business_hours_timezone,
      } : undefined;

      const businessHoursStatus = getBusinessHoursStatus(partnerHours);
      if (!businessHoursStatus.isOpen) {
        return socket.emit('hours:closed', {
          code: 'BUSINESS_HOURS_CLOSED',
          message: businessHoursStatus.message,
          status: businessHoursStatus,
        });
      }
      try {
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
          const recentClosed = await query('SELECT id, reopen_count, "references" FROM tickets WHERE partner_id = $1 AND status = \'closed\' ORDER BY created_at DESC LIMIT $2', [partnerId, RECENT_CLOSED_TICKETS_LIMIT]) as unknown as Array<{ id: string; reopen_count: number; references: string | Array<{ label: string; value: string }> | null }>;
          const match = recentClosed.find(t => {
            try {
              const raw = typeof t.references === 'string' ? JSON.parse(t.references) : t.references;
              const ticketRefs: Array<{ label: string; value: string }> = Array.isArray(raw) ? raw : [];
              return ticketRefs.some(r => incomingValues.includes(r.value));
            } catch { return false; }
          });
          if (match) {
            reopened = true;
            reopenCount = (match.reopen_count || 0) + 1;
          }
        }

        const agentUser = (await get('SELECT name FROM users WHERE id = $1', [agentId])) as unknown as User;
        const ticket: Ticket = { id: uuidv4(), dept, agentId, agentName: agentUser?.name || agentId, agentLang, references, status: 'open', supportId: null, createdAt: new Date().toISOString(), participants: '[]' };
        await run('INSERT INTO tickets (id, partner_id, dept, agent_id, agent_name, agent_lang, "references", status, created_at, participants, reopened, reopen_count) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)', [ticket.id, partnerId, ticket.dept, ticket.agentId, ticket.agentName, ticket.agentLang, JSON.stringify(references), ticket.status, ticket.createdAt, ticket.participants, reopened, reopenCount]);

        let message: Message | null = null;
        if (text?.trim()) {
          const messageId = uuidv4();
          const now = new Date().toISOString();
          message = { 
            id: messageId, 
            ticketId: ticket.id, 
            senderId: agentId, 
            senderName: agentUser?.name || agentId, 
            senderRole: 'agent', 
            senderLang: agentLang, 
            originalText: text, 
            improvedText: text,
            processedText: text,
            whisper: 0, 
            system: 0, 
            translationSkipped: 1,
            fallback: 0,
            timestamp: now, 
            reactions: '{}' 
          };
          if (message) {
            await run(`INSERT INTO messages (id, ticket_id, sender_id, sender_name, sender_role, sender_lang, text, media_url, whisper, system, created_at, reactions) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`, [message.id, message.ticketId, message.senderId, message.senderName, message.senderRole, message.senderLang, message.originalText, mediaUrl || null, 0, 0, message.timestamp, '{}']);
          }
        }
        // Calculate SLA due dates based on partner config (respects business hours if enabled)
        const slaConfig = parseSlaConfig(partnerRow?.sla_config);
        const sla = getEffectiveSla(slaConfig, dept);
        const createdDate = new Date(ticket.createdAt);
        const slaOpts = {
          businessHoursOnly: slaConfig?.businessHoursOnly,
          partnerHours: partnerHours,
        };
        const slaResponseDueAt = calculateSlaDueDate(createdDate, sla.responseMs, slaOpts).toISOString();
        const slaResolutionDueAt = calculateSlaDueDate(createdDate, sla.resolutionMs, slaOpts).toISOString();
        await run('UPDATE tickets SET sla_response_due_at = $1, sla_resolution_due_at = $2 WHERE id = $3', [slaResponseDueAt, slaResolutionDueAt, ticket.id]);
        const ticketWithSla = { ...ticket, slaResponseDueAt, slaResolutionDueAt, slaBreached: false };

        socket.join(Rooms.ticket(ticket.id));
        socket.emit('ticket:created:self', { ticket: { ...ticketWithSla, participants: [], labels: [] }, message });
        // Broadcast to staff only — agents must not see other users' tickets (CR-04 socket-layer fix)
        io.to(Rooms.staff(partnerId)).emit('ticket:created', { ticket: { ...ticketWithSla, participants: [], labels: [] }, firstMessage: message });
        await broadcastQueuePositions(partnerId);
      } catch (err: unknown) { logger.error({ err: err instanceof Error ? err.message : String(err) }, '[ticket:new] error'); }
    });

    socket.on('support:join', async ({ ticketId, supportLang }: SupportJoinPayload) => {
      if (!requireIdentified(socket)) return;
      socketioEventsTotal.inc({ event: 'support:join' });
      try {
        // Use verified identity from socket.data — never trust client-supplied supportId/supportName
        const supportId = socket.data.userId;
        const supportName = socket.data.name;
        const callerRole = socket.data.role;
        const callerPartnerId = socket.data.partnerId;

        // Authorization: only support/admin roles can join
        if (!socket.data.isSupport) {
          return socket.emit('error', { message: 'Not authorized to join tickets' });
        }

        const ticket = await get('SELECT id, partner_id, support_id, support_name, support_lang, support_joined_at, status, participants FROM tickets WHERE id = $1', [ticketId]) as unknown as TicketRow | undefined;
        if (!ticket) return;

        // Tenant isolation: ticket must belong to caller's partner
        if (ticket.partner_id !== callerPartnerId) {
          return socket.emit('error', { message: 'Not authorized for this ticket' });
        }

        // HI-01 fix: Prevent joining closed tickets — this would silently re-open them
        if (ticket.status === 'closed') {
          return socket.emit('error', { message: 'Cannot join a closed ticket' });
        }

        // Atomic participant update using JSONB to avoid race conditions
        const participantJson = JSON.stringify({ id: supportId, name: supportName });
        await run(`UPDATE tickets SET
          support_id = COALESCE(support_id, $1),
          support_name = COALESCE(support_name, $2),
          support_lang = COALESCE(support_lang, $3),
          support_joined_at = COALESCE(support_joined_at, $4),
          participants = CASE
            WHEN NOT (COALESCE(participants, '[]')::jsonb @> $5::jsonb)
            THEN (COALESCE(participants, '[]')::jsonb || $6::jsonb)::text
            ELSE participants
          END,
          status = 'open'
        WHERE id = $7`, [supportId, supportName, supportLang, new Date().toISOString(), `[${participantJson}]`, participantJson, ticketId]);

        // Read back updated participants for broadcast
        const updated = await get('SELECT participants FROM tickets WHERE id = $1', [ticketId]) as { participants: string } | undefined;
        const participants = JSON.parse(updated?.participants || '[]');
        socket.join(Rooms.ticket(ticketId));
        const messages = (await query('SELECT * FROM messages WHERE ticket_id = $1 ORDER BY created_at ASC', [ticketId]) as unknown as Parameters<typeof mapMessageRow>[0][]).map(mapMessageRow);
        socket.emit('ticket:history', { ticketId, messages, labels: (await query('SELECT label_id FROM ticket_labels WHERE ticket_id = $1', [ticketId]) as unknown as TicketLabelRow[]).map((l) => l.labelId) });
        io.to(Rooms.ticket(ticketId)).emit('support:joined', { ticketId, supportName, participants });
        await broadcastQueuePositions(callerPartnerId);
      } catch (err: unknown) { logger.error({ err: err instanceof Error ? err.message : String(err) }, '[support:join] error'); }
    });

    socket.on('status:set', async ({ status }: { status: string }) => {
      if (!requireIdentified(socket)) return;
      const VALID_STATUSES = ['available', 'busy', 'away'] as const;
      if (!VALID_STATUSES.includes(status as typeof VALID_STATUSES[number])) return;
      const userId = socket.data.userId;
      const partnerId = socket.data.partnerId;
      if (userId && partnerId) {
        await presenceService.setUserStatus(userId, partnerId, status);
      }
    });

    socket.on('support:leave', async ({ ticketId }: SupportLeavePayload) => {
      if (!requireIdentified(socket)) return;
      socketioEventsTotal.inc({ event: 'support:leave' });
      try {
        // Use verified identity — never trust client-supplied supportId/supportName
        const supportId = socket.data.userId;
        const supportName = socket.data.name;

        const ticket = await get('SELECT partner_id, participants FROM tickets WHERE id = $1', [ticketId]) as unknown as (TicketParticipantsRow & { partner_id: string }) | undefined;
        if (!ticket) return;

        // Tenant isolation
        if (ticket.partner_id !== socket.data.partnerId) {
          return socket.emit('error', { message: 'Not authorized for this ticket' });
        }

        // Verify caller is actually a participant in this ticket
        const currentParticipants: Participant[] = JSON.parse(ticket.participants || '[]');
        const isParticipant = currentParticipants.some((p: Participant) => p.id === supportId);
        if (!isParticipant) {
          return socket.emit('error', { message: 'You are not a participant of this ticket' });
        }

        let participants = currentParticipants.filter((p: Participant) => p.id !== supportId);
        await run('UPDATE tickets SET participants = $1 WHERE id = $2', [JSON.stringify(participants), ticketId]);
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
        const callerRole = socket.data.role;
        if (!senderId) return socket.emit('error', { message: 'Not authenticated' });

        // Authorization: only support/admin roles can close tickets
        if (!socket.data.isSupport) {
          return socket.emit('error', { message: 'Only support staff can close tickets' });
        }

        const ticket = await get('SELECT partner_id, status FROM tickets WHERE id = $1', [ticketId]) as { partner_id: string; status: string } | undefined;
        if (!ticket) return;

        // Tenant isolation: ticket must belong to caller's partner
        if (ticket.partner_id !== socket.data.partnerId) {
          return socket.emit('error', { message: 'Not authorized for this ticket' });
        }

        if (ticket.status === 'closed') {
          return; // Already closed
        }

        // Limit closing notes length to prevent abuse
        const sanitizedNotes = closingNotes ? closingNotes.slice(0, MAX_NOTE_LENGTH) : '';
        const now = new Date().toISOString();
        await run('UPDATE tickets SET status = $1, closed_at = $2, closed_by = $3, closing_notes = $4 WHERE id = $5', ['closed', now, senderName || 'System', sanitizedNotes, ticketId]);
        io.to(Rooms.ticket(ticketId)).emit('ticket:closed', { ticketId, status: 'closed', closedAt: now, closedBy: senderName || 'System' });
        await broadcastQueuePositions(ticket.partner_id);

        // Fire-and-forget AI auto-summarize
        autoSummarizeOnClose(ticket.partner_id, senderId, ticketId, io).catch(() => {});
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
        const ticket = await get('SELECT partner_id, agent_id, support_id FROM tickets WHERE id = $1', [ticketId]) as { partner_id: string; agent_id: string; support_id: string | null } | undefined;
        if (!ticket || ticket.partner_id !== socket.data.partnerId) {
          return socket.emit('error', { message: 'Not authorized' });
        }
        if (ticket.agent_id !== socket.data.userId) {
          return socket.emit('error', { message: 'Only the ticket agent can submit a rating' });
        }
        if (!ticket.support_id) {
          return socket.emit('error', { message: 'No support user assigned to this ticket' });
        }
        const supportId = ticket.support_id;

        const id = uuidv4();
        const safeComment = comment ? comment.slice(0, MAX_NOTE_LENGTH) : null;
        await run(
          'INSERT INTO ratings (id, ticket_id, agent_id, support_id, partner_id, rating, comment) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (ticket_id) DO NOTHING',
          [id, ticketId, agentId, supportId, socket.data.partnerId, intRating, safeComment]
        );
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
        const ticket = await get('SELECT status, partner_id FROM tickets WHERE id = $1', [ticketId]) as { status: string; partner_id: string } | undefined;
        logger.info({ ticketFound: !!ticket, status: ticket?.status }, '[message:send] Ticket lookup');
        if (!ticket || ticket.status === 'closed') return;
        
        // Tenant isolation: ticket must belong to caller's partner
        if (ticket.partner_id !== socket.data.partnerId) {
          return socket.emit('error', { message: 'Not authorized for this ticket' });
        }

        let sender = (await get('SELECT u.name, m.role, u.lang FROM users u JOIN memberships m ON u.id = m.user_id WHERE u.id = $1 AND m.partner_id = $2', [senderId, ticket.partner_id])) as unknown as SenderInfo;

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

        const messageId = uuidv4();
        const now = new Date().toISOString();
        await run(`INSERT INTO messages (id, ticket_id, sender_id, sender_name, sender_role, sender_lang, text, media_url, whisper, system, created_at, reactions) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`, [messageId, ticketId, senderId, sender.name, sender.role, sender.lang, guardedText, mediaUrl || null, isWhisper ? 1 : 0, 0, now, '{}']);
        const msgPayload = { id: messageId, ticketId, senderId, senderName: sender.name, senderRole: sender.role, senderLang: sender.lang, text: guardedText, originalText: guardedText, mediaUrl, whisper: !!isWhisper, system: false, timestamp: now, createdAt: now, reactions: {} };

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
        // Invalidate cached AI summary for this ticket (fire-and-forget)
        invalidateSummary(ticketId).catch(() => {});
        // Fire-and-forget sentiment scoring (skip whispers — internal notes shouldn't affect sentiment)
        // ME-01 fix: Score on guardedText (what's stored/displayed), not raw pre-guard text
        if (!isWhisper) {
          scoreSentiment(ticket.partner_id, senderId, messageId, guardedText).catch(() => {});
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
        const ticket = await get('SELECT partner_id FROM tickets WHERE id = $1', [ticketId]) as { partner_id: string } | undefined;
        if (!ticket || ticket.partner_id !== socket.data.partnerId) return;

        // Only update messages that belong to this ticket
        const now = new Date().toISOString();
        await run('UPDATE messages SET delivered_at = $1 WHERE id = $2 AND ticket_id = $3 AND delivered_at IS NULL', [now, messageId, ticketId]);
        io.to(Rooms.ticket(ticketId)).emit('message:status', { messageId, ticketId, status: 'delivered', timestamp: now });
      } catch (err: unknown) { logger.error({ err: err instanceof Error ? err.message : String(err) }, '[message:delivered] error'); }
    });

    socket.on('message:read', async ({ ticketId, messageIds }: { ticketId: string, messageIds: string[] }) => {
      if (!requireIdentified(socket)) return;
      if (!ticketId || !messageIds?.length) return;
      try {
        // Tenant isolation: verify ticket belongs to caller's partner
        const ticket = await get('SELECT partner_id FROM tickets WHERE id = $1', [ticketId]) as { partner_id: string } | undefined;
        if (!ticket || ticket.partner_id !== socket.data.partnerId) return;

        // Limit array length to prevent DoS
        const limitedIds = messageIds.slice(0, MAX_BATCH_DELETE);
        const now = new Date().toISOString();

        // Batch update: scope to ticket_id for safety
        if (limitedIds.length > 0) {
          const placeholders = limitedIds.map((_, i) => `$${i + 3}`).join(',');
          await run(`UPDATE messages SET read_at = $1 WHERE ticket_id = $2 AND id IN (${placeholders}) AND read_at IS NULL`, [now, ticketId, ...limitedIds]);
        }

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
        const ticket = await get('SELECT partner_id FROM tickets WHERE id = $1', [ticketId]) as { partner_id: string } | undefined;
        if (!ticket || ticket.partner_id !== socket.data.partnerId) return;

        // Only allow editing own messages within 15 minutes
        const msg = await get('SELECT sender_id, created_at, system, deleted_at FROM messages WHERE id = $1 AND ticket_id = $2', [messageId, ticketId]) as { sender_id: string; created_at: string; system: number; deleted_at: string | null } | undefined;
        if (!msg) return;
        if (msg.sender_id !== senderId) return socket.emit('error', { message: 'Can only edit your own messages' });
        if (msg.system) return socket.emit('error', { message: 'Cannot edit system messages' });
        if (msg.deleted_at) return socket.emit('error', { message: 'Cannot edit deleted messages' });

        const ageMs = Date.now() - new Date(msg.created_at).getTime();
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

        const now = new Date().toISOString();
        await run('UPDATE messages SET text = $1, edited_at = $2 WHERE id = $3', [guardedText, now, messageId]);

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

        const ticket = await get('SELECT partner_id FROM tickets WHERE id = $1', [ticketId]) as { partner_id: string } | undefined;
        if (!ticket || ticket.partner_id !== socket.data.partnerId) return;

        const msg = await get('SELECT sender_id, system, deleted_at FROM messages WHERE id = $1 AND ticket_id = $2', [messageId, ticketId]) as { sender_id: string; system: number; deleted_at: string | null } | undefined;
        if (!msg) return;

        // Support/admin can delete any non-system message; others only their own
        const callerRole = socket.data.role;
        if (!socket.data.isSupport && msg.sender_id !== senderId) {
          return socket.emit('error', { message: 'Can only delete your own messages' });
        }
        if (msg.system) return socket.emit('error', { message: 'Cannot delete system messages' });
        if (msg.deleted_at) return; // Already deleted

        const now = new Date().toISOString();
        await run('UPDATE messages SET deleted_at = $1, text = $2 WHERE id = $3', [now, '', messageId]);

        io.to(Rooms.ticket(ticketId)).emit('message:deleted', { ticketId, messageId, deletedAt: now });
      } catch (err: unknown) { logger.error({ err: err instanceof Error ? err.message : String(err) }, '[message:delete] error'); }
    });

    // ── Ticket Transfer ──────────────────────────────────────────────────────
    socket.on('ticket:transfer', async ({ ticketId, targetSupportId }: { ticketId: string; targetSupportId?: string }) => {
      if (!requireIdentified(socket)) return;
      socketioEventsTotal.inc({ event: 'ticket:transfer' });
      try {
        const senderId = socket.data.userId;
        const senderName = socket.data.name;
        const callerRole = socket.data.role;
        const callerPartnerId = socket.data.partnerId;

        if (!socket.data.isSupport) {
          return socket.emit('error', { message: 'Only support staff can transfer tickets' });
        }

        const ticket = await get('SELECT id, partner_id, support_id, support_name, participants FROM tickets WHERE id = $1', [ticketId]) as unknown as TicketRow | undefined;
        if (!ticket) return socket.emit('error', { message: 'Ticket not found' });
        if (ticket.partner_id !== callerPartnerId) return socket.emit('error', { message: 'Not authorized' });

        if (targetSupportId) {
          // Transfer to a specific support agent
          const targetUser = await get('SELECT u.name FROM users u JOIN memberships m ON u.id = m.user_id WHERE u.id = $1 AND m.partner_id = $2', [targetSupportId, callerPartnerId]) as { name: string } | undefined;
          if (!targetUser) return socket.emit('error', { message: 'Target user not found or not a member of this partner' });

          // HI-02 fix: Update ticket assignment AND participants JSONB atomically
          const newParticipantJson = JSON.stringify({ id: targetSupportId, name: targetUser.name });
          await run(`UPDATE tickets SET
            support_id = $1,
            support_name = $2,
            participants = (
              SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb) || $4::jsonb
              FROM jsonb_array_elements(COALESCE(participants, '[]')::jsonb) AS elem
              WHERE elem->>'id' != $3 AND elem->>'id' != $1
            )::text
          WHERE id = $5`, [targetSupportId, targetUser.name, senderId, newParticipantJson, ticketId]);

          // Add system message
          const sysText = `Ticket transferred from ${senderName} to ${targetUser.name}`;
          const sysMsg = await insertSystemMessage(ticketId, sysText);
          io.to(Rooms.ticket(ticketId)).emit('message:new', sysMsg);
          io.to(Rooms.ticket(ticketId)).emit('ticket:transferred', { ticketId, fromId: senderId, fromName: senderName, toId: targetSupportId, toName: targetUser.name });

          // Notify the target support agent via partner room
          // Notify staff only — agents should not receive assignment broadcasts
          io.to(Rooms.staff(callerPartnerId)).emit('ticket:assigned', { ticketId, supportId: targetSupportId, supportName: targetUser.name });
        } else {
          // Return to queue — unassign support
          await run('UPDATE tickets SET support_id = NULL, support_name = NULL, status = $1 WHERE id = $2', ['open', ticketId]);

          const sysText = `${senderName} returned ticket to queue`;
          const sysMsg = await insertSystemMessage(ticketId, sysText);
          io.to(Rooms.ticket(ticketId)).emit('message:new', sysMsg);
          io.to(Rooms.ticket(ticketId)).emit('ticket:transferred', { ticketId, fromId: senderId, fromName: senderName, toId: null, toName: null });

          await broadcastQueuePositions(callerPartnerId);
        }

        // Remove sender from the ticket room
        socket.leave(Rooms.ticket(ticketId));
      } catch (err: unknown) { logger.error({ err: err instanceof Error ? err.message : String(err) }, '[ticket:transfer] error'); }
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

        const ticket = await get('SELECT partner_id FROM tickets WHERE id = $1', [ticketId]) as { partner_id: string } | undefined;
        if (!ticket) return;

        // Tenant isolation: ticket must belong to caller's partner
        if (ticket.partner_id !== socket.data.partnerId) {
          return socket.emit('error', { message: 'Not authorized for this ticket' });
        }

        // Validate that all labels belong to this partner
        if (labels.length > 0) {
          const partnerLabels = await query(
            `SELECT id FROM labels WHERE partner_id = $1 AND id IN (${labels.map((_, i) => `$${i + 2}`).join(',')})`,
            [ticket.partner_id, ...labels]
          ) as { id: string }[];
          const validIds = new Set(partnerLabels.map(l => l.id));
          const invalidLabels = labels.filter(l => !validIds.has(l));
          if (invalidLabels.length > 0) {
            return socket.emit('error', { message: 'Invalid label IDs' });
          }
        }

        await transaction(async () => {
          await run('DELETE FROM ticket_labels WHERE ticket_id = $1', [ticketId]);
          for (const labelId of labels) {
            await run('INSERT INTO ticket_labels (ticket_id, label_id) VALUES ($1, $2)', [ticketId, labelId]);
          }
        });
        io.to(Rooms.ticket(ticketId)).emit('ticket:labels:updated', { ticketId, labels });
      } catch (err: unknown) {
        logger.error({ err: err instanceof Error ? err.message : String(err), ticketId }, '[ticket:labels:update] error');
      }
    });

    // ── Collision Detection: ticket viewing ───────────────────────────────────
    socket.on('ticket:viewing', async ({ ticketId }: { ticketId: string }) => {
      if (!requireIdentified(socket)) return;
      const callerRole = socket.data.role;
      if (!socket.data.isSupport) return;
      if (!ticketId) return;

      // Tenant isolation: verify ticket belongs to caller's partner
      const ticket = await get('SELECT partner_id FROM tickets WHERE id = $1', [ticketId]) as { partner_id: string } | undefined;
      if (!ticket || ticket.partner_id !== socket.data.partnerId) return;

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
          if (result && result.removed && result.role === 'agent') {
            broadcastAgentStatus(userId, false);
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
