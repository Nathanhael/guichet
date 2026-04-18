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

  verifyAuditChain: platformProcedure
    .mutation(async ({ ctx }) => {
      await assertVerifyChainAllowed(ctx.user.id);
      const { verifyAuditChain } = await import('../../../services/archive.js');
      const result = await verifyAuditChain();
      const record = {
        ranAt: new Date().toISOString(),
        ranBy: ctx.user.id,
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
