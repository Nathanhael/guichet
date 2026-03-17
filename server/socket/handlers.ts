import { Server, Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import * as presenceService from '../services/presence.js';
import { runGuards } from '../services/guards.js';
import { processMessage } from '../services/translate.js';
import { analyzeSentiment, summarizeConversation } from '../services/llm.js';
import { query, get, run, transaction } from '../db.js';
import { isWithinBusinessHours, broadcastQueuePositions, broadcastAgentStatus } from '../services/businessHours.js';
import logger from '../utils/logger.js';
import { Ticket, Message, User } from '../types/index.js';
import { getRedisClients } from '../utils/redis.js';
import { socketioConnectionsActive, socketioEventsTotal } from '../utils/metrics.js';
import { isValidMediaUrl } from '../utils/security.js';
import { mapMessageRow } from '../utils/messageMapper.js';

interface TicketNewPayload {
  agentId: string;
  agentLang: string;
  dept: string;
  ref1?: string;
  ref2?: string;
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
  cannedResponseId?: string;
}

interface ReactionTogglePayload {
  ticketId: string;
  messageId: string;
  emoji: string;
  userId: string;
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

interface TicketReopenRow {
  id: string;
  reopen_count: number;
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

interface TicketPartnerRow {
  partner_id: string;
}

interface PartnerAIRow {
  ai_enabled: boolean;
}

interface TicketParticipantsRow {
  participants: string;
}

export function registerSocketHandlers(io: Server) {
  io.on('connection', (socket: Socket) => {
    console.log(`[socket] connected: ${socket.id}`);
    socketioConnectionsActive.inc();

    socket.on('socket:identify', async ({ userId, role, name, partnerId }: { userId: string, role: string, name: string, partnerId: string }) => {
      // Validate that user has a membership for the requested partner
      const membership = await get('SELECT role FROM memberships WHERE user_id = $1 AND partner_id = $2', [userId, partnerId]) as { role: string } | undefined;
      if (!membership) {
        socket.emit('error', { message: 'Not authorized for this partner' });
        socket.disconnect();
        return;
      }

      socket.data.userId = userId;
      socket.data.role = membership.role;
      socket.data.name = name;
      socket.data.partnerId = partnerId;

      await presenceService.identifyUser(userId, membership.role, name, partnerId);
      
      // Join partner-specific room for broadcasts
      socket.join(`partner:${partnerId}`);

      if (membership.role === 'support' || membership.role === 'admin') {
        await presenceService.broadcastOnlineSupport(partnerId);
      }
      
      if (role === 'agent') {
        broadcastAgentStatus(userId, true);
        // Re-join active ticket rooms
        try {
          const activeTickets = await query("SELECT id FROM tickets WHERE agent_id = $1 AND partner_id = $2 AND status != 'closed'", [userId, partnerId]);
          for (const t of activeTickets) socket.join(`ticket:${t.id}`);
        } catch (err: unknown) { logger.error({ err: err instanceof Error ? err.message : String(err) }, '[socket:identify] failed to rejoin ticket rooms'); }
      }
    });

    socket.on('ticket:new', async (data: TicketNewPayload) => {
      socketioEventsTotal.inc({ event: 'ticket:new' });

      const partnerId = socket.data.partnerId;
      const partnerRow = partnerId ? await get('SELECT business_hours_start, business_hours_end, business_hours_timezone FROM partners WHERE id = $1', [partnerId]) as { business_hours_start: string | null; business_hours_end: string | null; business_hours_timezone: string | null } | undefined : null;
      const partnerHours = partnerRow ? {
        businessHoursStart: partnerRow.business_hours_start,
        businessHoursEnd: partnerRow.business_hours_end,
        businessHoursTimezone: partnerRow.business_hours_timezone,
      } : undefined;

      if (!isWithinBusinessHours(partnerHours)) return socket.emit('hours:closed', { message: 'The support chat is currently closed.' });
      try {
        const { agentId, agentLang, dept, ref1, ref2, text, mediaUrl } = data;
        if (!agentId || !agentLang || !dept) return socket.emit('error', { message: 'Missing required fields' });
        if (!partnerId) return socket.emit('error', { message: 'No partner context' });
        if (mediaUrl && !isValidMediaUrl(mediaUrl)) return socket.emit('error', { message: 'Invalid media URL' });

        // Re-open detection
        let reopened = false;
        let reopenCount = 0;
        if (ref1 || ref2) {
          const existing = await get('SELECT id, reopen_count FROM tickets WHERE (ref_1 = $1 OR ref_2 = $2) AND partner_id = $3 AND status = $4 ORDER BY created_at DESC LIMIT 1', [ref1 || null, ref2 || null, partnerId, 'closed']) as TicketReopenRow | undefined;
          if (existing) {
            reopened = true;
            reopenCount = (existing.reopen_count || 0) + 1;
          }
        }

        const agentUser = (await get('SELECT name FROM users WHERE id = $1', [agentId])) as unknown as User;
        const ticket: Ticket = { id: uuidv4(), dept, agentId, agentName: agentUser?.name || agentId, agentLang, ref1: ref1 || null, ref2: ref2 || null, status: 'open', supportId: null, createdAt: new Date().toISOString(), participants: '[]' };
        await run('INSERT INTO tickets (id, partner_id, dept, agent_id, agent_name, agent_lang, ref_1, ref_2, status, created_at, participants, reopened, reopen_count) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)', [ticket.id, partnerId, ticket.dept, ticket.agentId, ticket.agentName, ticket.agentLang, ticket.ref1, ticket.ref2, ticket.status, ticket.createdAt, ticket.participants, reopened, reopenCount]);

        let message: Message | null = null;
        if (text?.trim()) {
          const { pubClient } = getRedisClients();
          const guard = await runGuards(pubClient, text, agentId);
          const { processedText, improvedText, translationSkipped, fallback } = await processMessage(guard.text || text, 'agent', partnerId, agentLang, agentLang);
          const messageId = uuidv4();
          const now = new Date().toISOString();
          message = { id: messageId, ticketId: ticket.id, senderId: agentId, senderName: agentUser?.name || agentId, senderRole: 'agent', senderLang: agentLang, originalText: text, improvedText, processedText, text: processedText, whisper: 0, system: 0, translationSkipped, fallback, timestamp: now, createdAt: now, reactions: {} };
          await run(`INSERT INTO messages (id, ticket_id, sender_id, sender_name, sender_role, sender_lang, text, translated_text, media_url, whisper, system, created_at, reactions) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`, [message.id, message.ticketId, message.senderId, message.senderName, message.senderRole, message.senderLang, message.originalText, message.processedText, mediaUrl || null, 0, 0, message.timestamp, '{}']);
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
        const ticket = await get('SELECT * FROM tickets WHERE id = $1', [ticketId]) as TicketRow | undefined;
        if (!ticket) return;
        const participants = JSON.parse(ticket.participants || '[]');
        if (!participants.find((p: Participant) => p.id === supportId)) participants.push({ id: supportId, name: supportName });
        await run('UPDATE tickets SET support_id = $1, support_name = $2, support_lang = $3, support_joined_at = $4, participants = $5, status = $6 WHERE id = $7', [ticket.support_id || supportId, ticket.support_name || supportName, ticket.support_lang || supportLang, ticket.support_joined_at || new Date().toISOString(), JSON.stringify(participants), 'active', ticketId]);
        socket.join(`ticket:${ticketId}`);
        const messages = (await query('SELECT * FROM messages WHERE ticket_id = $1 ORDER BY created_at ASC', [ticketId]) as unknown as any[]).map(mapMessageRow);
        socket.emit('ticket:history', { ticketId, messages, labels: (await query('SELECT label_id FROM ticket_labels WHERE ticket_id = $1', [ticketId]) as unknown as TicketLabelRow[]).map((l) => l.labelId) });
        io.to(`ticket:${ticketId}`).emit('support:joined', { ticketId, supportName, participants });
        await broadcastQueuePositions();
      } catch (err: unknown) { logger.error({ err: err instanceof Error ? err.message : String(err) }, '[support:join] error'); }
    });

    socket.on('status:set', async ({ status }: { status: string }) => {
      const userId = socket.data.userId;
      if (userId) {
        await presenceService.setUserStatus(userId, status);
      }
    });

    socket.on('support:leave', async ({ ticketId, supportId, supportName }: SupportLeavePayload) => {
      socketioEventsTotal.inc({ event: 'support:leave' });
      try {
        const ticket = await get('SELECT participants FROM tickets WHERE id = $1', [ticketId]) as TicketParticipantsRow | undefined;
        if (!ticket) return;
        let participants = JSON.parse(ticket.participants || '[]');
        participants = participants.filter((p: Participant) => p.id !== supportId);
        await run('UPDATE tickets SET participants = $1 WHERE id = $2', [JSON.stringify(participants), ticketId]);
        socket.leave(`ticket:${ticketId}`);
        io.to(`ticket:${ticketId}`).emit('support:left', { ticketId, supportId, supportName, participants });
      } catch (err: unknown) { logger.error({ err: err instanceof Error ? err.message : String(err) }, '[support:leave] error'); }
    });

    socket.on('ticket:close', async ({ ticketId, closedBy, closingNotes }: TicketClosePayload) => {
      socketioEventsTotal.inc({ event: 'ticket:close' });
      try {
        const now = new Date().toISOString();
        await run('UPDATE tickets SET status = $1, closed_at = $2, closed_by = $3, closing_notes = $4 WHERE id = $5', ['closed', now, closedBy || 'System', closingNotes || '', ticketId]);
        io.to(`ticket:${ticketId}`).emit('ticket:closed', { ticketId, status: 'closed', closedAt: now, closedBy: closedBy || 'System' });
        await broadcastQueuePositions();

        // Trigger AI Summary
        const ticket = await get('SELECT partner_id FROM tickets WHERE id = $1', [ticketId]) as TicketPartnerRow | undefined;
        if (ticket) {
          const partner = await get('SELECT ai_enabled FROM partners WHERE id = $1', [ticket.partnerId]) as PartnerAIRow | undefined;
          if (partner?.ai_enabled) {
            summarizeConversation(ticketId, ticket.partnerId).catch(err => {
              logger.error({ err, ticketId }, 'Background summarization failed');
            });
          }
        }
      } catch (err: unknown) { logger.error({ err: err instanceof Error ? err.message : String(err) }, '[ticket:close] error'); }
    });

    socket.on('message:send', async ({ ticketId, senderId, text, mediaUrl, whisper, cannedResponseId }: MessageSendPayload) => {
      socketioEventsTotal.inc({ event: 'message:send' });
      try {
        logger.info({ ticketId, senderId, text }, '[message:send] Received');
        if (!ticketId || !senderId || !text) return;
        if (mediaUrl && !isValidMediaUrl(mediaUrl)) return socket.emit('error', { message: 'Invalid media URL' });
        const ticket = await get('SELECT * FROM tickets WHERE id = $1', [ticketId]) as any;
        logger.info({ ticketFound: !!ticket, status: ticket?.status }, '[message:send] Ticket lookup');
        if (!ticket || ticket.status === 'closed') return;
        
        // Presence is async now
        const sender = (await get('SELECT u.name, m.role, u.lang FROM users u JOIN memberships m ON u.id = m.user_id WHERE u.id = $1 AND m.partner_id = $2', [senderId, ticket.partnerId])) as unknown as SenderInfo;
        
        logger.info({ senderFound: !!sender, role: sender?.role }, '[message:send] Sender lookup');
        if (!sender) return logger.error({ senderId }, '[message:send] sender not found or no membership for ticket partner');

        if (!whisper) {
          const { pubClient } = getRedisClients();
          const guard = await runGuards(pubClient, text, senderId);
          logger.info({ guardOk: guard.ok }, '[message:send] Guards result');
          if (!guard.ok) return socket.emit('message:blocked', { code: guard.code });
          text = guard.text;
        }
        const recipientLang = (sender.role === 'agent') ? ticket.supportLang : ticket.agentLang;
        logger.info({ senderLang: sender.lang, recipientLang }, '[message:send] Processing message via AI');
        const { processedText, improvedText, translationSkipped, fallback } = await processMessage(text, sender.role as 'agent' | 'support', ticket.partnerId, sender.lang, recipientLang || sender.lang);
        logger.info({ processedText, fallback }, '[message:send] AI processed');
        
        const messageId = uuidv4();
        const now = new Date().toISOString();
        await run(`INSERT INTO messages (id, ticket_id, sender_id, sender_name, sender_role, sender_lang, text, translated_text, media_url, whisper, system, created_at, reactions, canned_response_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`, [messageId, ticketId, senderId, sender.name, sender.role, sender.lang, text, processedText, mediaUrl || null, whisper ? 1 : 0, 0, now, '{}', cannedResponseId || null]);
        io.to(`ticket:${ticketId}`).emit('message:new', { id: messageId, ticketId, senderId, senderName: sender.name, senderRole: sender.role, senderLang: sender.lang, text: processedText, originalText: text, improvedText, processedText, mediaUrl, whisper: !!whisper, system: false, timestamp: now, createdAt: now, reactions: {}, translationSkipped, fallback });
        logger.info({ messageId }, '[message:send] Emitted message:new');

        // Background Sentiment Analysis
        if (!whisper && text.length > 5) {
          analyzeSentiment(text).then(score => {
            run('UPDATE messages SET sentiment = $1 WHERE id = $2', [score, messageId]).catch(err => {
              logger.error({ err, messageId }, 'Failed to update message sentiment');
            });
          }).catch(err => {
            logger.error({ err, messageId }, 'Sentiment analysis background task failed');
          });
        }
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

    socket.on('reaction:toggle', async ({ ticketId, messageId, emoji, userId }: ReactionTogglePayload) => {
      try {
        if (!ticketId || !messageId || !emoji || !userId) return;
        const message = (await get('SELECT reactions FROM messages WHERE id = $1', [messageId])) as unknown as Message;
        if (!message) return;

        const reactions = JSON.parse(message.reactions || '{}');
        if (!reactions[emoji]) reactions[emoji] = [];

        const index = reactions[emoji].indexOf(userId);
        if (index > -1) {
          reactions[emoji].splice(index, 1);
          if (reactions[emoji].length === 0) delete reactions[emoji];
        } else {
          reactions[emoji].push(userId);
        }

        const reactionsStr = JSON.stringify(reactions);
        await run('UPDATE messages SET reactions = $1 WHERE id = $2', [reactionsStr, messageId]);
        io.to(`ticket:${ticketId}`).emit('reaction:updated', { ticketId, messageId, reactions });
      } catch (err: unknown) {
        logger.error({ err: err instanceof Error ? err.message : String(err), messageId }, '[reaction:toggle] error');
      }
    });

    socket.on('ticket:labels:update', async ({ ticketId, labels }: { ticketId: string, labels: string[] }) => {
      try {
        if (!ticketId || !Array.isArray(labels)) return;
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
      if (userId) {
        const result = await presenceService.decrementUserCount(userId);
        if (result && result.removed && result.role === 'agent') {
          broadcastAgentStatus(userId, false);
        }
      }
    });
  });
}
