/**
 * Playwright `test` extension that exposes the testFixtures tRPC API as a
 * test-scoped fixture with auto-cleanup in afterEach. Bundle D / RFC #82.
 *
 * Usage:
 *   import { test, expect } from './helpers/fixtures';
 *   import { loginAsDemo } from './helpers/auth';
 *
 *   test('queue shows my fresh ticket', async ({ page, ticketFixture }) => {
 *     const res = await loginAsDemo(page, 'support_lucas');
 *     if (!res.ok) throw new Error('seed user not available — see seed.ts');
 *     const partnerId = (await page.evaluate(() => sessionStorage.getItem('activePartnerId')))!;
 *     await ticketFixture.create({ partnerId });
 *     // Cleanup runs in afterEach automatically.
 *   });
 *
 * Auth: the helper inherits the spec's existing dev-login cookie via
 * page.request. If a spec calls `ticketFixture.create()` before logging in,
 * the call 401s — by design (fixtures require an authenticated session,
 * mirroring production's no-anon-creates contract).
 *
 * Auto-cleanup: every ticket id returned by `create()` is recorded and
 * deleted in afterEach. Specs that need the ticket to outlive the test
 * (e.g. asserting on archive state across tests) can call `retain(id)` to
 * exclude it from teardown.
 */
import { test as base, type Page } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3001';

// ── Public types ─────────────────────────────────────────────────────────

export interface CreateTicketOptions {
  partnerId: string;
  /** Default: agent_julie (seeded on `acme` partner). */
  agentId?: string;
  /** Default: partner.departments[0].id. */
  departmentId?: string;
}

export interface TicketFixture {
  /** Insert an open, unassigned ticket. Returns the new ticket id. */
  create(opts: CreateTicketOptions): Promise<string>;
  /** Mark a ticket id as "do not auto-cleanup". */
  retain(ticketId: string): void;
  /**
   * Stage agent presence + status_log to a known state. The user/partner
   * are tracked for cleanup so agent_status_log entries created here are
   * removed in afterEach.
   */
  resetAgentStatus(opts: { userId: string; partnerId: string; status?: 'online' | 'away' }): Promise<void>;
}

// ── Internals ────────────────────────────────────────────────────────────

interface TrpcSuccess<T> { result: { data: T } }
interface TrpcError { error: { message: string; data?: { code?: string } } }

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

export const test = base.extend<{ ticketFixture: TicketFixture }>({
  ticketFixture: async ({ page }, use) => {
    const created: string[] = [];
    const retained = new Set<string>();
    const resetUsers: string[] = [];

    const fixture: TicketFixture = {
      async create(opts) {
        const { ticketId } = await callTrpc<{ ticketId: string }>(
          page,
          'testFixtures.createTicket',
          opts,
        );
        created.push(ticketId);
        return ticketId;
      },
      retain(ticketId) {
        retained.add(ticketId);
      },
      async resetAgentStatus(opts) {
        await callTrpc<void>(page, 'testFixtures.resetAgentStatus', {
          userId: opts.userId,
          partnerId: opts.partnerId,
          status: opts.status ?? 'online',
        });
        if (!resetUsers.includes(opts.userId)) resetUsers.push(opts.userId);
      },
    };

    await use(fixture);

    // Teardown — runs in afterEach automatically. Failures here log but
    // don't fail the test (the test already passed/failed on its own merits;
    // a flaky cleanup shouldn't override that signal).
    const ticketIds = created.filter((id) => !retained.has(id));
    if (ticketIds.length > 0 || resetUsers.length > 0) {
      try {
        await callTrpc<void>(page, 'testFixtures.cleanup', {
          ticketIds: ticketIds.length > 0 ? ticketIds : undefined,
          userIds: resetUsers.length > 0 ? resetUsers : undefined,
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[ticketFixture] cleanup failed:', err);
      }
    }
  },
});

export { expect } from '@playwright/test';
