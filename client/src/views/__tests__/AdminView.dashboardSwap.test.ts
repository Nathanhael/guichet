import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Structural TDD signal for the dashboard-redesign migration step:
 * AdminView's `dashboard` tab mounts the new `DashboardView` shell. The
 * legacy `AdminStats.tsx` has been deleted now that CSV export composes
 * the new procedures' payloads client-side.
 *
 * A pure unit test on the wiring (source-string introspection) is enough
 * here: AdminView is heavy (Suspense, store, i18n, tRPC) and a render
 * test would mostly assert the harness, not the swap.
 */
describe('AdminView — dashboard tab swap', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../AdminView.tsx'),
    'utf-8',
  );

  it('lazy-imports DashboardView from the dashboard sub-folder', () => {
    expect(source).toMatch(
      /lazy\(\(\) =>\s*import\(['"]\.\.\/components\/admin\/dashboard\/DashboardView['"]\)/,
    );
  });

  it('mounts DashboardView in the dashboard tab', () => {
    const dashboardBranchIdx = source.indexOf("view === 'dashboard'");
    expect(dashboardBranchIdx).toBeGreaterThan(-1);
    const branch = source.slice(dashboardBranchIdx, dashboardBranchIdx + 200);
    expect(branch).toMatch(/<DashboardView\b/);
  });

  it('no longer mounts AdminStats in any branch', () => {
    expect(source).not.toMatch(/<AdminStats\b/);
  });
});
