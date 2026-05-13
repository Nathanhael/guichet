/**
 * Ticket-domain dispatch for the SocketCommandBus.
 *
 * Mirrors `messageBus.ts`. Absorbs the scope check + capability gate +
 * lifecycle call + error-code → caller-event mapping that used to live in
 * `socket/handlers/ticket.ts`. Also pulls in the two pieces that handler
 * was doing imperatively:
 *
 *   1. The BUSINESS_HOURS_CLOSED reply formatting on `ticket:new` — bus
 *      now reads the `hoursStatus` carried on the lifecycle's rejection
 *      and shapes the `hours:closed` payload from it. The lifecycle is
 *      the single source of truth for the hours decision; no second DB
 *      read (issue #159).
 *   2. The same-dept-transfer post-commit broadcast — bus appends the
 *      `ticket:transferred` emit and a `broadcastQueue` effect to the
 *      lifecycle's returnToQueue output, plus a callerLeaves entry for
 *      the ex-support's ticket room exit.
 *
 * Labels mutation has no lifecycle verb today (no audit, simple write),
 * so the bus calls `replaceTicketLabels` directly. Promotion to a
 * lifecycle verb is a follow-up.
 */

import { z } from 'zod';
import logger from '../../utils/logger.js';
import { Rooms } from '../../utils/rooms.js';
import { canUseSupportWorkflows } from '../../services/roles.js';
import { MAX_LABELS_PER_TICKET } from '../../constants.js';
import {
  findTicketForClose,
  findTicketForTransfer,
  findPartnerLabels,
  replaceTicketLabels,
  findTicketPartner,
} from '../../services/ticketQueries.js';
import type { TicketLifecycle } from '../../services/ticketLifecycle/index.js';
import type { CommandResult, SocketCommand } from './types.js';

const NOT_AUTHORIZED: CommandResult = {
  reply: { event: 'error', payload: { message: 'Not authorized' } },
  effects: [],
};

const SILENT_NOOP: CommandResult = { reply: { silent: true }, effects: [] };

function errorReply(message: string): CommandResult {
  return { reply: { event: 'error', payload: { message } }, effects: [] };
}

const labelsSchema = z.array(z.string().min(1)).max(MAX_LABELS_PER_TICKET);

export async function dispatchTicketCommand(
  deps: { ticketLifecycle: TicketLifecycle },
  cmd: Extract<SocketCommand, { type: `ticket:${string}` }>,
): Promise<CommandResult> {
  switch (cmd.type) {
    case 'ticket:new':
      return dispatchNew(deps, cmd);
    case 'ticket:close':
      return dispatchClose(deps, cmd);
    case 'ticket:transfer':
      return dispatchTransfer(deps, cmd);
    case 'ticket:labels:update':
      return dispatchLabelsUpdate(cmd);
  }
}

async function dispatchNew(
  deps: { ticketLifecycle: TicketLifecycle },
  cmd: Extract<SocketCommand, { type: 'ticket:new' }>,
): Promise<CommandResult> {
  if (!cmd.agentLang || !cmd.dept) {
    logger.warn(
      { partnerId: cmd.partnerId, userId: cmd.actor.userId, agentLang: !!cmd.agentLang, dept: !!cmd.dept },
      '[ticket:new] rejected — missing required fields',
    );
    return errorReply('Missing required fields');
  }

  const result = await deps.ticketLifecycle.create({
    partnerId: cmd.partnerId,
    actor: cmd.actor,
    dept: cmd.dept,
    agentLang: cmd.agentLang,
    references: cmd.references ?? [],
    text: cmd.text,
    mediaUrl: cmd.mediaUrl,
  });

  if (!result.ok) {
    switch (result.code) {
      case 'NOT_AUTHORIZED':
        logger.warn(
          { partnerId: cmd.partnerId, userId: cmd.actor.userId, role: cmd.actor.role },
          '[ticket:new] rejected — not an agent',
        );
        return errorReply('Only agents can create tickets');
      case 'PARTNER_NOT_ACTIVE':
        logger.warn({ partnerId: cmd.partnerId }, '[ticket:new] rejected — partner inactive');
        return errorReply('Partner is currently inactive.');
      case 'BUSINESS_HOURS_CLOSED': {
        // Lifecycle already evaluated business hours to decide the
        // rejection; reuse the status it returns rather than re-reading
        // the partner row (fix for issue #159).
        const { hoursStatus } = result;
        logger.warn(
          { partnerId: cmd.partnerId, nextOpen: hoursStatus.nextOpenAt },
          '[ticket:new] rejected — business hours closed',
        );
        return {
          reply: {
            event: 'hours:closed',
            payload: {
              code: 'BUSINESS_HOURS_CLOSED',
              message: hoursStatus.message,
              status: hoursStatus,
            },
          },
          effects: [],
        };
      }
      case 'INVALID_MEDIA_URL':
        logger.warn({ partnerId: cmd.partnerId, mediaUrl: cmd.mediaUrl }, '[ticket:new] rejected — invalid media URL');
        return errorReply('Invalid media URL');
      case 'DUPLICATE_TICKET':
        return errorReply('You already have an open ticket');
      case 'GUARD_REJECTED':
        return errorReply('Message blocked: content guard rejected the first message');
      default:
        return errorReply('Failed to create ticket');
    }
  }

  logger.debug(
    { partnerId: cmd.partnerId, userId: cmd.actor.userId, dept: cmd.dept, ticketId: result.data.ticket.id },
    '[ticket:new] accepted — ticket created',
  );

  return {
    reply: {
      event: 'ticket:created:self',
      payload: {
        ticket: { ...result.data.ticket, participants: [], labels: [] },
        message: result.data.firstMessage,
      },
    },
    effects: result.effects,
    callerJoins: [Rooms.ticket(result.data.ticket.id)],
  };
}

async function dispatchClose(
  deps: { ticketLifecycle: TicketLifecycle },
  cmd: Extract<SocketCommand, { type: 'ticket:close' }>,
): Promise<CommandResult> {
  // Partner-scope guard: the lifecycle would also refuse with
  // TICKET_NOT_FOUND, but legacy UX is "Not authorized" on cross-tenant.
  const ticket = await findTicketForClose(cmd.ticketId);
  if (!ticket || ticket.partnerId !== cmd.partnerId) return NOT_AUTHORIZED;

  const result = await deps.ticketLifecycle.close({
    ticketId: cmd.ticketId,
    partnerId: cmd.partnerId,
    actor: cmd.actor,
    closingNotes: cmd.closingNotes,
  });

  if (!result.ok) {
    switch (result.code) {
      case 'NOT_AUTHORIZED':
        return errorReply('Only support staff can close tickets');
      case 'TICKET_NOT_FOUND':
        return errorReply('Ticket not found');
      case 'TICKET_ALREADY_CLOSED':
        return SILENT_NOOP;
      default:
        return SILENT_NOOP;
    }
  }

  return { effects: result.effects };
}

async function dispatchTransfer(
  deps: { ticketLifecycle: TicketLifecycle },
  cmd: Extract<SocketCommand, { type: 'ticket:transfer' }>,
): Promise<CommandResult> {
  if (!canUseSupportWorkflows(cmd.actor.role, cmd.actor.isPlatformOperator)) {
    return errorReply('Only support staff can transfer tickets');
  }

  const ticket = await findTicketForTransfer(cmd.ticketId);
  if (!ticket || ticket.partnerId !== cmd.partnerId) return NOT_AUTHORIZED;

  if (cmd.departmentId) {
    // Department-change branch — full transfer.
    const result = await deps.ticketLifecycle.transfer({
      ticketId: cmd.ticketId,
      partnerId: cmd.partnerId,
      actor: cmd.actor,
      toDepartmentId: cmd.departmentId,
      note: cmd.note,
    });

    if (!result.ok) {
      switch (result.code) {
        case 'NOT_AUTHORIZED':
          return errorReply('Only support staff can transfer tickets');
        case 'DEPARTMENT_NOT_FOUND':
          return errorReply('Department not found');
        case 'TICKET_NOT_FOUND':
          return SILENT_NOOP;
        default:
          return SILENT_NOOP;
      }
    }

    return { effects: result.effects };
  }

  // Same-department branch — return-to-queue. Reuses the lifecycle's
  // returnToQueue verb so we keep one audit semantic for "this ticket is
  // back in the queue".
  if (!ticket.supportId) return SILENT_NOOP; // Already unassigned.

  const result = await deps.ticketLifecycle.returnToQueue({
    ticketId: cmd.ticketId,
    partnerId: cmd.partnerId,
    actor: cmd.actor,
    previousSupportId: ticket.supportId,
    systemMessageText: `${cmd.actor.name} returned ticket to queue`,
  });

  if (!result.ok) {
    // TICKET_ALREADY_REASSIGNED → race lost, suppress the transfer
    // broadcast and the queue rebroadcast.
    return SILENT_NOOP;
  }

  // Legacy emitted ticket:transferred to the ticket room with null
  // toId/toName plus a queue rebroadcast. Express both as Effect data
  // so they go through the same applyEffects dispatcher as everything
  // else (no out-of-band io.emit anymore — fixes the RFC #142 finding
  // on same-dept transfer's bypassed dispatch contract).
  const extraEffects = [
    {
      type: 'emit' as const,
      rooms: [Rooms.ticket(cmd.ticketId)],
      event: 'ticket:transferred',
      payload: {
        ticketId: cmd.ticketId,
        fromId: cmd.actor.userId,
        fromName: cmd.actor.name,
        toId: null,
        toName: null,
      },
    },
    { type: 'broadcastQueue' as const, partnerId: cmd.partnerId },
  ];

  return {
    effects: [...result.effects, ...extraEffects],
    callerLeaves: [Rooms.ticket(cmd.ticketId)],
  };
}

async function dispatchLabelsUpdate(
  cmd: Extract<SocketCommand, { type: 'ticket:labels:update' }>,
): Promise<CommandResult> {
  if (!canUseSupportWorkflows(cmd.actor.role, cmd.actor.isPlatformOperator)) {
    return errorReply('Not authorized to update labels');
  }

  const labelsValidation = labelsSchema.safeParse(cmd.labels);
  if (!labelsValidation.success) {
    return errorReply('Invalid label list');
  }
  const labels = labelsValidation.data;

  const ticket = await findTicketPartner(cmd.ticketId);
  if (!ticket || ticket.partnerId !== cmd.partnerId) return NOT_AUTHORIZED;

  if (labels.length > 0) {
    const partnerLabels = await findPartnerLabels(ticket.partnerId, labels);
    const validIds = new Set(partnerLabels.map((l) => l.id));
    const invalid = labels.filter((l) => !validIds.has(l));
    if (invalid.length > 0) return errorReply('Invalid label IDs');
  }

  try {
    await replaceTicketLabels(cmd.ticketId, labels);
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), ticketId: cmd.ticketId },
      '[ticket:labels:update] replaceTicketLabels failed',
    );
    return SILENT_NOOP;
  }

  return {
    effects: [
      {
        type: 'emit',
        rooms: [Rooms.ticket(cmd.ticketId)],
        event: 'ticket:labels:updated',
        payload: { ticketId: cmd.ticketId, labels },
      },
    ],
  };
}
