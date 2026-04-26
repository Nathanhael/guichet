import { Socket } from 'socket.io';
import { z } from 'zod';
import logger from '../../utils/logger.js';
import { Rooms } from '../../utils/rooms.js';
import { requirePartnerScope, requirePartnerScopeWith } from '../partnerScope.js';
import {
  findTicketForClose,
  findTicketForTransfer,
  findPartnerLabels,
  replaceTicketLabels,
} from '../../services/ticketQueries.js';
import { getBusinessHoursStatus, broadcastQueuePositions, BusinessHoursSchedule } from '../../services/businessHours.js';
import { findPartnerConfig } from '../../services/partnerQueries.js';
import { findUserName } from '../../services/userQueries.js';
import { autoSummarizeOnClose } from '../../services/ai/index.js';
import { applyEffects, socketActor } from '../../services/ticketLifecycle/index.js';
import { MAX_LABELS_PER_TICKET } from '../../constants.js';
import {
  requireIdentified,
  socketioEventsTotal,
  validatePayload,
  ticketNewSchema,
  ticketCloseSchema,
  ticketTransferSchema,
  type HandlerContext,
} from './types.js';

export function register(socket: Socket, ctx: HandlerContext): void {
  const { io } = ctx;

    socket.on('ticket:new', async (data: unknown) => {
      if (!requireIdentified(socket)) return;
      const parsed = validatePayload(socket, ticketNewSchema, data);
      if (!parsed) {
        logger.warn({ socketId: socket.id, userId: socket.data.userId }, '[ticket:new] payload validation failed');
        return;
      }
      socketioEventsTotal.inc({ event: 'ticket:new' });

      try {
        const partnerId = socket.data.partnerId;
        const { agentLang, dept, references = [], text, mediaUrl } = parsed;
        if (!agentLang || !dept) {
          logger.warn({ agentLang: !!agentLang, dept: !!dept }, '[ticket:new] rejected — missing required fields');
          return socket.emit('error', { message: 'Missing required fields' });
        }
        if (!partnerId) {
          logger.warn({ socketId: socket.id }, '[ticket:new] rejected — no partner context');
          return socket.emit('error', { message: 'No partner context' });
        }

        // Resolve B2B-guest flag for the actor — denormalized into the
        // first-message row inside the lifecycle txn so historical
        // messages render the GUEST badge without a live presence
        // lookup. Cheap single-row read.
        const agentUser = await findUserName(socket.data.userId);
        const baseActor = socketActor(socket);
        const createActor = { ...baseActor, isExternal: !!agentUser?.isExternal };

        const result = await ctx.lifecycle.create({
          partnerId,
          actor: createActor,
          dept,
          agentLang,
          references,
          text,
          mediaUrl,
        });

        if (!result.ok) {
          switch (result.code) {
            case 'NOT_AUTHORIZED':
              logger.warn({ socketId: socket.id, userId: socket.data.userId, role: socket.data.role }, '[ticket:new] rejected — not an agent');
              return socket.emit('error', { message: 'Only agents can create tickets' });
            case 'PARTNER_NOT_ACTIVE':
              logger.warn({ partnerId }, '[ticket:new] rejected — partner inactive');
              return socket.emit('error', { message: 'Partner is currently inactive.' });
            case 'BUSINESS_HOURS_CLOSED': {
              // Re-evaluate the status here so the client gets the same
              // hours payload the legacy handler emitted (next-open
              // timestamp etc.). The lifecycle has already declined the
              // create — this is a transport-tier hint only.
              const partnerRow = await findPartnerConfig(partnerId);
              const hoursStatus = getBusinessHoursStatus(partnerRow ? {
                businessHoursSchedule: partnerRow.businessHoursSchedule as BusinessHoursSchedule | null,
              } : undefined);
              return socket.emit('hours:closed', {
                code: 'BUSINESS_HOURS_CLOSED',
                message: hoursStatus.message,
                status: hoursStatus,
              });
            }
            case 'INVALID_MEDIA_URL':
              return socket.emit('error', { message: 'Invalid media URL' });
            case 'DUPLICATE_TICKET':
              logger.warn({ agentId: socket.data.userId, partnerId }, '[ticket:new] rejected — agent already has an open ticket');
              return socket.emit('error', { message: 'You already have an open ticket' });
            default:
              return socket.emit('error', { message: 'Failed to create ticket' });
          }
        }

        // Caller-only ack. The lifecycle returned the ticket + first
        // message snapshot so we don't need a re-read.
        socket.join(Rooms.ticket(result.data.ticket.id));
        socket.emit('ticket:created:self', {
          ticket: { ...result.data.ticket, participants: [], labels: [] },
          message: result.data.firstMessage,
        });
        applyEffects(ctx.io, result.effects);
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
        const callerPartnerId = socket.data.partnerId;
        if (!senderId) return socket.emit('error', { message: 'Not authenticated' });

        // Partner-scope guard before the lifecycle — preserves the legacy
        // "Not authorized" wording and saves the lifecycle a round-trip
        // when the ticket is in another tenant. The lifecycle would also
        // refuse with TICKET_NOT_FOUND, but the handler-level check is
        // the canonical "you don't get to see this exists" UX.
        const partnerCheck = await requirePartnerScopeWith(socket, ticketId, findTicketForClose);
        if (!partnerCheck) return;

        const result = await ctx.lifecycle.close({
          ticketId,
          partnerId: callerPartnerId,
          actor: socketActor(socket),
          closingNotes,
        });

        if (!result.ok) {
          switch (result.code) {
            case 'NOT_AUTHORIZED':
              return socket.emit('error', { message: 'Only support staff can close tickets' });
            case 'TICKET_NOT_FOUND':
              return socket.emit('error', { message: 'Ticket not found' });
            case 'TICKET_ALREADY_CLOSED':
              return; // Idempotent — silent no-op preserves legacy UX
            default:
              return;
          }
        }

        applyEffects(ctx.io, result.effects);

        // Fire-and-forget AI auto-summarize — log on failure so an AI-provider
        // outage leaves a trail instead of silently dropping summaries.
        autoSummarizeOnClose(callerPartnerId, senderId, ticketId, io).catch((err) => {
          logger.warn({ err: err instanceof Error ? err.message : String(err), ticketId, partnerId: callerPartnerId }, '[ticket:close] autoSummarize failed (non-fatal)');
        });
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

        const actor = socketActor(socket);

        if (departmentId) {
          // Department-change branch — full transfer.
          const result = await ctx.lifecycle.transfer({
            ticketId,
            partnerId: callerPartnerId,
            actor,
            toDepartmentId: departmentId,
            note,
          });

          if (!result.ok) {
            switch (result.code) {
              case 'NOT_AUTHORIZED':
                return socket.emit('error', { message: 'Only support staff can transfer tickets' });
              case 'DEPARTMENT_NOT_FOUND':
                return socket.emit('error', { message: 'Department not found' });
              case 'TICKET_NOT_FOUND':
                return; // requirePartnerScopeWith already emitted
              default:
                return;
            }
          }

          applyEffects(ctx.io, result.effects);
        } else {
          // Same-department branch — return to queue. Reuses the
          // PR 2 lifecycle.returnToQueue verb so we don't have a
          // second mutation path with its own audit semantics.
          if (!ticket.supportId) {
            return; // Nothing to return — already unassigned.
          }
          const result = await ctx.lifecycle.returnToQueue({
            ticketId,
            partnerId: callerPartnerId,
            actor,
            previousSupportId: ticket.supportId,
            systemMessageText: `${senderName} returned ticket to queue`,
          });

          if (!result.ok) {
            // TICKET_ALREADY_REASSIGNED — race lost; another agent is
            // now primary. Don't re-emit the transfer broadcast.
            return;
          }

          applyEffects(ctx.io, result.effects);

          // Legacy emitted ticket:transferred to the ticket room with
          // null toId/toName — preserved here so existing clients don't
          // notice the migration.
          ctx.io.to(Rooms.ticket(ticketId)).emit('ticket:transferred', {
            ticketId,
            fromId: senderId,
            fromName: senderName,
            toId: null,
            toName: null,
          });

          // The sender (now ex-support) leaves the ticket room — they
          // shouldn't keep receiving the customer's typing / messages.
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
