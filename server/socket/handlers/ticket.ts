import { Socket } from 'socket.io';
import { z } from 'zod';
import logger from '../../utils/logger.js';
import { Rooms } from '../../utils/rooms.js';
import { requireActorTicketScope, requireActorTicketScopeWith } from '../partnerScope.js';
import {
  findTicketForClose,
  findTicketForTransfer,
  findPartnerLabels,
  replaceTicketLabels,
} from '../../services/ticketQueries.js';
import { getBusinessHoursStatus, broadcastQueuePositions, BusinessHoursSchedule } from '../../services/businessHours.js';
import { findPartnerConfig } from '../../services/partnerQueries.js';
import { findUserName } from '../../services/userQueries.js';
import { applyEffects, socketActor } from '../../services/ticketLifecycle/index.js';
import { can } from '../../services/auth/capabilities.js';
import { MAX_LABELS_PER_TICKET } from '../../constants.js';
import {
  requireIdentified,
  validatePayload,
  ticketNewSchema,
  ticketCloseSchema,
  ticketTransferSchema,
  type HandlerContext,
} from './types.js';

export function register(socket: Socket, ctx: HandlerContext): void {
    socket.on('ticket:new', async (data: unknown) => {
      if (!requireIdentified(socket)) return;
      const parsed = validatePayload(socket, ticketNewSchema, data);
      if (!parsed) {
        logger.warn({ socketId: socket.id }, '[ticket:new] payload validation failed');
        return;
      }

      try {
        const baseActor = socketActor(socket);
        if (!baseActor) return;

        const { agentLang, dept, references = [], text, mediaUrl } = parsed;
        if (!agentLang || !dept) {
          logger.warn({ agentLang: !!agentLang, dept: !!dept }, '[ticket:new] rejected — missing required fields');
          return socket.emit('error', { message: 'Missing required fields' });
        }

        // Resolve B2B-guest flag for the actor — denormalized into the
        // first-message row inside the lifecycle txn so historical
        // messages render the GUEST badge without a live presence
        // lookup. Cheap single-row read.
        const agentUser = await findUserName(baseActor.userId);
        const createActor = { ...baseActor, isExternal: !!agentUser?.isExternal };

        const result = await ctx.lifecycle.create({
          partnerId: baseActor.partnerId,
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
              logger.warn({ socketId: socket.id, userId: baseActor.userId, role: baseActor.role }, '[ticket:new] rejected — not an agent');
              return socket.emit('error', { message: 'Only agents can create tickets' });
            case 'PARTNER_NOT_ACTIVE':
              logger.warn({ partnerId: baseActor.partnerId }, '[ticket:new] rejected — partner inactive');
              return socket.emit('error', { message: 'Partner is currently inactive.' });
            case 'BUSINESS_HOURS_CLOSED': {
              // Re-evaluate the status here so the client gets the same
              // hours payload the legacy handler emitted (next-open
              // timestamp etc.). The lifecycle has already declined the
              // create — this is a transport-tier hint only.
              const partnerRow = await findPartnerConfig(baseActor.partnerId);
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
              logger.warn({ agentId: baseActor.userId, partnerId: baseActor.partnerId }, '[ticket:new] rejected — agent already has an open ticket');
              return socket.emit('error', { message: 'You already have an open ticket' });
            case 'GUARD_REJECTED':
              logger.warn({ agentId: baseActor.userId, partnerId: baseActor.partnerId }, '[ticket:new] rejected — first message blocked by content guard');
              return socket.emit('error', { message: 'Message blocked: content guard rejected the first message' });
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
      try {
        const actor = socketActor(socket);
        if (!actor) return;

        // Partner-scope guard before the lifecycle — preserves the legacy
        // "Not authorized" wording and saves the lifecycle a round-trip
        // when the ticket is in another tenant. The lifecycle would also
        // refuse with TICKET_NOT_FOUND, but the handler-level check is
        // the canonical "you don't get to see this exists" UX.
        const partnerCheck = await requireActorTicketScopeWith(socket, actor, ticketId, findTicketForClose);
        if (!partnerCheck) return;

        const result = await ctx.lifecycle.close({
          ticketId,
          partnerId: actor.partnerId,
          actor,
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
      } catch (err: unknown) { logger.error({ err: err instanceof Error ? err.message : String(err) }, '[ticket:close] error'); }
    });

    // ── Ticket Transfer ──────────────────────────────────────────────────────
    socket.on('ticket:transfer', async (data: unknown) => {
      if (!requireIdentified(socket)) return;
      const transferParsed = validatePayload(socket, ticketTransferSchema, data);
      if (!transferParsed) return;
      const { ticketId, departmentId, note } = transferParsed;
      try {
        const actor = socketActor(socket);
        if (!actor) return;

        // Capability replaces the legacy `socket.data.isSupport` denormalized
        // flag. Lifecycle would also refuse with NOT_AUTHORIZED, but the
        // handler-level check preserves the legacy error shape.
        if (!can(actor, 'use_support_workflows')) {
          return socket.emit('error', { message: 'Only support staff can transfer tickets' });
        }

        const ticket = await requireActorTicketScopeWith(socket, actor, ticketId, findTicketForTransfer);
        if (!ticket) return;

        if (departmentId) {
          // Department-change branch — full transfer.
          const result = await ctx.lifecycle.transfer({
            ticketId,
            partnerId: actor.partnerId,
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
                return; // requireActorTicketScopeWith already emitted
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
            partnerId: actor.partnerId,
            actor,
            previousSupportId: ticket.supportId,
            systemMessageText: `${actor.name} returned ticket to queue`,
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
            fromId: actor.userId,
            fromName: actor.name,
            toId: null,
            toName: null,
          });

          // The sender (now ex-support) leaves the ticket room — they
          // shouldn't keep receiving the customer's typing / messages.
          socket.leave(Rooms.ticket(ticketId));

          await broadcastQueuePositions(actor.partnerId);
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

      const actor = socketActor(socket);
      if (!actor) return;

      // Slice #69: capability replaces the legacy
      //   LABEL_ROLES = ['support', 'admin', 'platform_operator']
      // array, which compared role==='platform_operator' (a string never set
      // on socket.data.role) and so silently rejected operators.
      if (!can(actor, 'use_support_workflows')) {
        return socket.emit('error', { message: 'Not authorized to update labels' });
      }

      try {
        const ticket = await requireActorTicketScope(socket, actor, ticketId);
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
