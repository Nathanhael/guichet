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
import { invalidateSummary } from '../services/ai/summaryCache.js';
import { autoSummarizeOnClose } from '../services/ai/autoSummarize.js';
import { scoreSentiment } from '../services/ai/sentiment.js';
import { parseSlaConfig, getEffectiveSla, calculateSlaDueDate } from '../services/sla.js';

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

// ── Collision Detection: ticket viewer tracking ─────────────────────────────
// NOTE: In-memory only — collision detection works per-instance. For multi-instance, migrate to Redis.
// Map<ticketId, Map<socketId, { userId: string; userName: string }>>
const ticketViewers = new Map<string, Map<string, { userId: string; userName: string }>>();

function addViewer(ticketId: string, socketId: string, userId: string, userName: string) {
  if (!ticketViewers.has(ticketId)) {
    ticketViewers.set(ticketId, new Map());
  }
  ticketViewers.get(ticketId)!.set(socketId, { userId, userName });
}

function removeViewer(ticketId: string, socketId: string) {
  const viewers = ticketViewers.get(ticketId);
  if (!viewers) return;
  viewers.delete(socketId);
  if (viewers.size === 0) {
    ticketViewers.delete(ticketId);
  }
}

function removeViewerFromAll(socketId: string) {
  const affectedTickets: string[] = [];
  for (const [ticketId, viewers] of ticketViewers) {
    if (viewers.has(socketId)) {
      viewers.delete(socketId);
      affectedTickets.push(ticketId);
      if (viewers.size === 0) {
        ticketViewers.delete(ticketId);
      }
    }
  }
  return affectedTickets;
}

function getViewers(ticketId: string): Array<{ userId: string; userName: string }> {
  const viewers = ticketViewers.get(ticketId);
  if (!viewers) return [];
  // Deduplicate by userId (same user may have multiple sockets)
  const seen = new Map<string, { userId: string; userName: string }>();
  for (const entry of viewers.values()) {
    if (!seen.has(entry.userId)) {
      seen.set(entry.userId, entry);
    }
  }
  return Array.from(seen.values());
}

function broadcastViewers(io: Server, ticketId: string) {
  const viewers = getViewers(ticketId);
  io.to(`ticket:${ticketId}`).emit('ticket:viewers', { ticketId, viewers });
}

export function broadcastPartnerDeactivation(partnerId: string) {
  if (ioInstance) {
    ioInstance.to(`partner:${partnerId}`).emit('partner:deactivated', { partnerId });
  }
}

export function broadcastUserDeactivation(userId: string) {
  if (ioInstance) {
    logger.info({ userId }, '[socket] Broadcasting user deactivation kill switch');
    ioInstance.to(`user:${userId}`).emit('user:deactivated', { userId });
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
  // Between checks, a revoked session can still operate, but this limits the window.
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
        userId: string; role: string; jti?: string; iat?: number; exp?: number;
        isPlatformOperator?: boolean;
      };

      const revoked = await isRevoked({ userId: decoded.userId, jti: decoded.jti, iat: decoded.iat });
      if (revoked) {
        return next(new Error('Session revoked'));
      }

      // Attach verified identity to socket data
      socket.data.authedUserId = decoded.userId;
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

      await presenceService.identifyUser(userId, effectiveRole, name, partnerId, !!socket.data.authedIsPlatformOperator);
      
      // Join partner-specific room for broadcasts
      socket.join(`partner:${partnerId}`);
      
      // Join private user room for individual kill switches
      socket.join(`user:${userId}`);

      if (canUseSupportWorkflows(effectiveRole, !!socket.data.authedIsPlatformOperator)) {
        await presenceService.broadcastOnlineSupport(partnerId);
      }
      
      if (effectiveRole === 'agent') {
        broadcastAgentStatus(userId, true);
      }

      // Re-join active ticket rooms
      try {
        let activeTickets: { id: string }[] = [];
        if (effectiveRole === 'agent') {
          activeTickets = await query("SELECT id FROM tickets WHERE agent_id = $1 AND partner_id = $2 AND status != 'closed'", [userId, partnerId]) as { id: string }[];
        } else if (canUseSupportWorkflows(effectiveRole, !!socket.data.authedIsPlatformOperator)) {
          activeTickets = await query("SELECT id FROM tickets WHERE (support_id = $1 OR participants::jsonb @> $3::jsonb) AND partner_id = $2 AND status != 'closed'", [userId, partnerId, JSON.stringify([{ id: userId }])]) as { id: string }[];
        }
        for (const t of activeTickets) socket.join(`ticket:${t.id}`);
      } catch (err: unknown) { logger.error({ err: err instanceof Error ? err.message : String(err) }, '[socket:identify] failed to rejoin ticket rooms'); }
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
          const recentClosed = await query('SELECT id, reopen_count, "references" FROM tickets WHERE partner_id = $1 AND status = \'closed\' ORDER BY created_at DESC LIMIT 100', [partnerId]) as unknown as Array<{ id: string; reopen_count: number; references: string | Array<{ label: string; value: string }> | null }>;
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

        socket.join(`ticket:${ticket.id}`);
        socket.emit('ticket:created:self', { ticket: { ...ticketWithSla, participants: [], labels: [] }, message });
        io.to(`partner:${partnerId}`).emit('ticket:created', { ticket: { ...ticketWithSla, participants: [], labels: [] }, firstMessage: message });
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
        if (!canUseSupportWorkflows(callerRole as UserRole, !!socket.data.authedIsPlatformOperator)) {
          return socket.emit('error', { message: 'Not authorized to join tickets' });
        }

        const ticket = await get('SELECT id, partner_id, support_id, support_name, support_lang, support_joined_at, status, participants FROM tickets WHERE id = $1', [ticketId]) as unknown as TicketRow | undefined;
        if (!ticket) return;

        // Tenant isolation: ticket must belong to caller's partner
        if (ticket.partner_id !== callerPartnerId) {
          return socket.emit('error', { message: 'Not authorized for this ticket' });
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
        socket.join(`ticket:${ticketId}`);
        const messages = (await query('SELECT * FROM messages WHERE ticket_id = $1 ORDER BY created_at ASC', [ticketId]) as unknown as Parameters<typeof mapMessageRow>[0][]).map(mapMessageRow);
        socket.emit('ticket:history', { ticketId, messages, labels: (await query('SELECT label_id FROM ticket_labels WHERE ticket_id = $1', [ticketId]) as unknown as TicketLabelRow[]).map((l) => l.labelId) });
        io.to(`ticket:${ticketId}`).emit('support:joined', { ticketId, supportName, participants });
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

        let participants = JSON.parse(ticket.participants || '[]');
        participants = participants.filter((p: Participant) => p.id !== supportId);
        await run('UPDATE tickets SET participants = $1 WHERE id = $2', [JSON.stringify(participants), ticketId]);
        socket.leave(`ticket:${ticketId}`);
        io.to(`ticket:${ticketId}`).emit('support:left', { ticketId, supportId, supportName, participants });
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
        if (!canUseSupportWorkflows(callerRole as UserRole, !!socket.data.authedIsPlatformOperator)) {
          return socket.emit('error', { message: 'Only support staff can close tickets' });
        }

        const ticket = await get('SELECT partner_id FROM tickets WHERE id = $1', [ticketId]) as { partner_id: string } | undefined;
        if (!ticket) return;

        // Tenant isolation: ticket must belong to caller's partner
        if (ticket.partner_id !== socket.data.partnerId) {
          return socket.emit('error', { message: 'Not authorized for this ticket' });
        }

        // Limit closing notes length to prevent abuse
        const sanitizedNotes = closingNotes ? closingNotes.slice(0, 2000) : '';
        const now = new Date().toISOString();
        await run('UPDATE tickets SET status = $1, closed_at = $2, closed_by = $3, closing_notes = $4 WHERE id = $5', ['closed', now, senderName || 'System', sanitizedNotes, ticketId]);
        io.to(`ticket:${ticketId}`).emit('ticket:closed', { ticketId, status: 'closed', closedAt: now, closedBy: senderName || 'System' });
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

        // Prevent duplicate ratings per ticket
        const existing = await get('SELECT id FROM ratings WHERE ticket_id = $1', [ticketId]) as { id: string } | undefined;
        if (existing) {
          logger.info({ ticketId }, '[rating:submit] Rating already exists, ignoring');
          return;
        }

        const id = uuidv4();
        const safeComment = comment ? comment.slice(0, 2000) : null;
        await run(
          'INSERT INTO ratings (id, ticket_id, agent_id, support_id, rating, comment) VALUES ($1, $2, $3, $4, $5, $6)',
          [id, ticketId, agentId, supportId, intRating, safeComment]
        );
        io.to(`ticket:${ticketId}`).emit('rating:submitted', { ticketId, agentId, supportId, rating: intRating });
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

        const sender = (await get('SELECT u.name, m.role, u.lang FROM users u JOIN memberships m ON u.id = m.user_id WHERE u.id = $1 AND m.partner_id = $2', [senderId, ticket.partner_id])) as unknown as SenderInfo;

        logger.info({ senderFound: !!sender, role: sender?.role }, '[message:send] Sender lookup');
        if (!sender) return logger.error({ senderId }, '[message:send] sender not found or no membership for ticket partner');

        // Authorization: only support/admin can send whispers
        const isWhisper = whisper && canUseSupportWorkflows(sender.role as UserRole, !!socket.data.authedIsPlatformOperator);
        if (whisper && !isWhisper) {
          logger.warn({ senderId, role: sender.role }, '[message:send] Non-support user attempted whisper');
        }

        const messageId = uuidv4();
        const now = new Date().toISOString();
        await run(`INSERT INTO messages (id, ticket_id, sender_id, sender_name, sender_role, sender_lang, text, media_url, whisper, system, created_at, reactions) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`, [messageId, ticketId, senderId, sender.name, sender.role, sender.lang, text, mediaUrl || null, isWhisper ? 1 : 0, 0, now, '{}']);
        io.to(`ticket:${ticketId}`).emit('message:new', { id: messageId, ticketId, senderId, senderName: sender.name, senderRole: sender.role, senderLang: sender.lang, text: text, originalText: text, mediaUrl, whisper: !!isWhisper, system: false, timestamp: now, createdAt: now, reactions: {} });
        logger.info({ messageId }, '[message:send] Emitted message:new');
        // Invalidate cached AI summary for this ticket (fire-and-forget)
        invalidateSummary(ticketId).catch(() => {});
        // Fire-and-forget sentiment scoring (skip whispers — internal notes shouldn't affect sentiment)
        if (!isWhisper) {
          scoreSentiment(ticket.partner_id, senderId, messageId, text).catch(() => {});
        }
      } catch (err: unknown) { logger.error({ err: err instanceof Error ? err.message : String(err) }, '[message:send] error'); }
    });

    socket.on('typing:start', ({ ticketId }: { ticketId: string, senderName?: string }) => {
      if (!requireIdentified(socket)) return;
      // Only emit if socket is actually in the ticket room (i.e., is a participant)
      if (!ticketId || !socket.rooms.has(`ticket:${ticketId}`)) return;
      socket.to(`ticket:${ticketId}`).emit('typing:update', { ticketId, senderName: socket.data.name, typing: true });
    });

    socket.on('typing:stop', ({ ticketId }: { ticketId: string, senderName?: string }) => {
      if (!requireIdentified(socket)) return;
      if (!ticketId || !socket.rooms.has(`ticket:${ticketId}`)) return;
      socket.to(`ticket:${ticketId}`).emit('typing:update', { ticketId, senderName: socket.data.name, typing: false });
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
        io.to(`ticket:${ticketId}`).emit('message:status', { messageId, ticketId, status: 'delivered', timestamp: now });
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
        const MAX_BATCH = 100;
        const limitedIds = messageIds.slice(0, MAX_BATCH);
        const now = new Date().toISOString();

        // Batch update: scope to ticket_id for safety
        if (limitedIds.length > 0) {
          const placeholders = limitedIds.map((_, i) => `$${i + 3}`).join(',');
          await run(`UPDATE messages SET read_at = $1 WHERE ticket_id = $2 AND id IN (${placeholders}) AND read_at IS NULL`, [now, ticketId, ...limitedIds]);
        }

        // Broadcast status for each message
        for (const messageId of limitedIds) {
          io.to(`ticket:${ticketId}`).emit('message:status', { messageId, ticketId, status: 'read', timestamp: now });
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
        if (newText.trim().length > 10000) return socket.emit('error', { message: 'Message too long' });

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
        const MAX_EDIT_WINDOW = 15 * 60 * 1000; // 15 minutes
        if (ageMs > MAX_EDIT_WINDOW) return socket.emit('error', { message: 'Edit window has expired (15 min)' });

        const now = new Date().toISOString();
        await run('UPDATE messages SET text = $1, edited_at = $2 WHERE id = $3', [newText.trim(), now, messageId]);

        io.to(`ticket:${ticketId}`).emit('message:edited', { ticketId, messageId, text: newText.trim(), editedAt: now });
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
        if (!canUseSupportWorkflows(callerRole as UserRole, !!socket.data.authedIsPlatformOperator) && msg.sender_id !== senderId) {
          return socket.emit('error', { message: 'Can only delete your own messages' });
        }
        if (msg.system) return socket.emit('error', { message: 'Cannot delete system messages' });
        if (msg.deleted_at) return; // Already deleted

        const now = new Date().toISOString();
        await run('UPDATE messages SET deleted_at = $1, text = $2 WHERE id = $3', [now, '', messageId]);

        io.to(`ticket:${ticketId}`).emit('message:deleted', { ticketId, messageId, deletedAt: now });
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

        if (!canUseSupportWorkflows(callerRole as UserRole, !!socket.data.authedIsPlatformOperator)) {
          return socket.emit('error', { message: 'Only support staff can transfer tickets' });
        }

        const ticket = await get('SELECT id, partner_id, support_id, support_name, participants FROM tickets WHERE id = $1', [ticketId]) as unknown as TicketRow | undefined;
        if (!ticket) return socket.emit('error', { message: 'Ticket not found' });
        if (ticket.partner_id !== callerPartnerId) return socket.emit('error', { message: 'Not authorized' });

        const now = new Date().toISOString();

        if (targetSupportId) {
          // Transfer to a specific support agent
          const targetUser = await get('SELECT u.name FROM users u JOIN memberships m ON u.id = m.user_id WHERE u.id = $1 AND m.partner_id = $2', [targetSupportId, callerPartnerId]) as { name: string } | undefined;
          if (!targetUser) return socket.emit('error', { message: 'Target user not found or not a member of this partner' });

          // Update ticket assignment
          await run('UPDATE tickets SET support_id = $1, support_name = $2 WHERE id = $3', [targetSupportId, targetUser.name, ticketId]);

          // Add system message
          const sysId = uuidv4();
          const sysText = `Ticket transferred from ${senderName} to ${targetUser.name}`;
          await run(`INSERT INTO messages (id, ticket_id, sender_id, sender_name, sender_role, sender_lang, text, whisper, system, created_at, reactions) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`, [sysId, ticketId, '__system__', 'System', 'admin', 'en', sysText, 0, 1, now, '{}']);

          io.to(`ticket:${ticketId}`).emit('message:new', { id: sysId, ticketId, senderId: '__system__', senderName: 'System', senderRole: 'admin', senderLang: 'en', text: sysText, originalText: sysText, whisper: false, system: true, timestamp: now, createdAt: now, reactions: {} });
          io.to(`ticket:${ticketId}`).emit('ticket:transferred', { ticketId, fromId: senderId, fromName: senderName, toId: targetSupportId, toName: targetUser.name });

          // Notify the target support agent via partner room
          io.to(`partner:${callerPartnerId}`).emit('ticket:assigned', { ticketId, supportId: targetSupportId, supportName: targetUser.name });
        } else {
          // Return to queue — unassign support
          await run('UPDATE tickets SET support_id = NULL, support_name = NULL, status = $1 WHERE id = $2', ['open', ticketId]);

          const sysId = uuidv4();
          const sysText = `${senderName} returned ticket to queue`;
          await run(`INSERT INTO messages (id, ticket_id, sender_id, sender_name, sender_role, sender_lang, text, whisper, system, created_at, reactions) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`, [sysId, ticketId, '__system__', 'System', 'admin', 'en', sysText, 0, 1, now, '{}']);

          io.to(`ticket:${ticketId}`).emit('message:new', { id: sysId, ticketId, senderId: '__system__', senderName: 'System', senderRole: 'admin', senderLang: 'en', text: sysText, originalText: sysText, whisper: false, system: true, timestamp: now, createdAt: now, reactions: {} });
          io.to(`ticket:${ticketId}`).emit('ticket:transferred', { ticketId, fromId: senderId, fromName: senderName, toId: null, toName: null });

          await broadcastQueuePositions(callerPartnerId);
        }

        // Remove sender from the ticket room
        socket.leave(`ticket:${ticketId}`);
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
        io.to(`ticket:${ticketId}`).emit('ticket:labels:updated', { ticketId, labels });
      } catch (err: unknown) {
        logger.error({ err: err instanceof Error ? err.message : String(err), ticketId }, '[ticket:labels:update] error');
      }
    });

    // ── Collision Detection: ticket viewing ───────────────────────────────────
    socket.on('ticket:viewing', async ({ ticketId }: { ticketId: string }) => {
      if (!requireIdentified(socket)) return;
      const callerRole = socket.data.role;
      if (!canUseSupportWorkflows(callerRole as UserRole, !!socket.data.authedIsPlatformOperator)) return;
      if (!ticketId) return;

      // Tenant isolation: verify ticket belongs to caller's partner
      const ticket = await get('SELECT partner_id FROM tickets WHERE id = $1', [ticketId]) as { partner_id: string } | undefined;
      if (!ticket || ticket.partner_id !== socket.data.partnerId) return;

      const userId = socket.data.userId as string;
      const userName = socket.data.name as string;

      // Join the socket room if not already in it
      if (!socket.rooms.has(`ticket:${ticketId}`)) {
        socket.join(`ticket:${ticketId}`);
      }

      addViewer(ticketId, socket.id, userId, userName);
      broadcastViewers(io, ticketId);
    });

    socket.on('ticket:left', ({ ticketId }: { ticketId: string }) => {
      if (!requireIdentified(socket)) return;
      if (!ticketId) return;
      removeViewer(ticketId, socket.id);
      broadcastViewers(io, ticketId);
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
      const affectedTickets = removeViewerFromAll(socket.id);
      for (const ticketId of affectedTickets) {
        broadcastViewers(io, ticketId);
      }

      if (userId && partnerId) {
        const result = await presenceService.decrementUserCount(userId, partnerId);
        if (result && result.removed && result.role === 'agent') {
          broadcastAgentStatus(userId, false);
        }
      }
    });
  });

  // Periodic cleanup of stale viewer entries (every 5 minutes)
  // .unref() prevents this timer from keeping the process alive on shutdown
  setInterval(() => {
    for (const [ticketId, viewers] of ticketViewers) {
      for (const [socketId] of viewers) {
        if (!io.sockets.sockets.has(socketId)) {
          viewers.delete(socketId);
        }
      }
      if (viewers.size === 0) ticketViewers.delete(ticketId);
    }
  }, 5 * 60 * 1000).unref();
}
