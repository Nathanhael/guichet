import { z } from 'zod';
import { router, partnerAdminProcedure, partnerInternalAdminReadProcedure } from '../../trpc.js';
import { db } from '../../../db.js';
import { auditLog, users } from '../../../db/schema.js';
import { eq, desc, gte, lte, and, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { getRedisClients } from '../../../utils/redis.js';
import logger from '../../../utils/logger.js';
import { wrapError } from '../../../utils/trpcErrors.js';
import { verifyAuditChain } from '../../../services/archive.js';

const PARTNER_VERIFY_CHAIN_WINDOW_SECS = 60;
const PARTNER_VERIFY_CHAIN_MAX_PER_WINDOW = 1;

// Per-(partner+user) throttle for partner-scoped chain verify. Walking the
// full audit_archive is expensive (SHA-256 over every row) so a partner admin
// spamming the button can stall the database for everyone. Fails open on
// Redis outages — the route is already gated by partnerAdminProcedure so the
// blast radius without Redis is small.
async function assertPartnerVerifyChainAllowed(partnerId: string, userId: string): Promise<void> {
  try {
    const { pubClient } = getRedisClients();
    if (!pubClient) return;
    const key = `rate:verify-audit-chain:partner:${partnerId}:${userId}`;
    const count = await pubClient.incr(key);
    if (count === 1) await pubClient.expire(key, PARTNER_VERIFY_CHAIN_WINDOW_SECS);
    if (count > PARTNER_VERIFY_CHAIN_MAX_PER_WINDOW) {
      const ttl = await pubClient.ttl(key);
      const retryAfter = ttl > 0 ? ttl : PARTNER_VERIFY_CHAIN_WINDOW_SECS;
      logger.warn({ partnerId, userId, count }, '[audit] partner verify-chain rate limit exceeded');
      throw new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: `Chain verification is rate-limited. Retry in ${retryAfter}s.`,
      });
    }
  } catch (err) {
    if (err instanceof TRPCError) throw err;
    logger.warn({ err }, '[audit] partner verify-chain rate-limit check failed, allowing');
  }
}

const PARTNER_ACTIONS = [
  'member.added',
  'member.invited',
  'member.removed',
  'member.updated',
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
  getAuditLog: partnerInternalAdminReadProcedure
    .input(baseInput.extend({
      limit: z.number().min(1).max(100).default(50),
      cursor: z.string().optional(),
    }))
    .query(async ({ input, ctx }) => {
      try {
        const conditions = buildConditions(input, ctx.user.partnerId);

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
  // same `partnerInternalAdminReadProcedure` gate applies.
  getForTicket: partnerInternalAdminReadProcedure
    .input(z.object({
      ticketId: z.string(),
      limit: z.number().min(1).max(200).default(100),
    }))
    .query(async ({ input, ctx }) => {
      try {
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
            eq(auditLog.partnerId, ctx.user.partnerId),
            sql`(
              (${auditLog.targetType} = 'ticket' AND ${auditLog.targetId} = ${input.ticketId})
              OR ${auditLog.metadata}->>'ticketId' = ${input.ticketId}
            )`,
          ))
          .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
          .limit(input.limit);

        return results;
      } catch (err: unknown) {
        wrapError(err, `partner audit getForTicket (${input.ticketId})`);
      }
    }),

  // Partner-scoped chain verify. Walks the full archive (the hash chain is
  // global, so integrity cannot be proven in isolation) but returns only the
  // partner-relevant slice: how many of this tenant's rows were verified and,
  // on failure, whether the broken row lives inside their scope. The broken
  // row id itself is only returned when it belongs to this partner — leaking
  // another tenant's row id here would be a cross-tenant disclosure.
  verifyChain: partnerAdminProcedure
    .mutation(async ({ ctx }) => {
      await assertPartnerVerifyChainAllowed(ctx.user.partnerId, ctx.user.id);
      const result = await verifyAuditChain({ partnerId: ctx.user.partnerId });
      return {
        valid: result.valid,
        partnerChecked: result.partnerChecked ?? 0,
        brokenInScope: result.brokenInPartnerScope ?? false,
        brokenAt: result.brokenInPartnerScope ? (result.brokenAt ?? null) : null,
        error: result.error ?? null,
        ranAt: new Date().toISOString(),
      };
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
