import { z } from 'zod';
import { router, partnerAdminProcedure } from '../../trpc.js';
import { db } from '../../../db.js';
import { auditLog, users } from '../../../db/schema.js';
import { eq, desc, gte, lte, and, sql, notLike } from 'drizzle-orm';
import { wrapError } from '../../../utils/trpcErrors.js';
import { trpcActor } from '../../../services/auth/index.js';

const PARTNER_ACTIONS = [
  'partner.config_updated',
  'label.created',
  'kb.created',
  'webhook.created',
  'sso.membership_auto_created',
  'sso.role_synced',
  'sso.membership_revoked',
  // ticket lifecycle — emitted by socket handlers via services/ticketAudit.ts
  'ticket.created',
  'ticket.closed',
  'ticket.assigned',
  'ticket.transferred',
  'ticket.returned_to_queue',
  'ticket.reopened',
] as const;

const baseInput = z.object({
  action: z.string().optional(),
  actorId: z.string().optional(),
  targetType: z.string().optional(),
  targetId: z.string().optional(),
  wasExternal: z.boolean().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

// Audit rows emitted by `trpc.testFixtures.*` (Bundle D, RFC #82) use the
// `audit.test_fixture.*` action namespace. Always filtered out of the
// partner-facing audit views — partner admins should never see fixture noise.
const FIXTURE_ACTION_PATTERN = 'audit.test_fixture.%';

function buildConditions(
  input: z.infer<typeof baseInput>,
  partnerId: string,
) {
  const conditions = [eq(auditLog.partnerId, partnerId)];
  if (input.action) conditions.push(eq(auditLog.action, input.action));
  if (input.actorId) conditions.push(eq(auditLog.actorId, input.actorId));
  if (input.targetType) conditions.push(eq(auditLog.targetType, input.targetType));
  if (input.targetId) conditions.push(eq(auditLog.targetId, input.targetId));
  if (input.dateFrom) conditions.push(gte(auditLog.createdAt, `${input.dateFrom}T00:00:00`));
  if (input.dateTo) conditions.push(lte(auditLog.createdAt, `${input.dateTo}T23:59:59.999`));
  if (input.wasExternal === true) {
    conditions.push(sql`${auditLog.metadata}->>'wasExternal' = 'true'`);
  }
  // Bundle D: hide fixture rows. No opt-in flag for partner views.
  if (!input.action?.startsWith('audit.test_fixture.')) {
    conditions.push(notLike(auditLog.action, FIXTURE_ACTION_PATTERN));
  }
  return conditions;
}

// Target types that the app emits on partner-scoped audit rows. Keep in sync
// with the `targetType` literals passed to db.insert(auditLog).values(...)
// for this tenant's actions (see `PARTNER_ACTIONS` above).
const PARTNER_TARGET_TYPES = [
  'user',
  'membership',
  'partner',
  'label',
  'kb_article',
  'webhook',
  'ticket',
] as const;

export const partnerAuditRouter = router({
  listActions: partnerAdminProcedure.query(() => {
    return PARTNER_ACTIONS.slice();
  }),

  listTargetTypes: partnerAdminProcedure.query(() => {
    return PARTNER_TARGET_TYPES.slice();
  }),

  // Audit rows leftJoin users.name for the actor — including platform
  // operators who acted on this partner via /enter-partner. B2B guest admins
  // must not see those identities, so this read is gated.
  getAuditLog: partnerAdminProcedure
    .input(baseInput.extend({
      limit: z.number().min(1).max(100).default(50),
      cursor: z.string().optional(),
    }))
    .query(async ({ input, ctx }) => {
      try {
        const actor = trpcActor(ctx, { capability: 'destructive_admin' });

        const conditions = buildConditions(input, actor.partnerId);

        if (input.cursor) {
          const sepIdx = input.cursor.indexOf('|');
          if (sepIdx !== -1) {
            const cursorTime = input.cursor.slice(0, sepIdx);
            const cursorId = input.cursor.slice(sepIdx + 1);
            conditions.push(
              sql`(${auditLog.createdAt} < ${cursorTime} OR (${auditLog.createdAt} = ${cursorTime} AND ${auditLog.id} < ${cursorId}))`
            );
          }
        }

        const results = await db.select({
          id: auditLog.id,
          action: auditLog.action,
          actorId: auditLog.actorId,
          actorName: users.name,
          partnerId: auditLog.partnerId,
          targetType: auditLog.targetType,
          targetId: auditLog.targetId,
          metadata: auditLog.metadata,
          createdAt: auditLog.createdAt,
        })
          .from(auditLog)
          .leftJoin(users, eq(auditLog.actorId, users.id))
          .where(and(...conditions))
          .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
          .limit(input.limit + 1);

        const hasMore = results.length > input.limit;
        const items = hasMore ? results.slice(0, input.limit) : results;
        const lastItem = items[items.length - 1];
        const nextCursor = hasMore && lastItem ? `${lastItem.createdAt}|${lastItem.id}` : '';

        return { items, nextCursor };
      } catch (err: unknown) {
        wrapError(err, 'list partner audit log');
      }
    }),

  // Audit history for a single ticket. Matches on targetId for rows stamped
  // with targetType='ticket' *and* rows where metadata.ticketId carries the id
  // (legacy/adjacent emitters that don't set targetType). Partner-scoped via
  // partnerId so cross-tenant leakage is impossible even if a caller guesses
  // another tenant's ticket id. Same actor-name leak as getAuditLog, so the
  // same `destructive_admin` capability gate applies.
  getForTicket: partnerAdminProcedure
    .input(z.object({
      ticketId: z.string(),
      limit: z.number().min(1).max(200).default(100),
    }))
    .query(async ({ input, ctx }) => {
      try {
        const actor = trpcActor(ctx, { capability: 'destructive_admin' });

        const results = await db.select({
          id: auditLog.id,
          action: auditLog.action,
          actorId: auditLog.actorId,
          actorName: users.name,
          partnerId: auditLog.partnerId,
          targetType: auditLog.targetType,
          targetId: auditLog.targetId,
          metadata: auditLog.metadata,
          createdAt: auditLog.createdAt,
        })
          .from(auditLog)
          .leftJoin(users, eq(auditLog.actorId, users.id))
          .where(and(
            eq(auditLog.partnerId, actor.partnerId),
            sql`(
              (${auditLog.targetType} = 'ticket' AND ${auditLog.targetId} = ${input.ticketId})
              OR ${auditLog.metadata}->>'ticketId' = ${input.ticketId}
            )`,
            // Bundle D: hide fixture rows from per-ticket audit drawer.
            notLike(auditLog.action, FIXTURE_ACTION_PATTERN),
          ))
          .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
          .limit(input.limit);

        return results;
      } catch (err: unknown) {
        wrapError(err, `partner audit getForTicket (${input.ticketId})`);
      }
    }),

  exportAuditLog: partnerAdminProcedure
    .input(baseInput)
    .query(async ({ input, ctx }) => {
      try {
        const conditions = buildConditions(input, ctx.user.partnerId);

        return await db.select({
          id: auditLog.id,
          action: auditLog.action,
          actorId: auditLog.actorId,
          actorName: users.name,
          partnerId: auditLog.partnerId,
          targetType: auditLog.targetType,
          targetId: auditLog.targetId,
          metadata: auditLog.metadata,
          createdAt: auditLog.createdAt,
        })
          .from(auditLog)
          .leftJoin(users, eq(auditLog.actorId, users.id))
          .where(and(...conditions))
          .orderBy(desc(auditLog.createdAt))
          .limit(10000);
      } catch (err: unknown) {
        wrapError(err, 'export partner audit log');
      }
    }),
});
