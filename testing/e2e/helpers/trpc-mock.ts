import type { Page } from '@playwright/test';

/**
 * Mock dashboard.* tRPC procedures inside Playwright.
 *
 * Why this helper exists:
 *   The client uses `httpBatchLink`, so when DashboardView mounts and fires its
 *   7 dashboard.* queries within the same React render they all collapse into
 *   a single HTTP request. The URL ends up shaped like:
 *
 *     /api/v1/trpc/dashboard.getActionList,dashboard.getScorecard,...
 *
 *   A glob pattern like `**\/api/v1/trpc/dashboard.getOnboardingState**` only
 *   matches when the named procedure is the FIRST call segment after `/trpc/`.
 *   Anything past position 0 in the comma-separated list never fires the
 *   matcher, so the mock silently no-ops and the real backend response wins.
 *   Compounding that, the batched response shape is an array (one entry per
 *   procedure, in order) — fulfilling with a single `{result:{data}}` object
 *   would corrupt the entire batch even when the matcher does fire.
 *
 *   Worse: the dashboard's queries can land in the same batch as unrelated
 *   queries kicked off elsewhere in the tree (e.g. `user.me`,
 *   `partner.getAiConfig`). If we just intercept and fulfill with our mocked
 *   subset, those unrelated zones see `null` data and break.
 *
 *   So the helper takes a map from procedure name -> mocked `data`, and on
 *   every matching batch fetches the real upstream response, then overlays
 *   only the mocked dashboard procs in their original batch positions. Procs
 *   not in the mocks map (dashboard or otherwise) keep their real values.
 */
export type DashboardProcedure =
  | 'dashboard.getActionList'
  | 'dashboard.getScorecard'
  | 'dashboard.getDeptBreakdown'
  | 'dashboard.getStaffBreakdown'
  | 'dashboard.getStaffingHeatmap'
  | 'dashboard.getTrends'
  | 'dashboard.getOnboardingState';

export type DashboardMocks = Partial<Record<DashboardProcedure, unknown>>;

const DASHBOARD_PROCEDURES = new Set<DashboardProcedure>([
  'dashboard.getActionList',
  'dashboard.getScorecard',
  'dashboard.getDeptBreakdown',
  'dashboard.getStaffBreakdown',
  'dashboard.getStaffingHeatmap',
  'dashboard.getTrends',
  'dashboard.getOnboardingState',
]);

function isDashboardProcedure(name: string): name is DashboardProcedure {
  return (DASHBOARD_PROCEDURES as Set<string>).has(name);
}

/**
 * Install a route handler that intercepts batched tRPC requests containing
 * dashboard.* procedures and overlays the supplied mocks (with safe defaults
 * for unmocked dashboard procs). Non-dashboard procs in the same batch are
 * proxied to the real backend so unrelated zones keep working.
 *
 * Batches that don't include any dashboard.* procedure pass through untouched.
 */
export async function mockDashboardTrpc(page: Page, mocks: DashboardMocks): Promise<void> {
  await page.route(
    (url) => url.pathname.includes('/api/v1/trpc/'),
    async (route) => {
      const url = new URL(route.request().url());
      const procPart = url.pathname.replace(/^.*\/api\/v1\/trpc\//, '');
      const procs = procPart.split(',');

      const hasDashboard = procs.some((p) => isDashboardProcedure(p));
      if (!hasDashboard) {
        await route.continue();
        return;
      }

      // Fetch the real response so non-dashboard procs in the same batch keep
      // their live values; we'll overlay our mocks on top.
      let realBody: Array<{ result?: { data?: unknown }; error?: unknown }> = [];
      try {
        const realResponse = await route.fetch();
        realBody = (await realResponse.json()) as typeof realBody;
        if (!Array.isArray(realBody)) realBody = [];
      } catch {
        // If the upstream call fails we still want the mocked dashboard procs
        // to land — fall through with an empty array (unknown procs become null).
      }

      const batchResponse = procs.map((proc, idx) => {
        if (isDashboardProcedure(proc) && proc in mocks) {
          return { result: { data: mocks[proc] } };
        }
        // Unmocked procs (dashboard or otherwise): pass real response through
        // so the rest of the dashboard keeps real values (and unrelated zones
        // sharing the batch don't see null).
        return realBody[idx] ?? { result: { data: null } };
      });

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(batchResponse),
      });
    },
  );
}
