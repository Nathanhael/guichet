import { Server, Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import * as presenceService from '../services/presence.js';
import { query, get, run, transaction } from '../db.js';
import { getBusinessHoursStatus, broadcastQueuePositions, broadcastAgentStatus } from '../services/businessHours.js';
import logger from '../utils/logger.js';
import { Ticket, Message, User } from '../types/index.js';
import { socketioConnectionsActive, socketioEventsTotal } from '../utils/metrics.js';
import { isValidMediaUrl } from '../utils/security.js';
import { mapMessageRow } from '../utils/messageMapper.js';

interface TicketNewPayload {
  agentId: string;
  agentLang: string;
  dept: string;
  references?: Array<{ label: string; value: string }>;
  text?: string;
  mediaUrl?: string;
}

interface SupportJoinPayload {
  ticketId: string;
  supportId: string;
  supportName: string;
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

export function registerSocketHandlers(io: Server) {
  ioInstance = io;
  io.on('connection', (socket: Socket) => {
    logger.info({ socketId: socket.id }, '[socket] connected');
    socketioConnectionsActive.inc();

    socket.on('socket:identify', async ({ userId, role, name, partnerId }: { userId: string, role: string, name: string, partnerId: string }) => {
      // Validate that user has a membership for the requested partner
      const membership = await get('SELECT role FROM memberships WHERE user_id = $1 AND partner_id = $2', [userId, partnerId]) as { role: string } | undefined;
      let effectiveRole: string;
      if (!membership) {
        // No membership — check if user is a platform operator
        const userRow = await get('SELECT is_platform_operator FROM users WHERE id = $1', [userId]) as { is_platform_operator: boolean } | undefined;
        if (!userRow?.is_platform_operator) {
          socket.emit('error', { message: 'Not authorized for this partner' });
          socket.disconnect();
          return;
        }
        effectiveRole = 'admin';
      } else {
        effectiveRole = membership.role;
      }

      socket.data.userId = userId;
      socket.data.role = effectiveRole;
      socket.data.name = name;
      socket.data.partnerId = partnerId;

      await presenceService.identifyUser(userId, effectiveRole, name, partnerId);
      
      // Join partner-specific room for broadcasts
      socket.join(`partner:${partnerId}`);
      
      // Join private user room for individual kill switches
      socket.join(`user:${userId}`);

      if (effectiveRole === 'support' || effectiveRole === 'admin') {
        await presenceService.broadcastOnlineSupport(partnerId);
      }
      
      if (role === 'agent') {
        broadcastAgentStatus(userId, true);
      }

      // Re-join active ticket rooms
      try {
        let activeTickets: { id: string }[] = [];
        if (role === 'agent') {
          activeTickets = await query("SELECT id FROM tickets WHERE agent_id = $1 AND partner_id = $2 AND status != 'closed'", [userId, partnerId]) as { id: string }[];
        } else if (role === 'support' || role === 'admin') {
          activeTickets = await query("SELECT id FROM tickets WHERE (support_id = $1 OR participants::jsonb @> $3::jsonb) AND partner_id = $2 AND status != 'closed'", [userId, partnerId, JSON.stringify([{ id: userId }])]) as { id: string }[];
        }
        for (const t of activeTickets) socket.join(`ticket:${t.id}`);
      } catch (err: unknown) { logger.error({ err: err instanceof Error ? err.message : String(err) }, '[socket:identify] failed to rejoin ticket rooms'); }
    });

    socket.on('ticket:new', async (data: TicketNewPayload) => {
      socketioEventsTotal.inc({ event: 'ticket:new' });

      const partnerId = socket.data.partnerId;
      const partnerRow = partnerId ? await get('SELECT status, business_hours_schedule, business_hours_start, business_hours_end, business_hours_timezone FROM partners WHERE id = $1', [partnerId]) as { status: string; business_hours_schedule: unknown; business_hours_start: string | null; business_hours_end: string | null; business_hours_timezone: string | null } | undefined : null;
      
      if (partnerRow && partnerRow.status !== 'active') {
        return socket.emit('error', { message: 'Partner is currently inactive.' });
      }

      const partnerHours = partnerRow ? {
        businessHoursSchedule: partnerRow.business_hours_schedule as any,
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
        const { agentId, agentLang, dept, references = [], text, mediaUrl } = data;
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
        socket.join(`ticket:${ticket.id}`);
        socket.emit('ticket:created:self', { ticket: { ...ticket, participants: [], labels: [] }, message });
        io.to(`partner:${partnerId}`).emit('ticket:created', { ticket: { ...ticket, participants: [], labels: [] }, firstMessage: message });
        await broadcastQueuePositions();
      } catch (err: unknown) { logger.error({ err: err instanceof Error ? err.message : String(err) }, '[ticket:new] error'); }
    });

    socket.on('support:join', async ({ ticketId, supportId, supportName, supportLang }: SupportJoinPayload) => {
      socketioEventsTotal.inc({ event: 'support:join' });
      try {
        const ticket = await get('SELECT id, partner_id, support_id, support_name, support_lang, support_joined_at, status, participants FROM tickets WHERE id = $1', [ticketId]) as unknown as TicketRow | undefined;
        if (!ticket) return;
        const participants = JSON.parse(ticket.participants || '[]');
        if (!participants.find((p: Participant) => p.id === supportId)) participants.push({ id: supportId, name: supportName });
        await run('UPDATE tickets SET support_id = $1, support_name = $2, support_lang = $3, support_joined_at = $4, participants = $5, status = $6 WHERE id = $7', [ticket.support_id || supportId, ticket.support_name || supportName, ticket.support_lang || supportLang, ticket.support_joined_at || new Date().toISOString(), JSON.stringify(participants), 'active', ticketId]);
        socket.join(`ticket:${ticketId}`);
        const messages = (await query('SELECT * FROM messages WHERE ticket_id = $1 ORDER BY created_at ASC', [ticketId]) as unknown as Record<string, unknown>[]).map(mapMessageRow);
        socket.emit('ticket:history', { ticketId, messages, labels: (await query('SELECT label_id FROM ticket_labels WHERE ticket_id = $1', [ticketId]) as unknown as TicketLabelRow[]).map((l) => l.labelId) });
        io.to(`ticket:${ticketId}`).emit('support:joined', { ticketId, supportName, participants });
        await broadcastQueuePositions();
      } catch (err: unknown) { logger.error({ err: err instanceof Error ? err.message : String(err) }, '[support:join] error'); }
    });

    socket.on('status:set', async ({ status }: { status: string }) => {
      const userId = socket.data.userId;
      const partnerId = socket.data.partnerId;
      if (userId && partnerId) {
        await presenceService.setUserStatus(userId, partnerId, status);
      }
    });

    socket.on('support:leave', async ({ ticketId, supportId, supportName }: SupportLeavePayload) => {
      socketioEventsTotal.inc({ event: 'support:leave' });
      try {
        const ticket = await get('SELECT participants FROM tickets WHERE id = $1', [ticketId]) as unknown as TicketParticipantsRow | undefined;
        if (!ticket) return;
        let participants = JSON.parse(ticket.participants || '[]');
        participants = participants.filter((p: Participant) => p.id !== supportId);
        await run('UPDATE tickets SET participants = $1 WHERE id = $2', [JSON.stringify(participants), ticketId]);
        socket.leave(`ticket:${ticketId}`);
        io.to(`ticket:${ticketId}`).emit('support:left', { ticketId, supportId, supportName, participants });
      } catch (err: unknown) { logger.error({ err: err instanceof Error ? err.message : String(err) }, '[support:leave] error'); }
    });

    socket.on('ticket:close', async ({ ticketId, closingNotes }: Omit<TicketClosePayload, 'closedBy'>) => {
      socketioEventsTotal.inc({ event: 'ticket:close' });
      try {
        const senderId = socket.data.userId;
        const senderName = socket.data.name;
        if (!senderId) return socket.emit('error', { message: 'Not authenticated' });

        const ticket = await get('SELECT partner_id FROM tickets WHERE id = $1', [ticketId]) as { partner_id: string } | undefined;
        if (!ticket) return;

        const membership = await get('SELECT role FROM memberships WHERE user_id = $1 AND partner_id = $2', [senderId, ticket.partner_id]) as { role: string } | undefined;
        if (!membership) return socket.emit('error', { message: 'Not authorized for this ticket' });

        const now = new Date().toISOString();
        await run('UPDATE tickets SET status = $1, closed_at = $2, closed_by = $3, closing_notes = $4 WHERE id = $5', ['closed', now, senderName || 'System', closingNotes || '', ticketId]);
        io.to(`ticket:${ticketId}`).emit('ticket:closed', { ticketId, status: 'closed', closedAt: now, closedBy: senderName || 'System' });
        await broadcastQueuePositions();
      } catch (err: unknown) { logger.error({ err: err instanceof Error ? err.message : String(err) }, '[ticket:close] error'); }
    });

    socket.on('message:send', async ({ ticketId, text, mediaUrl, whisper }: Omit<MessageSendPayload, 'senderId'>) => {
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
        
        const sender = (await get('SELECT u.name, m.role, u.lang FROM users u JOIN memberships m ON u.id = m.user_id WHERE u.id = $1 AND m.partner_id = $2', [senderId, ticket.partner_id])) as unknown as SenderInfo;
        
        logger.info({ senderFound: !!sender, role: sender?.role }, '[message:send] Sender lookup');
        if (!sender) return logger.error({ senderId }, '[message:send] sender not found or no membership for ticket partner');

        const messageId = uuidv4();
        const now = new Date().toISOString();
        await run(`INSERT INTO messages (id, ticket_id, sender_id, sender_name, sender_role, sender_lang, text, media_url, whisper, system, created_at, reactions) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`, [messageId, ticketId, senderId, sender.name, sender.role, sender.lang, text, mediaUrl || null, whisper ? 1 : 0, 0, now, '{}']);
        io.to(`ticket:${ticketId}`).emit('message:new', { id: messageId, ticketId, senderId, senderName: sender.name, senderRole: sender.role, senderLang: sender.lang, text: text, originalText: text, mediaUrl, whisper: !!whisper, system: false, timestamp: now, createdAt: now, reactions: {} });
        logger.info({ messageId }, '[message:send] Emitted message:new');
      } catch (err: unknown) { logger.error({ err: err instanceof Error ? err.message : String(err) }, '[message:send] error'); }
    });

    socket.on('typing:start', ({ ticketId, senderName }: { ticketId: string, senderName: string }) => {
      socket.to(`ticket:${ticketId}`).emit('typing:update', { ticketId, senderName, typing: true });
    });

    socket.on('typing:stop', ({ ticketId, senderName }: { ticketId: string, senderName: string }) => {
      socket.to(`ticket:${ticketId}`).emit('typing:update', { ticketId, senderName, typing: false });
    });

    socket.on('message:delivered', async ({ ticketId, messageId }: { ticketId: string, messageId: string }) => {
      if (!ticketId || !messageId) return;
      const now = new Date().toISOString();
      await run('UPDATE messages SET delivered_at = $1 WHERE id = $2 AND delivered_at IS NULL', [now, messageId]);
      io.to(`ticket:${ticketId}`).emit('message:status', { messageId, ticketId, status: 'delivered', timestamp: now });
    });

    socket.on('message:read', async ({ ticketId, messageIds }: { ticketId: string, messageIds: string[] }) => {
      if (!ticketId || !messageIds?.length) return;
      const now = new Date().toISOString();
      for (const messageId of messageIds) {
        await run('UPDATE messages SET read_at = $1 WHERE id = $2 AND read_at IS NULL', [now, messageId]);
        io.to(`ticket:${ticketId}`).emit('message:status', { messageId, ticketId, status: 'read', timestamp: now });
      }
    });

    socket.on('ticket:labels:update', async ({ ticketId, labels }: { ticketId: string, labels: string[] }) => {
      try {
        if (!ticketId || !Array.isArray(labels)) return;
        const senderId = socket.data.userId;
        if (!senderId) return socket.emit('error', { message: 'Not authenticated' });

        const ticket = await get('SELECT partner_id FROM tickets WHERE id = $1', [ticketId]) as { partner_id: string } | undefined;
        if (!ticket) return;

        const membership = await get('SELECT role FROM memberships WHERE user_id = $1 AND partner_id = $2', [senderId, ticket.partner_id]) as { role: string } | undefined;
        if (!membership) return socket.emit('error', { message: 'Not authorized for this ticket' });

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

    socket.on('disconnect', async () => {
      socketioConnectionsActive.dec();
      const userId = socket.data.userId;
      const partnerId = socket.data.partnerId;
      if (userId && partnerId) {
        const result = await presenceService.decrementUserCount(userId, partnerId);
        if (result && result.removed && result.role === 'agent') {
          broadcastAgentStatus(userId, false);
        }
      }
    });
  });
}
