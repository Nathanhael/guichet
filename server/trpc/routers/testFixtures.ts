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
 * Procedures land in subsequent slice 1 tasks (createTicket, cleanup,
 * resetAgentStatus). This file ships in Task 2 as the skeleton.
 */
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc.js';
import config from '../../config.js';
import { assertNotProduction } from '../../utils/assertNotProduction.js';

assertNotProduction('testFixtures router');

export const fixtureProcedure = protectedProcedure.use(({ next }) => {
  if (config.NODE_ENV === 'production') {
    // NOT_FOUND (not FORBIDDEN) so a misbehaving caller can't fingerprint
    // production by error code.
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Test fixtures unavailable' });
  }
  return next();
});

export const testFixturesRouter = router({
  // Procedures land in tasks 3-5: createTicket, cleanup, resetAgentStatus.
});

export type TestFixturesRouter = typeof testFixturesRouter;
