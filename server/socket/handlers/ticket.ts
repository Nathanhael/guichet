import { Socket } from 'socket.io';
import { z } from 'zod';
import logger from '../../utils/logger.js';
import { Rooms } from '../../utils/rooms.js';
import { isValidMediaUrl } from '../../utils/security.js';
import { requirePartnerScope, requirePartnerScopeWith } from '../partnerScope.js';
import {
  findTicketForClose,
  findTicketForTransfer,
  findPartnerLabels,
  createTicket,
  closeTicket,
  returnTicketToQueue,
  replaceTicketLabels,
  findRecentClosedTickets,
  findActiveTicketsForAgent,
} from '../../services/ticketQueries.js';
import { getBusinessHoursStatus, broadcastQueuePositions, BusinessHoursSchedule } from '../../services/businessHours.js';
import { findPartnerConfig } from '../../services/partnerQueries.js';
import { findUserName, findSenderInfo } from '../../services/userQueries.js';
import { insertMessage } from '../../services/messageQueries.js';
import { autoSummarizeOnClose } from '../../services/ai/index.js';
import { insertSystemMessage, insertWhisperMessage } from '../../services/systemMessage.js';
import { findPartnerDepartments, transferTicketToDepartment } from '../../services/transferService.js';
import {
  auditTicketCreated,
  auditTicketClosed,
  auditTicketTransferred,
  auditTicketReturnedToQueue,
} from '../../services/ticketAudit.js';
import {
  MAX_NOTE_LENGTH,
  MAX_LABELS_PER_TICKET,
  RECENT_CLOSED_TICKETS_LIMIT,
} from '../../constants.js';
import {
  requireIdentified,
  socketioEventsTotal,
  validatePayload,
  ticketNewSchema,
  ticketCloseSchema,
  ticketTransferSchema,
  type HandlerContext,
} from './types.js';
import { Ticket } from '../../types/index.js';

export function register(socket: Socket, ctx: HandlerContext): void {
  const { io } = ctx;

    socket.on('ticket:new', async (data: unknown) => {
      if (!requireIdentified(socket)) return;
      const parsed = validatePayload(socket, ticketNewSchema, data);
      if (!parsed) {
        logger.warn({ socketId: socket.id, userId: socket.data.userId }, '[ticket:new] payload validation failed');
        return;
      }
      if (socket.data.role !== 'agent') {
        logger.warn({ socketId: socket.id, userId: socket.data.userId, role: socket.data.role }, '[ticket:new] rejected — not an agent');
        return socket.emit('error', { message: 'Only agents can create tickets' });
      }
      socketioEventsTotal.inc({ event: 'ticket:new' });

      try {
        const partnerId = socket.data.partnerId;
        const partnerRow = partnerId ? await findPartnerConfig(partnerId) : null;

        if (partnerRow && partnerRow.status !== 'active') {
          logger.warn({ partnerId, status: partnerRow.status }, '[ticket:new] rejected — partner inactive');
          return socket.emit('error', { message: 'Partner is currently inactive.' });
        }

        const partnerHours = partnerRow ? {
          businessHoursSchedule: partnerRow.businessHoursSchedule as BusinessHoursSchedule | null,
        } : undefined;

        const businessHoursStatus = getBusinessHoursStatus(partnerHours);
        if (!businessHoursStatus.isOpen) {
          logger.warn({ partnerId, nextOpen: businessHoursStatus.nextOpenAt }, '[ticket:new] rejected — business hours closed');
          return socket.emit('hours:closed', {
            code: 'BUSINESS_HOURS_CLOSED',
            message: businessHoursStatus.message,
            status: businessHoursStatus,
          });
        }

        const { agentLang, dept, references = [], text, mediaUrl } = parsed;
        const agentId = socket.data.userId; // Server-side identity — never trust client-supplied agentId
        if (!agentId || !agentLang || !dept) {
          logger.warn({ agentId: !!agentId, agentLang: !!agentLang, dept: !!dept }, '[ticket:new] rejected — missing required fields');
          return socket.emit('error', { message: 'Missing required fields' });
        }
        if (!partnerId) {
          logger.warn({ socketId: socket.id }, '[ticket:new] rejected — no partner context');
          return socket.emit('error', { message: 'No partner context' });
        }
        if (mediaUrl && !isValidMediaUrl(mediaUrl)) {
          logger.warn({ mediaUrl }, '[ticket:new] rejected — invalid media URL');
          return socket.emit('error', { message: 'Invalid media URL' });
        }
        // Server-side 1-ticket limit — agents may only have one non-closed ticket
        const existingTickets = await findActiveTicketsForAgent(agentId, partnerId);
        if (existingTickets.length > 0) {
          logger.warn({ agentId, partnerId, existing: existingTickets[0].id }, '[ticket:new] rejected — agent already has an open ticket');
          return socket.emit('error', { message: 'You already have an open ticket' });
        }

        logger.debug({ partnerId, agentId, dept }, '[ticket:new] accepted — creating ticket');

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
        auditTicketCreated({ ticketId: ticket.id, partnerId, actorId: agentId, dept, reopened, reopenCount });

        let message = null;
        if (text?.trim()) {
          message = await insertMessage({
            ticketId: ticket.id,
            senderId: agentId,
            senderName: agentUser?.name || agentId,
            senderRole: 'agent',
            senderLang: agentLang,
            senderIsExternal: !!agentUser?.isExternal,
            text: text,
            mediaUrl: mediaUrl,
          });
        }
        socket.join(Rooms.ticket(ticket.id));
        socket.emit('ticket:created:self', { ticket: { ...ticket, participants: [], labels: [] }, message });
        // Broadcast to staff only — agents must not see other users' tickets (CR-04 socket-layer fix)
        ctx.io.to(Rooms.staff(partnerId)).emit('ticket:created', { ticket: { ...ticket, participants: [], labels: [] }, firstMessage: message });
        await broadcastQueuePositions(partnerId);
      } catch (err: unknown) {
        logger.error({ err: err instanceof Error ? err.message : String(err) }, '[ticket:new] error');
        socket.emit('error', { message: 'Failed to create ticket' });
      }
    });

    socket.on('ticket:close', async (data: unknown) => {
      if (!requireIdentified(socket)) return;
      const closeParsed = validatePayload(socket, ticketCloseSchema, data);
      if (!closeParsed) return;
      const { ticketId, closingNotes } = closeParsed;
      socketioEventsTotal.inc({ event: 'ticket:close' });
      try {
        const senderId = socket.data.userId;
        const senderName = socket.data.name;
        if (!senderId) return socket.emit('error', { message: 'Not authenticated' });

        const ticket = await requirePartnerScopeWith(socket, ticketId, findTicketForClose);
        if (!ticket) return;

        // Authorization: support/admin can close any ticket; agents can close their own
        if (!socket.data.isSupport && ticket.agentId !== senderId) {
          return socket.emit('error', { message: 'Only support staff can close tickets' });
        }

        if (ticket.status === 'closed') {
          return; // Already closed
        }

        // Limit closing notes length to prevent abuse
        const sanitizedNotes = closingNotes ? closingNotes.slice(0, MAX_NOTE_LENGTH) : '';
        const now = await closeTicket(ticketId, senderName || 'System', sanitizedNotes);
        auditTicketClosed({
          ticketId,
          partnerId: ticket.partnerId,
          actorId: senderId,
          closedBy: senderName || 'System',
          hadSupport: !!ticket.supportId,
        });
        ctx.io.to(Rooms.ticket(ticketId)).emit('ticket:closed', { ticketId, status: 'closed', closedAt: now, closedBy: senderName || 'System', supportId: ticket.supportId ?? undefined, supportName: ticket.supportName ?? undefined });
        await broadcastQueuePositions(ticket.partnerId);

        // Fire-and-forget AI auto-summarize
        autoSummarizeOnClose(ticket.partnerId, senderId, ticketId, io).catch(() => {});
      } catch (err: unknown) { logger.error({ err: err instanceof Error ? err.message : String(err) }, '[ticket:close] error'); }
    });

    // ── Ticket Transfer ──────────────────────────────────────────────────────
    socket.on('ticket:transfer', async (data: unknown) => {
      if (!requireIdentified(socket)) return;
      const transferParsed = validatePayload(socket, ticketTransferSchema, data);
      if (!transferParsed) return;
      const { ticketId, departmentId, note } = transferParsed;
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
              !!senderInfo?.isExternal,
            );
            ctx.io.to(Rooms.ticket(ticketId)).emit('message:new', whisperMsg);
          }

          // Update ticket: new department, clear support assignment, re-open
          await transferTicketToDepartment(ticketId, departmentId);
          auditTicketTransferred({
            ticketId,
            partnerId: callerPartnerId,
            actorId: senderId,
            toDepartmentId: departmentId,
            toDepartmentName: targetDept.name,
            fromSupportId: ticket.supportId ?? null,
            note: note?.trim() || undefined,
          });

          // System message
          const sysText = `Ticket transferred to ${targetDept.name} by ${senderName}`;
          const sysMsg = await insertSystemMessage(ticketId, sysText);
          ctx.io.to(Rooms.ticket(ticketId)).emit('message:new', sysMsg);

          const transferPayload = {
            ticketId,
            fromId: senderId,
            fromName: senderName,
            toDepartment: departmentId,
            toDepartmentName: targetDept.name,
          };

          // Emit to ticket room (for the user/agent) AND partner room (for support sidebars)
          ctx.io.to(Rooms.ticket(ticketId)).emit('ticket:transferred', transferPayload);
          ctx.io.to(Rooms.partner(callerPartnerId)).emit('ticket:transferred', transferPayload);

          // Remove ALL support sockets from ticket room
          const ticketRoom = Rooms.ticket(ticketId);
          const socketsInRoom = await ctx.io.in(ticketRoom).fetchSockets();
          for (const s of socketsInRoom) {
            if (s.data.isSupport) s.leave(ticketRoom);
          }

          // Broadcast queue positions for both departments
          await broadcastQueuePositions(callerPartnerId);
        } else {
          // Return to queue — same department, unassign support
          await returnTicketToQueue(ticketId, ticket.supportId ?? undefined);
          auditTicketReturnedToQueue({
            ticketId,
            partnerId: callerPartnerId,
            actorId: senderId,
            fromSupportId: ticket.supportId ?? null,
          });

          const sysText = `${senderName} returned ticket to queue`;
          const sysMsg = await insertSystemMessage(ticketId, sysText);
          ctx.io.to(Rooms.ticket(ticketId)).emit('message:new', sysMsg);
          ctx.io.to(Rooms.ticket(ticketId)).emit('ticket:transferred', {
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

    socket.on('ticket:labels:update', async (data: unknown) => {
      if (!requireIdentified(socket)) return;
      const labelsParsed = validatePayload(socket, z.object({
        ticketId: z.string().min(1),
        labels: z.array(z.string().min(1)).max(MAX_LABELS_PER_TICKET),
      }), data);
      if (!labelsParsed) return;
      const { ticketId, labels } = labelsParsed;
      const role = socket.data.role as string;
      const LABEL_ROLES = ['support', 'admin', 'platform_operator'];
      if (!LABEL_ROLES.includes(role)) {
        return socket.emit('error', { message: 'Not authorized to update labels' });
      }
      try {
        const senderId = socket.data.userId;
        if (!senderId) return socket.emit('error', { message: 'Not authenticated' });

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
        ctx.io.to(Rooms.ticket(ticketId)).emit('ticket:labels:updated', { ticketId, labels });
      } catch (err: unknown) {
        logger.error({ err: err instanceof Error ? err.message : String(err), ticketId }, '[ticket:labels:update] error');
      }
    });
}
