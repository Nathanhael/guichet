// server/services/messageLifecycle/guardAudit.ts
import { auditLog } from '../../db/schema.js';
import logger from '../../utils/logger.js';
import type { LifecycleDb } from '../ticketLifecycle/index.js';
import type { GuardCode, ModerationScope } from './ports.js';

interface GuardBlockArgs {
  db: LifecycleDb;
  actorId: string;
  partnerId: string;
  ticketId: string;
  scope: ModerationScope;
  original: string;
  sanitized: string;
  triggered: GuardCode[];
  blockingCode: GuardCode;
}

/**
 * Persists a `message.guard_blocked` audit row when the moderator blocks
 * a send/edit. Non-fatal — a logging error must not turn a guard rejection
 * into a 500. Caller awaits it but treats failure as a logged warning.
 *
 * The row is written outside any transaction because the message was never
 * persisted on block; there is nothing to be atomic with. Closes the audit
 * gap from RFC #89 — `original` and `triggered` are now persisted, so an
 * incident reviewer sees what the user actually typed (not the post-caps
 * sanitized text) plus every guard that fired.
 */
export async function recordGuardBlock(args: GuardBlockArgs): Promise<void> {
  try {
    await args.db.insert(auditLog).values({
      action: 'message.guard_blocked',
      actorId: args.actorId,
      partnerId: args.partnerId,
      targetType: 'ticket',
      targetId: args.ticketId,
      metadata: {
        scope: args.scope,
        original: args.original,
        sanitized: args.sanitized,
        triggered: args.triggered,
        blockingCode: args.blockingCode,
      },
    });
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), ticketId: args.ticketId },
      '[messageLifecycle.guardAudit] audit insert failed (non-fatal)',
    );
  }
}
