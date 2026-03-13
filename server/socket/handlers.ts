import { Server, Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import * as presenceService from '../services/presence.js';
import { runGuards, resetRepetition } from '../services/guards.js';
import { processMessage } from '../services/translate.js';
import { analyzeSentiment } from '../services/llm.js';
import { query, get, run, transaction } from '../db.js';
import { isWithinBusinessHours, broadcastQueuePositions, broadcastAgentStatus } from '../services/businessHours.js';
import logger from '../utils/logger.js';
import { Ticket, Message, User } from '../types/index.js';

interface TicketNewPayload {
  agentId: string;
  agentLang: string;
  dept: string;
  ref1?: string;
  ref2?: string;
  text?: string;
  mediaUrl?: string;
}

interface ExpertJoinPayload {
  ticketId: string;
  expertId: string;
  expertName: string;
  expertLang: string;
}

interface ExpertLeavePayload {
  ticketId: string;
  expertId: string;
  expertName: string;
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

export function registerSocketHandlers(io: Server) {
  io.on('connection', (socket: Socket) => {
    console.log(`[socket] connected: ${socket.id}`);

    socket.on('socket:identify', async ({ userId, role, name, partnerId }: { userId: string, role: string, name: string, partnerId: string }) => {
      socket.data.userId = userId;
      socket.data.role = role;
      socket.data.name = name;
      socket.data.partnerId = partnerId;
      
      await presenceService.identifyUser(userId, role, name, partnerId);
      
      // Join partner-specific room for broadcasts
      socket.join(`partner:${partnerId}`);

      if (role === 'support' || role === 'expert' || role === 'admin') {
        await presenceService.broadcastOnlineExperts(partnerId);
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
      if (!isWithinBusinessHours()) return socket.emit('hours:closed', { message: 'The support chat is currently closed.' });
      try {
        const { agentId, agentLang, dept, ref1, ref2, text, mediaUrl } = data;
        if (!agentId || !agentLang || !dept) return socket.emit('error', { message: 'Missing required fields' });
        
        const partnerId = socket.data.partnerId;
        if (!partnerId) return socket.emit('error', { message: 'No partner context' });

        // Re-open detection
        let reopened = false;
        let reopenCount = 0;
        if (ref1 || ref2) {
          const existing = await get('SELECT id, reopen_count FROM tickets WHERE (ref_1 = $1 OR ref_2 = $2) AND partner_id = $3 AND status = $4 ORDER BY created_at DESC LIMIT 1', [ref1 || null, ref2 || null, partnerId, 'closed']) as any;
          if (existing) {
            reopened = true;
            reopenCount = (existing.reopen_count || 0) + 1;
          }
        }

        const agentUser = (await get('SELECT name FROM users WHERE id = $1', [agentId])) as unknown as User;
        const ticket: Ticket = { id: uuidv4(), dept, agentId, agentName: agentUser?.name || agentId, agentLang, ref1: ref1 || null, ref2: ref2 || null, status: 'open', expertId: null, createdAt: new Date().toISOString(), participants: '[]' };
        await run('INSERT INTO tickets (id, partner_id, dept, agent_id, agent_name, agent_lang, ref_1, ref_2, status, created_at, participants, reopened, reopen_count) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)', [ticket.id, partnerId, ticket.dept, ticket.agentId, ticket.agentName, ticket.agentLang, ticket.ref1, ticket.ref2, ticket.status, ticket.createdAt, ticket.participants, reopened, reopenCount]);

        let message: Message | null = null;
        if (text?.trim()) {
          const guard = await runGuards(text, agentId);
          message = { id: uuidv4(), ticketId: ticket.id, senderId: agentId, senderName: agentUser?.name || agentId, senderRole: 'agent', senderLang: agentLang, originalText: text, improvedText: guard.text || text, processedText: guard.text || text, whisper: 0, system: 0, translationSkipped: 1, fallback: 0, timestamp: new Date().toISOString(), reactions: '{}' };
          await run(`INSERT INTO messages (id, ticket_id, sender_id, sender_name, sender_role, sender_lang, text, translated_text, media_url, whisper, system, created_at, reactions) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`, [message.id, message.ticketId, message.senderId, message.senderName, 'agent', agentLang, message.originalText, message.processedText, mediaUrl || null, 0, 0, message.timestamp, '{}']);
        }
        socket.join(`ticket:${ticket.id}`);
        socket.emit('ticket:created:self', { ticket: { ...ticket, participants: [], labels: [] }, message });
        io.to(`partner:${partnerId}`).emit('ticket:created', { ticket: { ...ticket, participants: [], labels: [] }, firstMessage: message });
        await broadcastQueuePositions();
      } catch (err: unknown) { logger.error({ err: err instanceof Error ? err.message : String(err) }, '[ticket:new] error'); }
    });

    socket.on('expert:join', async ({ ticketId, expertId, expertName, expertLang }: ExpertJoinPayload) => {
      try {
        const ticket = (await get('SELECT * FROM tickets WHERE id = $1', [ticketId])) as unknown as any;
        if (!ticket) return;
        const participants = JSON.parse(ticket.participants || '[]');
        if (!participants.find((p: Participant) => p.id === expertId)) participants.push({ id: expertId, name: expertName });
        await run('UPDATE tickets SET support_id = $1, support_name = $2, support_lang = $3, support_joined_at = $4, participants = $5, status = $6 WHERE id = $7', [ticket.support_id || expertId, ticket.support_name || expertName, ticket.support_lang || expertLang, ticket.support_joined_at || new Date().toISOString(), JSON.stringify(participants), 'active', ticketId]);
        socket.join(`ticket:${ticketId}`);
        const messages = (await query('SELECT * FROM messages WHERE ticket_id = $1 ORDER BY created_at ASC', [ticketId]) as unknown as Message[]).map(m => ({ ...m, whisper: !!m.whisper, system: !!m.system, reactions: JSON.parse(m.reactions || '{}') }));
        socket.emit('ticket:history', { ticketId, messages, labels: (await query('SELECT label_id FROM ticket_labels WHERE ticket_id = $1', [ticketId]) as unknown as TicketLabelRow[]).map((l) => l.labelId) });
        io.to(`ticket:${ticketId}`).emit('expert:joined', { ticketId, expertName, participants });
        await broadcastQueuePositions();
      } catch (err: unknown) { logger.error({ err: err instanceof Error ? err.message : String(err) }, '[expert:join] error'); }
    });

    socket.on('status:set', async ({ status }: { status: string }) => {
      const userId = socket.data.userId;
      if (userId) {
        await presenceService.setUserStatus(userId, status);
      }
    });

    socket.on('expert:leave', async ({ ticketId, expertId, expertName }: ExpertLeavePayload) => {
      try {
        const ticket = (await get('SELECT participants FROM tickets WHERE id = $1', [ticketId])) as unknown as any;
        if (!ticket) return;
        let participants = JSON.parse(ticket.participants || '[]');
        participants = participants.filter((p: Participant) => p.id !== expertId);
        await run('UPDATE tickets SET participants = $1 WHERE id = $2', [JSON.stringify(participants), ticketId]);
        socket.leave(`ticket:${ticketId}`);
        io.to(`ticket:${ticketId}`).emit('expert:left', { ticketId, expertId, expertName, participants });
      } catch (err: unknown) { logger.error({ err: err instanceof Error ? err.message : String(err) }, '[expert:leave] error'); }
    });

    socket.on('ticket:close', async ({ ticketId, closedBy, closingNotes }: TicketClosePayload) => {
      try {
        const now = new Date().toISOString();
        await run('UPDATE tickets SET status = $1, closed_at = $2, closed_by = $3, closing_notes = $4 WHERE id = $5', ['closed', now, closedBy || 'System', closingNotes || '', ticketId]);
        io.to(`ticket:${ticketId}`).emit('ticket:closed', { ticketId, status: 'closed', closedAt: now, closedBy: closedBy || 'System' });
        await broadcastQueuePositions();

        // Trigger AI Summary
        const ticket = await get('SELECT partner_id FROM tickets WHERE id = $1', [ticketId]) as any;
        if (ticket) {
          const partner = await get('SELECT ai_enabled FROM partners WHERE id = $1', [ticket.partner_id]) as any;
          if (partner?.ai_enabled) {
            summarizeConversation(ticketId, ticket.partner_id).catch(err => {
              logger.error({ err, ticketId }, 'Background summarization failed');
            });
          }
        }
      } catch (err: unknown) { logger.error({ err: err instanceof Error ? err.message : String(err) }, '[ticket:close] error'); }
    });

    socket.on('message:send', async ({ ticketId, senderId, text, mediaUrl, whisper }: MessageSendPayload) => {
      try {
        if (!ticketId || !senderId || !text) return;
        const ticket = (await get('SELECT * FROM tickets WHERE id = $1', [ticketId])) as unknown as any;
        if (!ticket || ticket.status === 'closed') return;
        
        // Presence is async now
        const sender = (await get('SELECT name, role, lang FROM users WHERE id = $1', [senderId])) as unknown as SenderInfo;
        
        if (!whisper) {
          const guard = await runGuards(text, senderId);
          if (!guard.ok) return socket.emit('message:blocked', { code: guard.code });
          text = guard.text;
          resetRepetition(senderId);
        }
        const recipientLang = (sender.role === 'agent') ? ticket.support_lang : ticket.agent_lang;
        const { processedText, improvedText, translationSkipped, fallback } = await processMessage(text, sender.role as 'agent' | 'expert', ticket.partner_id, sender.lang, recipientLang || sender.lang);
        const messageId = uuidv4();
        const now = new Date().toISOString();
        await run(`INSERT INTO messages (id, ticket_id, sender_id, sender_name, text, translated_text, media_url, whisper, system, created_at, reactions) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`, [messageId, ticketId, senderId, sender.name, text, processedText, mediaUrl || null, whisper ? 1 : 0, 0, now, '{}']);
        io.to(`ticket:${ticketId}`).emit('message:new', { id: messageId, ticketId, senderId, senderName: sender.name, senderRole: sender.role, text: processedText, originalText: text, improvedText, mediaUrl, whisper: !!whisper, system: false, timestamp: now, reactions: {}, translationSkipped, fallback });

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
