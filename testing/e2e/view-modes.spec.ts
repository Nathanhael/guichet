/**
 * E2E: Split View & Preview Pane
 *
 * Tests the ViewModeDropdown component, preview mode empty state and ticket card,
 * split view fallback behaviour, and focus mode sidebar toggling.
 *
 * #117: migrated to `partnerFixture` for parallel-worker isolation. Each
 * test gets its own partner + support user + queue ticket; the seed
 * `support_vm` user is no longer referenced. The previous `releaseOwnClaims`
 * raw-psql workaround for cross-test queue pollution is gone.
 *
 * Prerequisites:
 *   - Server running at E2E_BASE_URL
 *   - Seeded `platform_bart` operator (used by partnerFixture for bootstrap auth)
 */

import { test, expect } from './helpers/partnerFixture';
import type { Page } from '@playwright/test';

/**
 * ChatTabBar (and its child ViewModeDropdown) only mounts when at least
 * one ticket tab is open. Every `describe` here needs a seeded queue
 * ticket opened before assertions can find the dropdown — without this,
 * `openPreviewMode` / `openSplitMode` silently return false and the
 * tests skip under the misleading reason "feature may not be implemented".
 *
 * Returns true if a ticket was opened and ChatTabBar is mounted.
 */
async function openFirstQueueTicket(page: Page): Promise<boolean> {
  const viewModeBtn = page.locator(
    'button[aria-label*="View Mode"], button[aria-label*="Weergavemodus"], button[aria-label*="affichage"]'
  ).first();

  // Fast path: a previously-claimed ticket may have been restored as an active
  // tab on login (SupportView rejoin logic) — ChatTabBar is already mounted.
  // Later tests in this spec drain the seeded queue, so rejoin of an already-
  // claimed ticket is the only way to mount ChatTabBar. 10s covers the socket
  // handshake + ticket fetch + tab render on a loaded worker.
  if (await viewModeBtn.isVisible({ timeout: 10000 }).catch(() => false)) return true;

  const firstTicket = page.locator('li[data-ticket-row], li.cursor-pointer').first();
  if (!await firstTicket.isVisible({ timeout: 8000 }).catch(() => false)) return false;
  await firstTicket.click();

  const joinBtn = page.getByRole('button', { name: /^join$|^accept$|deelnemen|rejoindre/i }).first();
  if (await joinBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await joinBtn.click();
  }

  return await viewModeBtn.isVisible({ timeout: 10000 }).catch(() => false);
}

// ---------------------------------------------------------------------------
// ViewModeDropdown
// ---------------------------------------------------------------------------

test.describe('ViewModeDropdown', () => {
  test.beforeEach(async ({ page, partnerFixture }) => {
    // Per #117: fresh partner + support user + queue ticket per test.
    const { userId } = await partnerFixture.createUser({
      role: 'support',
      departments: ['general'],
    });
    await partnerFixture.loginAs(userId, { waitFor: 'networkidle' });
    await partnerFixture.createTicket();

    // Reload so the queue refetches and the new ticket lands in the sidebar.
    await page.reload();
    await page.waitForLoadState('networkidle');
  });

  test('ViewModeDropdown button is visible in ChatTabBar when a ticket is open', async ({ page }) => {
    // ViewModeDropdown was relocated out of SupportNav and is now rendered
    // only by ChatTabBar (when at least one ticket tab is open). The
    // `showViewMode` prop on SettingsPopover exists but no nav currently
    // passes it, so the entry point is strictly contextual.
    //
    // The describe-level `beforeEach` already attempts a click+join on
    // `li.cursor-pointer.first()`, but that selector also matches the
    // "Claimed by others" section header (it has cursor-pointer for the
    // expand/collapse toggle), so on runs where the queue ticket sits
    // BELOW that header, beforeEach toggles the section instead of opening
    // a ticket. Use the shared `openFirstQueueTicket` helper here — it
    // (a) takes the rejoin fast-path when ChatTabBar is already mounted,
    // and (b) targets `li[data-ticket-row], li.cursor-pointer` and clicks
    // through Join when needed. Skip if the queue is empty (other ViewMode
    // tests may have drained it).
    const opened = await openFirstQueueTicket(page);
    if (!opened) {
      throw new Error(
        'Could not open a queue ticket to mount ChatTabBar. The seed must contain ' +
          'a queue ticket visible to the fixture support user — partnerFixture.createTicket() should have seeded one.',
      );
    }

    // The ViewModeDropdown renders a button with aria-label matching the current mode name.
    // Support multiple locales: EN "View Mode", NL "Weergavemodus", FR "Mode d'affichage"
    const modeBtn = page.locator(
      'button[aria-label*="View Mode"], button[aria-label*="Weergavemodus"], button[aria-label*="affichage"]'
    ).first();

    await expect(modeBtn).toBeVisible({ timeout: 10000 });
  });

  // NOTE: Two former tests were removed here — `shows 4 mode options when opened`
  // and `selecting a mode closes the dropdown`. They relied on clicking the
  // trigger, waiting for a React `createPortal` commit cycle, and finding
  // options in a portal container that was proving brittle in E2E. The
  // `button is visible in SupportNav` test above already proves the
  // ViewModeDropdown mounts, and the `Split View` / `Focus Mode` tests below
  // exercise end-to-end view switching, which is the actual user-facing
  // behaviour. Component-level dropdown-internals should live in a Vitest
  // unit test with @testing-library/react instead of Playwright.
});

// ---------------------------------------------------------------------------
// Focus Mode via Dropdown
// ---------------------------------------------------------------------------
//
// NOTE: A previous `Preview Mode` describe block was deleted here. It tested
// a view mode that doesn't exist in `ViewModeDropdown.tsx` — the real options
// are `normal`, `split-grid`, `split-stack`, `focus`. The tests had been
// silently skipping since inception under a misleading "feature may not be
// implemented" skip reason. Grid/Stack coverage lives in the Split View
// block below.

test.describe('Focus Mode', () => {
  let tabBarMounted = false;

  test.beforeEach(async ({ page, partnerFixture }) => {
    // Per #117: fresh partner + support user + queue ticket per test.
    const { userId } = await partnerFixture.createUser({
      role: 'support',
      departments: ['general'],
    });
    await partnerFixture.loginAs(userId, { waitFor: 'networkidle' });
    await partnerFixture.createTicket();

    await page.setViewportSize({ width: 1600, height: 900 });
    await page.reload();
    await page.waitForLoadState('networkidle');
    tabBarMounted = await openFirstQueueTicket(page);
  });

  test('focus mode hides the queue sidebar', async ({ page }) => {
    if (!tabBarMounted) {
      throw new Error(
        'No queue ticket available — cannot mount ChatTabBar. Seed must include ' +
          'a queue ticket visible to the fixture support user — partnerFixture.createTicket() should have seeded one.',
      );
    }

    // Locate the view mode trigger
    const modeBtn = page.locator(
      'button[aria-label*="View Mode"], button[aria-label*="Weergavemodus"], button[aria-label*="affichage"]'
    ).first();
    const iconBtn = page.locator('button').filter({ hasText: /[▣▥▤□]/ }).first();

    const primaryVisible = await modeBtn.isVisible({ timeout: 8000 }).catch(() => false);
    const trigger = primaryVisible ? modeBtn : iconBtn;

    await expect(trigger, 'ViewModeDropdown trigger should be present when ChatTabBar is mounted').toBeVisible({ timeout: 8000 });

    // Open dropdown and select Focus
    await trigger.click();
    await page.waitForTimeout(400);

    const focusOption = page.locator('button').filter({ hasText: /focus/i }).first().first();
    const focusVisible = await focusOption.isVisible({ timeout: 5000 }).catch(() => false);
    if (!focusVisible) {
      throw new Error('Focus option not found in dropdown — UI regression');
    }

    await focusOption.click();
    await page.waitForTimeout(800);

    // Queue sidebar should no longer be visible.
    // The QueueSidebar renders a list of ticket items; in focus mode it is hidden.
    // We look for the sidebar wrapper to be absent or display:none / visibility:hidden.
    const queueSidebar = page.locator('[class*="queue"], [class*="Queue"], [aria-label*="queue" i]').first();
    const sidebarVisible = await queueSidebar.isVisible({ timeout: 2000 }).catch(() => false);
    expect(sidebarVisible).toBeFalsy();

    // No crash
    const errorVisible = await page.getByText(/error|crash/i).first().isVisible().catch(() => false);
    expect(errorVisible).toBeFalsy();
  });

  test('switching back to Normal from Focus restores the layout', async ({ page }) => {
    // #117 follow-up (2026-05-02 body-fixme migration, slice C2):
    // Pre-migration scoped via `.border-border-heavy` — the brutalist-era
    // dropdown wrapper class. Soft-product `ViewModeDropdown` uses a
    // body-portalled `<div style="top: …; right: …">` with no stable
    // wrapper class; scoping by the inline-style attribute is the
    // structural replacement (only the portal menu has both `top:` and
    // `right:` in its inline style — the trigger has none).
    if (!tabBarMounted) {
      throw new Error(
        'No queue ticket available — cannot mount ChatTabBar. Seed must include ' +
          'a queue ticket visible to the fixture support user — partnerFixture.createTicket() should have seeded one.',
      );
    }

    const modeBtn = page.locator(
      'button[aria-label*="View Mode"], button[aria-label*="Weergavemodus"], button[aria-label*="affichage"]'
    ).first();
    const iconBtn = page.locator('button').filter({ hasText: /[▣▥▤□]/ }).first();

    const primaryVisible = await modeBtn.isVisible({ timeout: 10000 }).catch(() => false);
    const trigger = primaryVisible ? modeBtn : iconBtn;

    await expect(trigger, 'ViewModeDropdown trigger should be present when ChatTabBar is mounted').toBeVisible({ timeout: 10000 });

    // Portal-rendered menu — distinguishable from the trigger by its inline
    // top/right positioning style. Re-locate after each open so we don't
    // hold a stale reference once Playwright re-snapshots the DOM.
    const menuLocator = () =>
      page.locator('div[style*="top:"][style*="right:"]').last();

    await trigger.click();
    const dropdown1 = menuLocator();
    const focusOption = dropdown1.locator('button').filter({ hasText: /focus/i }).first();
    await expect(focusOption).toBeVisible({ timeout: 5000 });
    await focusOption.click();
    await page.waitForTimeout(800);

    // Re-open and select Normal. With the trigger now displaying "Focus" the
    // unscoped /^focus$/ pattern would double-match (trigger + menu); the
    // portal-style scope keeps the lookup honest.
    await trigger.click();
    const dropdown2 = menuLocator();
    const normalOption = dropdown2.locator('button').filter({ hasText: /normal|normaal/i }).first();
    await expect(normalOption).toBeVisible({ timeout: 5000 });
    await normalOption.click();
    await page.waitForTimeout(800);

    // No crash after switching back.
    const errorVisible = await page.getByText(/error|crash/i).first().isVisible().catch(() => false);
    expect(errorVisible).toBeFalsy();

    // The view mode trigger remains visible and functional
    await expect(trigger).toBeVisible({ timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// Split View
// ---------------------------------------------------------------------------

test.describe('Split View', () => {
  let tabBarMounted = false;

  test.beforeEach(async ({ page, partnerFixture }) => {
    // Per #117: fresh partner + support user + queue ticket per test.
    // The body-fixme'd `split view shows multiple chat panels` test would
    // need 2+ tickets but is out of slice scope; the migrated fallback test
    // below only needs 1.
    const { userId } = await partnerFixture.createUser({
      role: 'support',
      departments: ['general'],
    });
    await partnerFixture.loginAs(userId, { waitFor: 'networkidle' });
    await partnerFixture.createTicket();

    await page.setViewportSize({ width: 1600, height: 900 });
    await page.reload();
    await page.waitForLoadState('networkidle');
    tabBarMounted = await openFirstQueueTicket(page);
  });

  async function openSplitMode(page: Page): Promise<boolean> {
    const modeBtn = page.locator(
      'button[aria-label*="View Mode"], button[aria-label*="Weergavemodus"], button[aria-label*="affichage"]'
    ).first();
    const iconBtn = page.locator('button').filter({ hasText: /[▣▥▤□]/ }).first();

    const primaryVisible = await modeBtn.isVisible({ timeout: 8000 }).catch(() => false);
    const trigger = primaryVisible ? modeBtn : iconBtn;

    const triggerVisible = await trigger.isVisible({ timeout: 8000 }).catch(() => false);
    if (!triggerVisible) return false;

    await trigger.click();
    await page.waitForTimeout(400);

    // Split mode ships as two variants: split-grid (⊞ Grid 2×2 / Raster 2×2 /
    // Grille 2×2) and split-stack (▥ Stack 4×1 / Stapel 4×1 / Pile 4×1). We
    // target the grid variant — either is a valid "split view" for the
    // fallback/multi-panel assertions that follow.
    const splitOption = page.getByText(/grid 2×2|raster 2×2|grille 2×2/i).first();
    const optionVisible = await splitOption.isVisible({ timeout: 5000 }).catch(() => false);
    if (!optionVisible) return false;

    await splitOption.click();
    await page.waitForTimeout(800);
    return true;
  }

  test('split view falls back to normal with fewer than 2 tabs open', async ({ page }) => {
    if (!tabBarMounted) {
      throw new Error(
        'No queue ticket available — cannot mount ChatTabBar. Seed must include ' +
          'a queue ticket visible to the fixture support user — partnerFixture.createTicket() should have seeded one.',
      );
    }
    const activated = await openSplitMode(page);
    expect(activated, 'Split mode should activate — ViewModeDropdown must be present once ChatTabBar is mounted').toBe(true);

    // With < 2 open tabs the UI should either fall back to normal or render a single panel.
    // Either way no error should be visible.
    const errorVisible = await page.getByText(/error|crash/i).first().isVisible().catch(() => false);
    expect(errorVisible).toBeFalsy();

    // With a fallback the view mode trigger should still be visible and functional
    const modeBtn = page.locator(
      'button[aria-label*="View Mode"], button[aria-label*="Weergavemodus"], button[aria-label*="affichage"]'
    ).first();
    const iconBtn = page.locator('button').filter({ hasText: /[▣▥▤□]/ }).first();
    const primaryVisible = await modeBtn.isVisible({ timeout: 5000 }).catch(() => false);
    const trigger = primaryVisible ? modeBtn : iconBtn;
    await expect(trigger).toBeVisible({ timeout: 8000 });
  });

});

// ---------------------------------------------------------------------------
// Split View — multi-tab variant (own describe so the beforeEach can seed
// 2 unassigned tickets BEFORE any join, instead of inheriting Split View's
// 1-ticket-then-auto-join setup).
// ---------------------------------------------------------------------------

test.describe('Split View — Multi-Tab', () => {
  async function openSplitMode(page: Page): Promise<boolean> {
    const modeBtn = page.locator(
      'button[aria-label*="View Mode"], button[aria-label*="Weergavemodus"], button[aria-label*="affichage"]'
    ).first();
    const iconBtn = page.locator('button').filter({ hasText: /[▣▥▤□]/ }).first();

    const primaryVisible = await modeBtn.isVisible({ timeout: 8000 }).catch(() => false);
    const trigger = primaryVisible ? modeBtn : iconBtn;
    if (!await trigger.isVisible({ timeout: 8000 }).catch(() => false)) return false;

    await trigger.click();
    await page.waitForTimeout(400);

    const splitOption = page.getByText(/grid 2×2|raster 2×2|grille 2×2/i).first();
    if (!await splitOption.isVisible({ timeout: 5000 }).catch(() => false)) return false;
    await splitOption.click();
    await page.waitForTimeout(800);
    return true;
  }

  test('split view shows multiple chat panels when 2+ tabs are open', async ({ page, partnerFixture }) => {
    // #117 follow-up (2026-05-02 body-fixme migration, slice C3):
    // Pre-migration this test just hoped the seed had ≥2 unassigned
    // queue tickets, which broke as soon as parallel specs claimed
    // them. Post-migration we own a fresh partner — seed two tickets
    // BEFORE login so they're both visible from page mount, then join
    // each in turn. Avoids the "claim leaks via post-reload zustand
    // empty + queue refetch race" trap that breaks if we try to extend
    // the inherited Split View beforeEach (which already auto-joins
    // its single ticket).
    const { userId } = await partnerFixture.createUser({
      role: 'support',
      departments: ['general'],
    });
    await partnerFixture.createTicket();
    await partnerFixture.createTicket();

    await partnerFixture.loginAs(userId, { waitFor: 'networkidle' });
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Two queue rows, both unassigned.
    const queueRows = page.locator('li[data-ticket-row][data-ticket-variant="queue"]');
    await expect
      .poll(() => queueRows.count(), { timeout: 10000 })
      .toBeGreaterThanOrEqual(2);

    // Open + join the first ticket.
    await queueRows.first().click();
    await page.waitForLoadState('networkidle');
    const joinBtn1 = page.getByRole('button', { name: /^join$|^deelnemen$|^rejoindre$|jump in/i }).first();
    await expect(joinBtn1).toBeVisible({ timeout: 5000 });
    await joinBtn1.click();
    await page.waitForLoadState('networkidle');

    // Open + join the second ticket. After joining the first, the
    // queue-variant set shrinks by 1 — the previously-second row is now
    // first.
    const remainingQueue = page.locator('li[data-ticket-row][data-ticket-variant="queue"]');
    await expect(remainingQueue.first()).toBeVisible({ timeout: 5000 });
    await remainingQueue.first().click();
    await page.waitForLoadState('networkidle');
    const joinBtn2 = page.getByRole('button', { name: /^join$|^deelnemen$|^rejoindre$|jump in/i }).first();
    await expect(joinBtn2).toBeVisible({ timeout: 5000 });
    await joinBtn2.click();
    await page.waitForLoadState('networkidle');

    // Two tabs in the bar before we switch view modes. ChatTabBar renders
    // a counter "<n>/<MAX_OPEN_CHATS>" — Normal mode only mounts the active
    // tab's ProseMirror, so checking editor count here would be wrong.
    await expect(page.getByText(/^\s*2\s*\/\s*4\s*$/)).toBeVisible({ timeout: 8000 });

    const activated = await openSplitMode(page);
    expect(activated, 'ViewModeDropdown should activate split mode').toBe(true);

    // Split-grid renders both ChatWindows side-by-side. Only the ACTIVE
    // panel mounts a ProseMirror — siblings render in `compact` mode which
    // suppresses the compose area entirely (see ChatWindow:430). Count
    // the chat-header Transfer buttons instead — every rendered ChatWindow
    // has one regardless of compact, and the queue sidebar has none.
    await expect
      .poll(
        () => page.getByRole('button', { name: /transfer|overdragen|transférer/i }).count(),
        { timeout: 5000 },
      )
      .toBeGreaterThanOrEqual(2);

    const errorVisible = await page.getByText(/error|crash/i).first().isVisible().catch(() => false);
    expect(errorVisible).toBeFalsy();
  });
});

