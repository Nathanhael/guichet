import { z } from 'zod';
import { router, platformProcedure } from '../../trpc.js';
import { db } from '../../../db.js';
import { auditLog, auditArchive, archivedTickets, users, systemSettings } from '../../../db/schema.js';
import { eq, desc, gte, lte, ilike, and, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { getRedisClients } from '../../../utils/redis.js';
import logger from '../../../utils/logger.js';

const VERIFY_CHAIN_WINDOW_SECS = 60;
const VERIFY_CHAIN_MAX_PER_WINDOW = 1;
const LAST_VERIFY_KEY = 'audit_chain_last_verify';
const VERIFY_HISTORY_KEY = 'audit_chain_verify_history';
// Keep a rolling window of chain-verify runs for the compliance trail. 50 is
// enough for a multi-month review window even at one run per day; old entries
// are dropped from the head when the cap is hit.
const VERIFY_HISTORY_MAX = 50;

// Union of every targetType platform operators can see — partner-scoped rows
// bubble up here too. Keep in sync with `targetType:` literals emitted by both
// `trpc/routers/partner/*` and `trpc/routers/platform/*`.
const PLATFORM_TARGET_TYPES = [
  'user',
  'partner',
  'membership',
  'group_mapping',
  'label',
  'kb_article',
  'webhook',
  'system',
] as const;

// Per-operator throttle for verifyAuditChain — a full verify scans the entire
// audit_archive and recomputes every SHA-256 chain hash. One operator spamming
// the button (or a compromised session) could saturate CPU+DB. Fails open on
// Redis outages: the procedure is already gated by platformProcedure, so the
// blast radius without Redis is small and we'd rather keep ops unblocked.
async function assertVerifyChainAllowed(userId: string): Promise<void> {
  try {
    const { pubClient } = getRedisClients();
    if (!pubClient) return;
    const key = `rate:verify-audit-chain:${userId}`;
    const count = await pubClient.incr(key);
    if (count === 1) await pubClient.expire(key, VERIFY_CHAIN_WINDOW_SECS);
    if (count > VERIFY_CHAIN_MAX_PER_WINDOW) {
      const ttl = await pubClient.ttl(key);
      const retryAfter = ttl > 0 ? ttl : VERIFY_CHAIN_WINDOW_SECS;
      logger.warn({ userId, count }, '[audit] verify-chain rate limit exceeded');
      throw new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: `Chain verification is rate-limited. Retry in ${retryAfter}s.`,
      });
    }
  } catch (err) {
    if (err instanceof TRPCError) throw err;
    logger.warn({ err }, '[audit] verify-chain rate-limit check failed, allowing');
  }
}

export const platformAuditRouter = router({
  getAuditLog: platformProcedure
    .input(z.object({
      action: z.string().optional(),
      partnerId: z.string().optional(),
      actorId: z.string().optional(),
      targetId: z.string().optional(),
      targetType: z.string().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      limit: z.number().min(1).max(100).default(50),
      cursor: z.string().optional(),
    }))
    .query(async ({ input }) => {
      try {
        const conditions = [];
        if (input.action) conditions.push(eq(auditLog.action, input.action));
        if (input.partnerId) conditions.push(eq(auditLog.partnerId, input.partnerId));
        if (input.actorId) conditions.push(eq(auditLog.actorId, input.actorId));
        if (input.targetId) conditions.push(eq(auditLog.targetId, input.targetId));
        if (input.targetType) conditions.push(eq(auditLog.targetType, input.targetType));

        if (input.dateFrom) {
          conditions.push(gte(auditLog.createdAt, `${input.dateFrom}T00:00:00`));
        }
        if (input.dateTo) {
          conditions.push(lte(auditLog.createdAt, `${input.dateTo}T23:59:59.999`));
        }

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

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

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
        .where(whereClause)
        .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
        .limit(input.limit + 1);

        const hasMore = results.length > input.limit;
        const items = hasMore ? results.slice(0, input.limit) : results;
        const lastItem = items[items.length - 1];
        const nextCursor = hasMore && lastItem ? `${lastItem.createdAt}|${lastItem.id}` : '';

        return { items, nextCursor };
      } catch (err: unknown) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
      }
    }),

  exportAuditLog: platformProcedure
    .input(z.object({
      action: z.string().optional(),
      partnerId: z.string().optional(),
      actorId: z.string().optional(),
      targetId: z.string().optional(),
      targetType: z.string().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
    }))
    .query(async ({ input }) => {
      try {
        let conditions = [];
        if (input.action) conditions.push(eq(auditLog.action, input.action));
        if (input.partnerId) conditions.push(eq(auditLog.partnerId, input.partnerId));
        if (input.actorId) conditions.push(eq(auditLog.actorId, input.actorId));
        if (input.targetId) conditions.push(eq(auditLog.targetId, input.targetId));
        if (input.targetType) conditions.push(eq(auditLog.targetType, input.targetType));
        if (input.dateFrom) {
          conditions.push(gte(auditLog.createdAt, `${input.dateFrom}T00:00:00`));
        }
        if (input.dateTo) {
          conditions.push(lte(auditLog.createdAt, `${input.dateTo}T23:59:59.999`));
        }

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

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
        .where(whereClause)
        .orderBy(desc(auditLog.createdAt))
        .limit(10000);
      } catch (err: unknown) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
      }
    }),

  getArchivedAuditLog: platformProcedure
    .input(z.object({
      action: z.string().optional(),
      partnerId: z.string().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      limit: z.number().min(1).max(100).default(50),
      cursor: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const conditions = [];
      if (input.action) conditions.push(ilike(auditArchive.action, `%${input.action}%`));
      if (input.partnerId) conditions.push(eq(auditArchive.partnerId, input.partnerId));
      if (input.dateFrom) conditions.push(gte(auditArchive.createdAt, `${input.dateFrom}T00:00:00`));
      if (input.dateTo) conditions.push(lte(auditArchive.createdAt, `${input.dateTo}T23:59:59.999`));

      if (input.cursor) {
        const sepIdx = input.cursor.indexOf('|');
        if (sepIdx !== -1) {
          const cursorTime = input.cursor.slice(0, sepIdx);
          const cursorId = input.cursor.slice(sepIdx + 1);
          conditions.push(
            sql`(${auditArchive.createdAt} < ${cursorTime} OR (${auditArchive.createdAt} = ${cursorTime} AND ${auditArchive.id} < ${cursorId}))`
          );
        }
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
      const results = await db.select().from(auditArchive)
        .where(whereClause)
        .orderBy(desc(auditArchive.createdAt), desc(auditArchive.id))
        .limit(input.limit + 1);

      const hasMore = results.length > input.limit;
      const items = hasMore ? results.slice(0, input.limit) : results;
      const lastItem = items[items.length - 1];
      const nextCursor = hasMore && lastItem ? `${lastItem.createdAt}|${lastItem.id}` : '';

      return { items, nextCursor };
    }),

  listTargetTypes: platformProcedure.query(() => {
    return PLATFORM_TARGET_TYPES.slice();
  }),

  verifyAuditChain: platformProcedure
    .mutation(async ({ ctx }) => {
      await assertVerifyChainAllowed(ctx.user.id);
      const { verifyAuditChain } = await import('../../../services/archive.js');
      const result = await verifyAuditChain();
      // Resolve actor name at write time so the persisted record is readable
      // without a join. If the operator is later deleted, the record still
      // carries the name at time-of-run — useful for compliance review.
      const actor = await db
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, ctx.user.id))
        .limit(1);
      const record = {
        ranAt: new Date().toISOString(),
        ranBy: ctx.user.id,
        ranByName: actor[0]?.name ?? null,
        ...result,
      };
      // Persist so all operators see the same last-verified state, not just the
      // one who clicked the button. system_settings is keyed, so we upsert.
      await db
        .insert(systemSettings)
        .values({ key: LAST_VERIFY_KEY, value: record })
        .onConflictDoUpdate({
          target: systemSettings.key,
          set: { value: record, updatedAt: new Date().toISOString() },
        });

      // Append to the rolling history so compliance review can see the trail
      // of runs, not just the latest. Read-modify-write is fine here because
      // the route is rate-limited to 1 call per minute per operator.
      const historyRows = await db
        .select({ value: systemSettings.value })
        .from(systemSettings)
        .where(eq(systemSettings.key, VERIFY_HISTORY_KEY))
        .limit(1);
      const existingHistory = Array.isArray(historyRows[0]?.value) ? historyRows[0]!.value as unknown[] : [];
      const nextHistory = [record, ...existingHistory].slice(0, VERIFY_HISTORY_MAX);
      await db
        .insert(systemSettings)
        .values({ key: VERIFY_HISTORY_KEY, value: nextHistory })
        .onConflictDoUpdate({
          target: systemSettings.key,
          set: { value: nextHistory, updatedAt: new Date().toISOString() },
        });

      // Alerting: a broken chain means the WORM archive has been tampered with
      // (or the hash implementation regressed). Either is a high-severity
      // incident — leave a loud, queryable trail in audit_log so the existing
      // PlatformAuditLog surfaces it and any downstream webhook/alert consumer
      // can react. Service-level errors (e.g. db timeout) are distinct from
      // tampering and get a separate, lower-severity action.
      if (!result.valid) {
        await db.insert(auditLog).values({
          action: result.error ? 'system.chain_verify_error' : 'system.chain_broken_detected',
          actorId: ctx.user.id,
          targetType: 'system',
          targetId: result.brokenAt ?? null,
          metadata: {
            checked: result.checked,
            brokenAt: result.brokenAt ?? null,
            error: result.error ?? null,
            severity: result.error ? 'warn' : 'critical',
          },
        });
      }

      return record;
    }),

  getLastChainVerify: platformProcedure
    .query(async () => {
      const rows = await db
        .select({ value: systemSettings.value })
        .from(systemSettings)
        .where(eq(systemSettings.key, LAST_VERIFY_KEY))
        .limit(1);
      return rows[0]?.value ?? null;
    }),

  getChainVerifyHistory: platformProcedure
    .query(async () => {
      const rows = await db
        .select({ value: systemSettings.value })
        .from(systemSettings)
        .where(eq(systemSettings.key, VERIFY_HISTORY_KEY))
        .limit(1);
      const value = rows[0]?.value;
      return Array.isArray(value) ? (value as unknown[]) : [];
    }),

  runArchive: platformProcedure
    .mutation(async ({ ctx }) => {
      const { archiveAuditLog, archiveTickets } = await import('../../../services/archive.js');
      const auditCount = await archiveAuditLog();
      const ticketCount = await archiveTickets();

      await db.insert(auditLog).values({
        action: 'system.archive_run',
        actorId: ctx.user.id,
        targetType: 'system',
        metadata: { auditCount, ticketCount },
      });

      return { auditCount, ticketCount };
    }),

  getArchivedTickets: platformProcedure
    .input(z.object({
      partnerId: z.string().optional(),
      dept: z.string().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      limit: z.number().min(1).max(100).default(50),
      cursor: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const conditions = [];
      if (input.partnerId) conditions.push(eq(archivedTickets.partnerId, input.partnerId));
      if (input.dept) conditions.push(ilike(archivedTickets.dept, `%${input.dept}%`));
      if (input.dateFrom) conditions.push(gte(archivedTickets.createdAt, `${input.dateFrom}T00:00:00`));
      if (input.dateTo) conditions.push(lte(archivedTickets.createdAt, `${input.dateTo}T23:59:59.999`));

      if (input.cursor) {
        const sepIdx = input.cursor.indexOf('|');
        if (sepIdx !== -1) {
          const cursorTime = input.cursor.slice(0, sepIdx);
          const cursorId = input.cursor.slice(sepIdx + 1);
          conditions.push(
            sql`(${archivedTickets.createdAt} < ${cursorTime} OR (${archivedTickets.createdAt} = ${cursorTime} AND ${archivedTickets.id} < ${cursorId}))`
          );
        }
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
      const results = await db.select({
        id: archivedTickets.id,
        partnerId: archivedTickets.partnerId,
        dept: archivedTickets.dept,
        agentId: archivedTickets.agentId,
        supportId: archivedTickets.supportId,
        status: archivedTickets.status,
        messageCount: archivedTickets.messageCount,
        createdAt: archivedTickets.createdAt,
        closedAt: archivedTickets.closedAt,
        archivedAt: archivedTickets.archivedAt,
        agentName: sql<string>`(SELECT name FROM users WHERE id = ${archivedTickets.agentId})`.as('agent_name'),
        supportName: sql<string>`(SELECT name FROM users WHERE id = ${archivedTickets.supportId})`.as('support_name'),
      }).from(archivedTickets)
        .where(whereClause)
        .orderBy(desc(archivedTickets.createdAt), desc(archivedTickets.id))
        .limit(input.limit + 1);

      const hasMore = results.length > input.limit;
      const items = hasMore ? results.slice(0, input.limit) : results;
      const lastItem = items[items.length - 1];
      const nextCursor = hasMore && lastItem ? `${lastItem.createdAt}|${lastItem.id}` : '';

      return { items, nextCursor };
    }),
});
