/**
 * E2E test-fixture tRPC router.
 *
 * Used exclusively by the Playwright suite (testing/e2e/) to stage
 * deterministic state before behavioral assertions run. Replaces the
 * "test.skip(!fixturePresent, ...)" anti-pattern that was masking fixture
 * drift as green CI.
 *
 * Production safety: three layers.
 *
 *   1. Module-load assert: importing this file in production throws. The
 *      server boot fails fast — no path where these procedures are reachable
 *      in prod even if a misconfigured router somehow mounted them.
 *
 *   2. Conditional mount in `server/trpc/router.ts`: the `testFixtures`
 *      router key only exists in the appRouter when NODE_ENV !== 'production'.
 *      A prod tRPC client cannot type-check a call to `trpc.testFixtures.*`.
 *
 *   3. Per-procedure recheck via `fixtureProcedure`: each procedure asserts
 *      `NODE_ENV !== 'production'` inside its resolver. Defense in depth
 *      against an operator flipping env vars after server start.
 *
 * Auth: extends `protectedProcedure`. Specs authenticate via the existing
 * `loginAsDemo` helper before calling fixtures, so the JWT cookie is on the
 * request. Anon callers get UNAUTHORIZED.
 *
 * Cross-tenant by design: several procedures accept a client-supplied
 * `partnerId` (`createTicket`, `createUser`, `deletePartner`, `cleanup`,
 * `resetAgentStatus`). The `check-trpc-tenant-isolation.mjs` guard
 * allowlists this file (alongside `support.ts` and `platform/**`).
 *
 * Fixture-emitted audit rows use a labeled `audit.test_fixture.*` action
 * that platform audit views filter out by default — keeps the audit log
 * readable during E2E runs without breaking the chain hash.
 */
import crypto from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { eq, gte, inArray, and, isNull, sql } from 'drizzle-orm';
import { router, protectedProcedure } from '../trpc.js';
import { db } from '../../db.js';
import { agentStatusLog, archivedTickets, auditLog, memberships, partners, tickets, users } from '../../db/schema.js';
import { assertNotProduction } from '../../utils/assertNotProduction.js';
import { getAvailability } from '../../services/availability/index.js';
import { type BusinessHoursSchedule } from '../../services/businessHours.js';
import logger from '../../utils/logger.js';

assertNotProduction('testFixtures router');

export const fixtureProcedure = protectedProcedure.use(({ next }) => {
  // Read process.env directly rather than config.NODE_ENV so the prod-only
  // boundary test can flip NODE_ENV without triggering config.ts's prod
  // validation cascade (which calls process.exit on missing prod env vars).
  if (process.env.NODE_ENV === 'production') {
    // NOT_FOUND (not FORBIDDEN) so a misbehaving caller can't fingerprint
    // production by error code.
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Test fixtures unavailable' });
  }
  return next();
});

const createTicketInput = z.object({
  partnerId: z.string().min(1),
  agentId: z.string().min(1).default('agent_julie'),
  departmentId: z.string().min(1).optional(),
});

interface PartnerDepartment {
  id: string;
  name: string;
  description?: string;
}

const createPartnerInput = z.object({
  idPrefix: z
    .string()
    .min(1)
    .max(20)
    .regex(/^[a-z0-9-]+$/, 'lowercase alphanumerics and hyphens only')
    .default('test'),
  departments: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        description: z.string().optional(),
      }),
    )
    .default([
      { id: 'general', name: 'General' },
      { id: 'support', name: 'Support' },
    ]),
});

const createUserInput = z.object({
  partnerId: z.string().min(1),
  role: z.enum(['agent', 'support', 'admin']).default('support'),
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  lang: z.enum(['nl', 'fr', 'en']).default('en'),
  departments: z.array(z.string().min(1)).default([]),
});

// 24/7 schedule for fixture partners. Inlined rather than reaching into
// platform/partners.ts's private helper — fixture partners want a permissive
// default so business-hours guards never block specs. Specs that need
// alternate hours can update via platform.updatePartner.
const fixtureBusinessHoursSchedule: BusinessHoursSchedule = {
  version: 1,
  timezone: 'Europe/Brussels',
  weekly: {
    mon: { closed: false, windows: [{ start: '00:00', end: '23:59' }] },
    tue: { closed: false, windows: [{ start: '00:00', end: '23:59' }] },
    wed: { closed: false, windows: [{ start: '00:00', end: '23:59' }] },
    thu: { closed: false, windows: [{ start: '00:00', end: '23:59' }] },
    fri: { closed: false, windows: [{ start: '00:00', end: '23:59' }] },
    sat: { closed: false, windows: [{ start: '00:00', end: '23:59' }] },
    sun: { closed: false, windows: [{ start: '00:00', end: '23:59' }] },
  },
  exceptions: [],
};

export const testFixturesRouter = router({
  /**
   * Spawn a fresh partner for parallel-worker spec isolation (#117).
   * Generates a unique id (`<idPrefix>-<hex>`), inserts the row with a
   * permissive 24/7 schedule and two default departments, and audits via
   * the `audit.test_fixture.*` namespace (filtered out of platform/partner
   * audit views by default).
   *
   * Specs are expected to pair this with `deletePartner` on teardown so
   * each spec owns its data start to finish.
   */
  createPartner: fixtureProcedure
    .input(createPartnerInput)
    .mutation(async ({ input, ctx }) => {
      const partnerId = `${input.idPrefix}-${crypto.randomBytes(6).toString('hex')}`;
      const now = new Date().toISOString();

      await db.transaction(async (tx) => {
        await tx.insert(partners).values({
          id: partnerId,
          name: `Test Partner ${partnerId}`,
          industry: 'Test',
          departments: input.departments,
          status: 'active',
          businessHoursSchedule: fixtureBusinessHoursSchedule,
          createdAt: now,
          updatedAt: now,
        });

        await tx.insert(auditLog).values({
          partnerId,
          action: 'audit.test_fixture.partner_created',
          actorId: ctx.user.id,
          targetType: 'partner',
          targetId: partnerId,
          metadata: { fixtureBy: ctx.user.id },
        });
      });

      logger.info(
        { partnerId, fixtureBy: ctx.user.id, departments: input.departments.length },
        '[testFixtures] Created partner',
      );

      return { partnerId, departments: input.departments };
    }),

  /**
   * Hard-delete a fixture partner. FK cascade handles tickets, memberships,
   * audit_log, labels, canned_responses, webhooks, kb_articles, and the
   * other partner-scoped tables.
   *
   * The `archived_tickets` FK is `onDelete: 'restrict'` for compliance:
   * production paths preserve the archive even if the partner row goes
   * away (different retention windows). Test partners can enter the
   * archive flow whenever a spec joins + closes a ticket — `lifecycle.close`
   * snapshots into `archived_tickets` post-commit. Some specs leave a
   * close behind via UI flow ("close ticket" tests), some via implicit
   * cascade paths under reload — either way, fixture cleanup needs to
   * own the archive rows it generated. Clear them BEFORE deletePartner
   * so the restrict FK doesn't trip. Idempotent on stale ids.
   */
  deletePartner: fixtureProcedure
    .input(
      z.object({
        partnerId: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      const archiveCleared = await db
        .delete(archivedTickets)
        .where(eq(archivedTickets.partnerId, input.partnerId))
        .returning({ id: archivedTickets.id });

      const result = await db
        .delete(partners)
        .where(eq(partners.id, input.partnerId))
        .returning({ id: partners.id });

      logger.info(
        {
          partnerId: input.partnerId,
          deleted: result.length,
          archivedTicketsCleared: archiveCleared.length,
        },
        '[testFixtures] Deleted partner',
      );

      return { deleted: result.length > 0 };
    }),

  /**
   * Spawn a fixture user (with membership) inside an existing partner.
   * The user is loginable via dev-login (`/api/v1/auth/dev-login`, used by
   * `loginAsDemo`). `source: 'manual'` distinguishes fixture-minted users
   * from real SSO-provisioned users in audit/admin views.
   *
   * Generates random id (`test-user-<hex>`) + email (`<id>@test.local`)
   * unless explicitly overridden. Specs that need deterministic ids should
   * pass them in.
   */
  createUser: fixtureProcedure
    .input(createUserInput)
    .mutation(async ({ input, ctx }) => {
      const [partner] = await db
        .select()
        .from(partners)
        .where(eq(partners.id, input.partnerId))
        .limit(1);
      if (!partner) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Partner not found: ${input.partnerId}`,
        });
      }

      const userId = `test-user-${crypto.randomBytes(6).toString('hex')}`;
      const name = input.name ?? `Test ${input.role}`;
      const email = input.email ?? `${userId}@test.local`;

      await db.transaction(async (tx) => {
        await tx.insert(users).values({
          id: userId,
          name,
          email,
          lang: input.lang,
        });

        await tx.insert(memberships).values({
          id: crypto.randomUUID(),
          userId,
          partnerId: input.partnerId,
          role: input.role,
          departments: input.departments,
          source: 'manual',
        });

        await tx.insert(auditLog).values({
          partnerId: input.partnerId,
          action: 'audit.test_fixture.user_created',
          actorId: ctx.user.id,
          targetType: 'user',
          targetId: userId,
          metadata: { fixtureBy: ctx.user.id, role: input.role },
        });
      });

      logger.info(
        { userId, partnerId: input.partnerId, role: input.role, fixtureBy: ctx.user.id },
        '[testFixtures] Created user',
      );

      return { userId, role: input.role };
    }),

  /**
   * Hard-delete a fixture user. FK cascade clears memberships and tickets
   * where the user was the agent (tickets.agentId is `onDelete: 'cascade'`);
   * tickets where the user was the support are nulled (`set null`).
   * Idempotent on stale ids.
   */
  deleteUser: fixtureProcedure
    .input(
      z.object({
        userId: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      const result = await db
        .delete(users)
        .where(eq(users.id, input.userId))
        .returning({ id: users.id });

      logger.info(
        { userId: input.userId, deleted: result.length },
        '[testFixtures] Deleted user',
      );

      return { deleted: result.length > 0 };
    }),

  /**
   * Insert an open, unassigned ticket directly. Skips lifecycle.create's
   * production-only preflight (business hours, dup-ticket-per-agent,
   * agent-role gate) because fixtures stage state, not user behavior.
   * The ticket is queryable by support immediately.
   */
  createTicket: fixtureProcedure
    .input(createTicketInput)
    .mutation(async ({ input, ctx }) => {
      const [partner] = await db
        .select()
        .from(partners)
        .where(eq(partners.id, input.partnerId))
        .limit(1);
      if (!partner) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Partner not found: ${input.partnerId}`,
        });
      }

      const [agent] = await db
        .select()
        .from(users)
        .where(eq(users.id, input.agentId))
        .limit(1);
      if (!agent) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Fixture agent not found: ${input.agentId}`,
        });
      }

      const partnerDepartments = (partner.departments as PartnerDepartment[] | null) ?? [];
      const dept = input.departmentId ?? partnerDepartments[0]?.id;
      if (!dept) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Partner ${input.partnerId} has no departments and no departmentId was provided`,
        });
      }
      if (input.departmentId && !partnerDepartments.some((d) => d.id === input.departmentId)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Department not found on partner: ${input.departmentId}`,
        });
      }

      const ticketId = crypto.randomUUID();
      const now = new Date().toISOString();

      await db.transaction(async (tx) => {
        await tx.insert(tickets).values({
          id: ticketId,
          partnerId: input.partnerId,
          dept,
          agentId: agent.id,
          agentName: agent.name,
          agentLang: agent.lang ?? 'en',
          references: [],
          status: 'open',
          participants: [],
          reopened: false,
          reopenCount: 0,
          createdAt: now,
          updatedAt: now,
          queueEnteredAt: now,
        });

        await tx.insert(auditLog).values({
          partnerId: input.partnerId,
          action: 'audit.test_fixture.ticket_created',
          actorId: ctx.user.id,
          targetType: 'ticket',
          targetId: ticketId,
          metadata: { fixtureBy: ctx.user.id },
        });
      });

      logger.info(
        { ticketId, partnerId: input.partnerId, agentId: agent.id, dept, fixtureBy: ctx.user.id },
        '[testFixtures] Created ticket',
      );

      return { ticketId };
    }),

  /**
   * Idempotent + stale-safe cleanup. Tickets are deleted by id (FK cascade
   * removes messages, ticket_labels, ratings). Stale ids are no-ops.
   *
   * For userIds: removes any agent_status_log rows in the last 24 hours
   * and deletes the `presence:<userId>` Redis hash. The `partner:presence:*`
   * set is not touched — its membership becomes stale but reads through
   * `presence:<userId>` return null, so the user appears offline.
   */
  cleanup: fixtureProcedure
    .input(
      z.object({
        ticketIds: z.array(z.string().min(1)).optional(),
        userIds: z.array(z.string().min(1)).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const ticketIds = input.ticketIds ?? [];
      const userIds = input.userIds ?? [];

      if (ticketIds.length > 0) {
        await db.delete(tickets).where(inArray(tickets.id, ticketIds));
      }

      if (userIds.length > 0) {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        await db
          .delete(agentStatusLog)
          .where(
            and(inArray(agentStatusLog.userId, userIds), gte(agentStatusLog.startedAt, since)),
          );

        // Redis presence keys are scoped `presence:<partnerId>:<userId>` —
        // we don't have partnerId here, so we skip Redis cleanup. The 24h
        // TTL handles staleness; a subsequent identifyUser will reinitialize
        // the hash. Tests that need deterministic Redis state should call
        // `resetAgentStatus` (which is partner-scoped) instead.
      }

      logger.info(
        { ticketIds: ticketIds.length, userIds: userIds.length },
        '[testFixtures] Cleanup',
      );
    }),

  /**
   * Stage agent presence + status_log for a deterministic starting state.
   * Closes any currently-open status row (sets endedAt + duration), inserts
   * a new open row with the requested status, and writes the Redis presence
   * hash so subsequent reads see the staged status.
   *
   * The hash is written even if it didn't previously exist — a subsequent
   * `identifyUser` (triggered by the socket connect on page reload) preserves
   * the status field per the existing Lua-script convention. Net: tests
   * stage presence BEFORE the socket connects, and the connect respects it.
   */
  resetAgentStatus: fixtureProcedure
    .input(
      z.object({
        userId: z.string().min(1),
        partnerId: z.string().min(1),
        status: z.enum(['online', 'away']).default('online'),
      }),
    )
    .mutation(async ({ input }) => {
      const now = new Date().toISOString();

      await db.transaction(async (tx) => {
        // Close any currently-open status row for this user/partner.
        await tx
          .update(agentStatusLog)
          .set({
            endedAt: now,
            duration: sql`EXTRACT(EPOCH FROM (${now}::timestamp - ${agentStatusLog.startedAt}))::int`,
          })
          .where(
            and(
              eq(agentStatusLog.userId, input.userId),
              eq(agentStatusLog.partnerId, input.partnerId),
              isNull(agentStatusLog.endedAt),
            ),
          );

        // Insert new open row with the requested status.
        await tx.insert(agentStatusLog).values({
          userId: input.userId,
          partnerId: input.partnerId,
          status: input.status,
          startedAt: now,
        });
      });

      // Stage Redis presence via the orchestrator seam. Writes to `last_status`
      // (so the next socket:identify reads it as the seed status) and updates
      // the live hash if the user is currently mid-session. Production-guarded
      // inside `availability.advanced.seedTestHash`. Replaces the previous
      // direct Redis hSet that hard-coded the `presence:<partnerId>:<userId>`
      // key layout (#110).
      try {
        await getAvailability().advanced.seedTestHash({
          partnerId: input.partnerId,
          userId: input.userId,
          status: input.status,
        });
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err), userId: input.userId },
          '[testFixtures.resetAgentStatus] Failed to seed availability state',
        );
      }

      logger.info(
        { userId: input.userId, partnerId: input.partnerId, status: input.status },
        '[testFixtures] Reset agent status',
      );
    }),
});

export type TestFixturesRouter = typeof testFixturesRouter;
