/**
 * Per-spec partner-isolation fixture (#117).
 *
 * Each spec that uses `partnerFixture` gets its own dedicated partner +
 * users, dropped on teardown. Replaces the previous pattern of running
 * specs against the shared seed Acme partner — that pattern caused
 * structural flakiness when parallel workers raced for queue tickets or
 * mutated user-flag state without resetting it (8 specs were `fixme`'d
 * via PR #116; this fixture is the structural fix).
 *
 * Usage:
 *   import { test, expect } from './helpers/partnerFixture';
 *
 *   test('non-SSO user sees no badge', async ({ page, partnerFixture }) => {
 *     const { userId } = await partnerFixture.createUser({ role: 'support' });
 *     await partnerFixture.loginAs(userId);
 *     // ... assertions ...
 *   });
 *
 * Auth bridge: setup logs the page in as a known seed platform operator
 * (`platform_bart`) so the partner-creation tRPC call succeeds. After
 * `createUser`, the spec calls `loginAs(userId)` to swap the page session
 * to the freshly-minted user. Teardown swaps back to the bootstrap user
 * before deleting (so we never delete the user whose session is active).
 *
 * Cleanup: best-effort. Failures are logged but do not fail the test —
 * the test already passed/failed on its own merits, and a flaky teardown
 * shouldn't override that signal. Stale ids are no-ops on the server.
 */
import { test as base, type Page } from '@playwright/test';
import { loginAsDemo, type LoginOptions, type LoginResult } from './auth';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3001';

/**
 * Seed platform operator used for fixture bootstrap and teardown. Must
 * exist in seed.ts. Platform operators can call testFixtures.* without
 * needing a membership in the spawned partner — required because the
 * partner doesn't exist yet at bootstrap time.
 */
const BOOTSTRAP_USER_ID = 'platform_bart';

// ── Public types ─────────────────────────────────────────────────────────

export type FixtureRole = 'agent' | 'support' | 'admin';
export type FixtureLang = 'nl' | 'fr' | 'en';
export type FixtureStatus = 'online' | 'away';

export interface PartnerDepartment {
  id: string;
  name: string;
  description?: string;
}

export interface CreateUserOptions {
  role?: FixtureRole;
  name?: string;
  email?: string;
  lang?: FixtureLang;
  /** Department ids (subset of `partnerFixture.departments`). Empty = generalist. */
  departments?: string[];
}

export interface CreatedUser {
  userId: string;
  role: FixtureRole;
}

export interface CreateTicketOptions {
  /** Default: agent_julie (seeded). The default agent must exist in seed.ts. */
  agentId?: string;
  /** Default: `partnerFixture.departments[0].id`. */
  departmentId?: string;
  /**
   * Pre-stamp the ticket as already-claimed by a support user. Skips the
   * lifecycle.assign + socket support:join path; just sets the columns the
   * SupportView hydration filter reads on page load. Used by the rehydration
   * regression spec (#120) to reproduce the bug fixed in #119.
   */
  supportId?: string;
}

export interface PartnerFixture {
  partnerId: string;
  departments: PartnerDepartment[];
  /** Create a user with membership in this partner. Returns the user id + role. */
  createUser(opts?: CreateUserOptions): Promise<CreatedUser>;
  /** Swap the page session to a user (typically one returned by `createUser`). */
  loginAs(userId: string, options?: LoginOptions): Promise<LoginResult>;
  /** Insert an open, unassigned ticket scoped to this partner. */
  createTicket(opts?: CreateTicketOptions): Promise<string>;
  /** Stage agent presence + status_log to a known state (scoped to this partner). */
  resetAgentStatus(opts: { userId: string; status?: FixtureStatus }): Promise<void>;
}

// ── Internals ────────────────────────────────────────────────────────────

interface TrpcSuccess<T> { result: { data: T } }
interface TrpcError { error: { message: string; data?: { code?: string } } }

// Intentional duplicate of fixtures.ts's callTrpc — these two fixtures are
// independent extensions of `base`. If a third use site appears, hoist this
// to a shared helper.
async function callTrpc<T>(page: Page, procedure: string, input: unknown): Promise<T> {
  const url = `${BASE}/api/v1/trpc/${procedure}`;
  const res = await page.request.post(url, {
    data: input,
    failOnStatusCode: false,
  });
  if (!res.ok()) {
    const text = await res.text();
    throw new Error(`fixture ${procedure} failed (${res.status()}): ${text}`);
  }
  const body = (await res.json()) as TrpcSuccess<T> | TrpcError;
  if ('error' in body) {
    const code = body.error.data?.code ?? 'UNKNOWN';
    throw new Error(`fixture ${procedure} returned error ${code}: ${body.error.message}`);
  }
  return body.result.data;
}

// ── Test extension ───────────────────────────────────────────────────────

export const test = base.extend<{ partnerFixture: PartnerFixture }>({
  partnerFixture: async ({ page }, use) => {
    // Bootstrap auth so the createPartner call has a session. Specs are
    // expected to call `loginAs(userId)` afterward to swap to a created user;
    // until they do, the page is authed as the platform operator.
    const bootstrap = await loginAsDemo(page, BOOTSTRAP_USER_ID, {
      seedActiveMembership: false,
    });
    if (!bootstrap.ok) {
      throw new Error(
        `partnerFixture: bootstrap login as '${BOOTSTRAP_USER_ID}' failed (status ${bootstrap.status}). ` +
          `Check seed.ts has this user with isPlatformOperator=true.`,
      );
    }

    const created = await callTrpc<{ partnerId: string; departments: PartnerDepartment[] }>(
      page,
      'testFixtures.createPartner',
      {},
    );

    const userIds: string[] = [];

    const fixture: PartnerFixture = {
      partnerId: created.partnerId,
      departments: created.departments,

      async createUser(opts = {}) {
        const result = await callTrpc<CreatedUser>(page, 'testFixtures.createUser', {
          partnerId: created.partnerId,
          role: opts.role ?? 'support',
          name: opts.name,
          email: opts.email,
          lang: opts.lang,
          departments: opts.departments,
        });
        userIds.push(result.userId);
        return result;
      },

      async loginAs(userId, options) {
        const res = await loginAsDemo(page, userId, options);
        if (!res.ok) {
          throw new Error(`partnerFixture.loginAs(${userId}) failed (status ${res.status})`);
        }
        return res;
      },

      async createTicket(opts = {}) {
        const { ticketId } = await callTrpc<{ ticketId: string }>(
          page,
          'testFixtures.createTicket',
          {
            partnerId: created.partnerId,
            agentId: opts.agentId,
            departmentId: opts.departmentId,
            supportId: opts.supportId,
          },
        );
        return ticketId;
      },

      async resetAgentStatus(opts) {
        await callTrpc<void>(page, 'testFixtures.resetAgentStatus', {
          userId: opts.userId,
          partnerId: created.partnerId,
          status: opts.status ?? 'online',
        });
      },
    };

    await use(fixture);

    // Teardown — runs in afterEach automatically. Swap back to bootstrap
    // auth in case the spec ended logged in as a created user that is about
    // to be deleted (deleting yourself works at the DB level but the
    // request session stays "valid" with a deleted user, which is weird).
    try {
      await loginAsDemo(page, BOOTSTRAP_USER_ID, { seedActiveMembership: false });

      for (const userId of userIds) {
        try {
          await callTrpc<{ deleted: boolean }>(page, 'testFixtures.deleteUser', { userId });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error(`[partnerFixture] deleteUser(${userId}) failed:`, err);
        }
      }

      // Partner delete cascades any leftover memberships, tickets, audit
      // rows, labels, etc. for this partner. Must run after deleteUser so
      // the user rows themselves (global table) don't leak orphans.
      await callTrpc<{ deleted: boolean }>(page, 'testFixtures.deletePartner', {
        partnerId: created.partnerId,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[partnerFixture] teardown failed:', err);
    }
  },
});

export { expect } from '@playwright/test';
