/**
 * Implementation of `lifecycle.create()`. Owns the largest preflight
 * surface in the deepening:
 *  - role gate (agent only)
 *  - partner exists + status='active'
 *  - business hours open at the evaluation time
 *  - mediaUrl validation (when provided)
 *  - 1-ticket-per-agent limit (DUPLICATE_TICKET)
 *  - reopen detection (JS-side reference match against recent closed tickets)
 *
 * Atomic txn: insert ticket + (optional) first message + ticket.created
 * (or ticket.reopened) audit row.
 *
 * The result carries the SocketMessage for the first message (when
 * `text` was provided) so the caller can forward it on the
 * `ticket:created:self` payload without a separate read.
 */
import crypto from 'node:crypto';

import { RECENT_CLOSED_TICKETS_LIMIT } from '../../constants.js';
import { auditLog } from '../../db/schema.js';
import { Rooms } from '../../utils/rooms.js';
import { isValidMediaUrl } from '../../utils/security.js';
import { getBusinessHoursStatus } from '../businessHours.js';
import type { BusinessHoursSchedule } from '../businessHours.js';
import type { ModerationPort } from '../moderator/index.js';
import { writeAudit } from './audit.js';
import { insertAgentMessageTx, type SocketMessage } from './messages.js';
import {
  createTicketTx,
  readActiveTicketForAgent,
  readPartnerForCreate,
  readRecentClosedTickets,
} from './mutations.js';
import type {
  CreateArgs,
  CreateOk,
  Effect,
  LifecycleDb,
  Result,
  TicketReference,
} from './types.js';

export interface CreateDeps {
  db: LifecycleDb;
  moderation: ModerationPort;
}

export async function runCreate(
  deps: CreateDeps,
  args: CreateArgs,
): Promise<Result<CreateOk>> {
  if (args.actor.role !== 'agent') {
    return { ok: false, code: 'NOT_AUTHORIZED' };
  }
  if (args.mediaUrl && !isValidMediaUrl(args.mediaUrl)) {
    return { ok: false, code: 'INVALID_MEDIA_URL' };
  }

  // Content moderation on first-message text. `scope: 'ticket:create'` runs
  // ALL 7 guards including repetition (D9 behavior change). The 1-ticket-per-
  // agent constraint means intra-user repetition can only happen across
  // sequential closed tickets — exactly the spam pattern repetition catches.
  // On block, audit row lands outside any transaction (the ticket transaction
  // never opens because we return before `db.transaction`).
  let guardedText = args.text;
  if (args.text && args.text.trim().length > 0) {
    const moderationResult = await deps.moderation.moderate(args.text, {
      senderId: args.actor.userId,
      partnerId: args.partnerId,
      scope: 'ticket:create',
    });
    if (moderationResult.decision === 'block') {
      await deps.db.insert(auditLog).values({
        action: 'ticket.guard_blocked',
        actorId: args.actor.userId,
        partnerId: args.partnerId,
        targetType: 'ticket',
        targetId: null,
        metadata: {
          scope: 'ticket:create',
          original: moderationResult.original,
          sanitized: moderationResult.sanitized,
          triggered: moderationResult.triggered,
          blockingCode: moderationResult.blockingCode,
          dept: args.dept,
        },
      });
      return { ok: false, code: 'GUARD_REJECTED' };
    }
    guardedText = moderationResult.sanitized;
  }

  const partner = await readPartnerForCreate(deps.db, { partnerId: args.partnerId });
  if (!partner) {
    return { ok: false, code: 'PARTNER_NOT_ACTIVE' };
  }
  if (partner.status !== 'active') {
    return { ok: false, code: 'PARTNER_NOT_ACTIVE' };
  }

  const hoursStatus = getBusinessHoursStatus({
    businessHoursSchedule: partner.businessHoursSchedule as BusinessHoursSchedule | null,
  });
  if (!hoursStatus.isOpen) {
    return { ok: false, code: 'BUSINESS_HOURS_CLOSED' };
  }

  const existing = await readActiveTicketForAgent(deps.db, {
    agentId: args.actor.userId,
    partnerId: args.partnerId,
  });
  if (existing) {
    return { ok: false, code: 'DUPLICATE_TICKET' };
  }

  // Reopen detection — JS-side exact-value match against the partner's
  // most-recent closed tickets. Pure read, runs outside the txn.
  let reopened = false;
  let reopenCount = 0;
  const references = args.references ?? [];
  const incomingValues = references.map((r) => r.value).filter(Boolean);
  if (incomingValues.length > 0) {
    const recent = await readRecentClosedTickets(deps.db, {
      partnerId: args.partnerId,
      limit: RECENT_CLOSED_TICKETS_LIMIT,
    });
    const match = recent.find((row) => {
      try {
        const raw = typeof row.references === 'string'
          ? JSON.parse(row.references)
          : row.references;
        const ticketRefs: TicketReference[] = Array.isArray(raw) ? raw : [];
        return ticketRefs.some((r) => incomingValues.includes(r.value));
      } catch {
        return false;
      }
    });
    if (match) {
      reopened = true;
      reopenCount = (match.reopenCount ?? 0) + 1;
    }
  }

  const ticketId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const agentName = args.actor.name || args.actor.userId;
  let firstMessage: SocketMessage | null = null;

  await deps.db.transaction(async (tx) => {
    await createTicketTx(tx, {
      id: ticketId,
      partnerId: args.partnerId,
      dept: args.dept,
      agentId: args.actor.userId,
      agentName,
      agentLang: args.agentLang,
      references,
      createdAt,
      reopened,
      reopenCount,
    });

    if (guardedText?.trim()) {
      firstMessage = await insertAgentMessageTx(tx, {
        ticketId,
        senderId: args.actor.userId,
        senderName: agentName,
        senderLang: args.agentLang,
        senderIsExternal: args.actor.isExternal,
        text: guardedText,
        mediaUrl: args.mediaUrl,
      });
    }

    await writeAudit(tx, {
      action: reopened ? 'ticket.reopened' : 'ticket.created',
      ticketId,
      partnerId: args.partnerId,
      actor: args.actor,
      metadata: {
        dept: args.dept,
        reopenCount,
      },
    });
  });

  const ticket: CreateOk['ticket'] = {
    id: ticketId,
    partnerId: args.partnerId,
    dept: args.dept,
    agentId: args.actor.userId,
    agentName,
    agentLang: args.agentLang,
    references,
    status: 'open',
    supportId: null,
    createdAt,
    participants: [],
    reopened,
    reopenCount,
  };

  const effects: Effect[] = [
    {
      // Staff-only — agents must not see other users' tickets in the
      // queue. Same room the legacy handler used.
      type: 'emit',
      rooms: [Rooms.staff(args.partnerId)],
      event: 'ticket:created',
      payload: {
        ticket: { ...ticket, participants: [], labels: [] },
        firstMessage,
      },
    },
    { type: 'broadcastQueue', partnerId: args.partnerId },
  ];

  return {
    ok: true,
    data: { ticket, firstMessage },
    effects,
  };
}
