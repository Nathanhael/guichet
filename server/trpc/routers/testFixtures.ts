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
 * Cross-tenant by design: `createTicket` accepts a client-supplied
 * `partnerId`. The `check-trpc-tenant-isolation.mjs` guard allowlists this
 * file (alongside `support.ts` and `platform/**`).
 *
 * Fixture-emitted audit rows use a labeled `audit.test_fixture.*` action
 * that platform audit views filter out by default — keeps the audit log
 * readable during E2E runs without breaking the chain hash.
 */
import crypto from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { router, protectedProcedure } from '../trpc.js';
import config from '../../config.js';
import { db } from '../../db.js';
import { auditLog, partners, tickets, users } from '../../db/schema.js';
import { assertNotProduction } from '../../utils/assertNotProduction.js';
import logger from '../../utils/logger.js';

assertNotProduction('testFixtures router');

export const fixtureProcedure = protectedProcedure.use(({ next }) => {
  if (config.NODE_ENV === 'production') {
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

export const testFixturesRouter = router({
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
});

export type TestFixturesRouter = typeof testFixturesRouter;
