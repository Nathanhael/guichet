import { z } from 'zod';
import { router, platformProcedure } from '../../trpc.js';
import { db } from '../../../db.js';
import { auditLog, auditArchive, archivedTickets, users, systemSettings, partners } from '../../../db/schema.js';
import { eq, desc, gte, lte, ilike, and, sql, notLike } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { getRedisClients } from '../../../utils/redis.js';
import logger from '../../../utils/logger.js';
import { wrapError } from '../../../utils/trpcErrors.js';
import { runChainVerify, LAST_VERIFY_KEY, VERIFY_HISTORY_KEY } from '../../../services/chainVerifySchedule.js';
import { escapeLikePattern } from '../../../utils/security.js';

const VERIFY_CHAIN_WINDOW_SECS = 60;
const VERIFY_CHAIN_MAX_PER_WINDOW = 1;

// Audit rows in the `audit.test_fixture.*` action namespace (legacy from
// the removed E2E fixture API) are excluded from operator-facing views.
// Callers explicitly opt-in via `includeFixtures: true` for debugging.
const FIXTURE_ACTION_PATTERN = 'audit.test_fixture.%';

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
  'ticket',
] as const;

// Union of audit actions a platform operator can filter by. Partner-scoped
// actions bubble up here too since platform ops see cross-tenant rows. Keep
// alphabetised within each group — grouping is purely for human reviewers.
// Adding a new action emitter elsewhere in the codebase should be mirrored
// here; missing entries silently widen the "all" bucket instead of breaking
// the query.
const PLATFORM_ACTIONS = [
  // ai (emitted by services/ai/auditConfig.ts via platform/partners.ts)
  'ai.api_key_rotated',
  'ai.base_url_changed',
  'ai.custom_instructions_changed',
  'ai.deployment_changed',
  'ai.enabled_changed',
  'ai.features_changed',
  'ai.model_changed',
  'ai.privacy_changed',
  'ai.provider_changed',
  'ai.terms_changed',
  // auth / security
  'auth.break_glass',
  'security.account_locked',
  'security.mfa_disabled',
  'security.mfa_disabled_by_admin',
  'security.mfa_enabled',
  'security.mfa_recovery_codes_regenerated',
  'security.user_unlocked_by_admin',
  // content
  'kb.created',
  'label.created',
  'webhook.created',
  // partner
  'partner.created',
  'partner.config_updated',
  'partner.deactivated',
  'partner.reactivated',
  'partner.deleted',
  // platform
  'platform.ai_security_updated',
  'platform.enter_partner',
  'platform_operator_bootstrap',
  // sso
  'sso.email_conflict',
  'sso.group_mapping_added',
  'sso.group_mapping_updated',
  'sso.group_mapping_removed',
  'sso.membership_auto_created',
  'sso.membership_revoked',
  'sso.no_matching_groups',
  'sso.role_synced',
  // system
  'system.archive_run',
  'system.chain_broken_detected',
  'system.chain_verify_error',
  'system.gdpr_purge',
  // ticket lifecycle (emitted by socket handlers via services/ticketAudit.ts)
  'ticket.created',
  'ticket.closed',
  'ticket.assigned',
  'ticket.transferred',
  'ticket.returned_to_queue',
  'ticket.reopened',
  // user
  'user.login',
  'user.sessions_revoked',
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
      includeFixtures: z.boolean().default(false),
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

        // Bundle D: hide fixture-emitted rows by default. Caller opts-in
        // explicitly OR filters by a fixture action — both bypass the filter.
        const callerWantsFixtureAction = input.action?.startsWith('audit.test_fixture.') ?? false;
        if (!input.includeFixtures && !callerWantsFixtureAction) {
          conditions.push(notLike(auditLog.action, FIXTURE_ACTION_PATTERN));
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
        wrapError(err, 'list audit log');
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
      includeFixtures: z.boolean().default(false),
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

        // Bundle D: hide fixture-emitted rows by default. Same logic as getAuditLog.
        const callerWantsFixtureAction = input.action?.startsWith('audit.test_fixture.') ?? false;
        if (!input.includeFixtures && !callerWantsFixtureAction) {
          conditions.push(notLike(auditLog.action, FIXTURE_ACTION_PATTERN));
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
        wrapError(err, 'export audit log');
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
      if (input.action) conditions.push(ilike(auditArchive.action, `%${escapeLikePattern(input.action)}%`));
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

  listActions: platformProcedure.query(() => {
    return PLATFORM_ACTIONS.slice();
  }),

  verifyAuditChain: platformProcedure
    .mutation(async ({ ctx }) => {
      await assertVerifyChainAllowed(ctx.user.id);
      // Resolve actor name at write time so the persisted record is readable
      // without a join. If the operator is later deleted, the record still
      // carries the name at time-of-run — useful for compliance review.
      const actor = await db
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, ctx.user.id))
        .limit(1);
      // Delegate to the shared runner so manual and scheduled paths persist
      // identical record shapes to the same system_settings keys and share
      // the same alert / webhook side-effects.
      return runChainVerify({ id: ctx.user.id, name: actor[0]?.name ?? null });
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
      if (input.dept) conditions.push(ilike(archivedTickets.dept, `%${escapeLikePattern(input.dept)}%`));
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

  // Cross-partner audit activity rollup. Returns per-partner totals for the
  // time window so platform ops can spot which tenant is unusually noisy
  // (often the first signal of a compromised account, a misconfigured SSO
  // mapping, or an internal tool gone wild). This is an aggregate-only view
  // — operators clicking a row should jump into the existing partnerId
  // filter on getAuditLog to see the raw rows.
  //
  // Bounded to the default 7d window by the caller; the 50-partner cap keeps
  // the query from hot-looping in very-multi-tenant deployments while still
  // covering real-world fleets (we ship with <50 partners in every known
  // deployment).
  getCrossPartnerActivity: platformProcedure
    .input(z.object({
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      limit: z.number().min(1).max(50).default(20),
    }))
    .query(async ({ input }) => {
      try {
        const conditions = [sql`${auditLog.partnerId} IS NOT NULL`];
        if (input.dateFrom) conditions.push(gte(auditLog.createdAt, `${input.dateFrom}T00:00:00`));
        if (input.dateTo) conditions.push(lte(auditLog.createdAt, `${input.dateTo}T23:59:59.999`));
        // Bundle D: cross-partner activity should never reflect fixture noise.
        // No opt-in flag here — the rollup is for spotting unusual partner
        // activity, and fixture rows would skew the signal.
        conditions.push(notLike(auditLog.action, FIXTURE_ACTION_PATTERN));

        // Aggregate per partner: total count + last activity timestamp. The
        // top-action sub-aggregate is computed client-side from a second
        // small query to keep the main query's plan simple (GROUP BY + MAX
        // are cheap; per-group top-N would require a window function).
        const totals = await db.select({
          partnerId: auditLog.partnerId,
          partnerName: partners.name,
          totalEvents: sql<number>`COUNT(*)::int`.as('total_events'),
          lastEventAt: sql<string>`MAX(${auditLog.createdAt})`.as('last_event_at'),
        })
          .from(auditLog)
          .leftJoin(partners, eq(auditLog.partnerId, partners.id))
          .where(and(...conditions))
          .groupBy(auditLog.partnerId, partners.name)
          // Order by inline aggregate rather than the SELECT-clause alias —
          // Drizzle's sql-template orderBy does not always propagate aliases
          // through its query builder. Safer to sort by the expression
          // itself. Source: post-ship review 2026-04-18 M-2.
          .orderBy(sql`COUNT(*) DESC`)
          .limit(input.limit);

        return totals;
      } catch (err: unknown) {
        wrapError(err, 'cross-partner activity');
      }
    }),
});
