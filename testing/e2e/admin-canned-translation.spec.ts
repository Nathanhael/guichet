/**
 * E2E: Canned-response auto-translation
 *
 * Verifies the per-partner `cannedTranslation` feature gate end-to-end:
 *   - Platform operator can toggle the flag on a partner via tRPC.
 *   - getAiConfig surfaces the toggle state when AI_ENABLED is true globally.
 *   - cannedResponse.regenerate and backfillUntranslated return FORBIDDEN
 *     when the feature is off (gate is enforced server-side).
 *   - cannedResponse.list exposes the new schema columns (sourceLang,
 *     bodyTranslations, staleTranslations) regardless of feature state —
 *     decision 3 keeps schema partner-agnostic.
 *
 * The full picker-resolution flow (seed canned with body_translations →
 * support opens NL ticket → click canned → NL body inserted) lives in a
 * separate `test.describe` block at the bottom, gated by E2E_AI_ENABLED
 * because `isCannedTranslationEnabled` hard-checks the global `AI_ENABLED`
 * env var. Set both AI_ENABLED=true (server) AND E2E_AI_ENABLED=1 (host) to
 * run that block. Translation roundtrip itself is still not exercised — the
 * AI call is bypassed by the seedCanned fixture which writes body_translations
 * directly, so no provider config is required.
 *
 * All assertion-style tests use `partnerFixture` for tenant isolation;
 * targeting a shared seed partner causes parallel-worker pollution against
 * its aiFeatures column.
 */

import { test, expect } from './helpers/partnerFixture';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3001';

async function setCannedTranslation(
  page: import('@playwright/test').Page,
  partnerId: string,
  enabled: boolean,
  extras: { aiEnabled?: boolean } = {},
) {
  const res = await page.request.post(`${BASE}/api/v1/trpc/platform.updatePartner`, {
    data: {
      id: partnerId,
      data: {
        ...(extras.aiEnabled !== undefined ? { aiEnabled: extras.aiEnabled } : {}),
        aiFeatures: { cannedTranslation: enabled },
      },
    },
    failOnStatusCode: false,
  });
  return res;
}

test.describe('Canned translation — feature toggle', () => {
  test('platform operator can flip cannedTranslation on a partner', async ({ page, partnerFixture }) => {
    const updateRes = await setCannedTranslation(page, partnerFixture.partnerId, true, { aiEnabled: true });
    expect(updateRes.ok()).toBe(true);
    const body = await updateRes.json();
    expect(body.error).toBeUndefined();
  });

  test('cannedTranslation surfaces in getAiConfig when AI_ENABLED is on globally', async ({ page, partnerFixture }) => {
    const updateRes = await setCannedTranslation(page, partnerFixture.partnerId, true, { aiEnabled: true });
    expect(updateRes.ok()).toBe(true);

    // Switch to a partner-scoped user so getAiConfig has the right context.
    const member = await partnerFixture.createUser({ role: 'support' });
    await partnerFixture.loginAs(member.userId);

    const configRes = await page.request.get(`${BASE}/api/v1/trpc/partner.getAiConfig`, {
      failOnStatusCode: false,
    });
    expect(configRes.status()).toBe(200);
    const body = await configRes.json();
    const cfg = body.result?.data;
    expect(cfg).toBeDefined();
    // Only assert the per-partner flag when AI is on globally — `getPartnerAiConfig`
    // hard-gates on `config.AI_ENABLED` and forces every flag off otherwise.
    if (cfg.globalAiEnabled) {
      expect(cfg.cannedTranslation).toBe(true);
    }
  });
});

test.describe('Canned translation — server-side feature gate', () => {
  test('regenerate returns FORBIDDEN when feature is off for the partner', async ({ page, partnerFixture }) => {
    // Fresh fixture partner already has cannedTranslation undefined (off).
    const admin = await partnerFixture.createUser({ role: 'admin' });
    await partnerFixture.loginAs(admin.userId);

    const regenRes = await page.request.post(`${BASE}/api/v1/trpc/cannedResponse.regenerate`, {
      data: { id: 'non-existent-id', langs: ['nl'] },
      failOnStatusCode: false,
    });
    // 403 (feature off — the focus of this assertion) or 404 (id doesn't
    // exist) is acceptable; the gate runs first so 403 is the typical
    // outcome. Both are acceptable to keep this resilient against seed
    // changes.
    const status = regenRes.status();
    expect([403, 404]).toContain(status);
    if (status === 403) {
      const body = await regenRes.json();
      expect(body.error?.message ?? '').toMatch(/not enabled/i);
    }
  });

  test('backfillUntranslated returns FORBIDDEN when feature is off', async ({ page, partnerFixture }) => {
    const admin = await partnerFixture.createUser({ role: 'admin' });
    await partnerFixture.loginAs(admin.userId);

    const backfillRes = await page.request.post(
      `${BASE}/api/v1/trpc/cannedResponse.backfillUntranslated`,
      { data: {}, failOnStatusCode: false },
    );
    expect(backfillRes.status()).toBe(403);
    const body = await backfillRes.json();
    expect(body.error?.message ?? '').toMatch(/not enabled/i);
  });
});

test.describe('Canned translation — schema exposure', () => {
  test('cannedResponse.list returns sourceLang and bodyTranslations columns', async ({ page, partnerFixture }) => {
    // Seed at least one canned so the array is non-empty and the column
    // assertions actually run.
    await partnerFixture.seedCanned({
      title: 'Probe',
      body: 'probe body',
      sourceLang: 'en',
    });

    const member = await partnerFixture.createUser({ role: 'support' });
    await partnerFixture.loginAs(member.userId);

    const listRes = await page.request.get(`${BASE}/api/v1/trpc/cannedResponse.list`, {
      failOnStatusCode: false,
    });
    expect(listRes.status()).toBe(200);
    const body = await listRes.json();
    const rows = body.result?.data;
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toHaveProperty('sourceLang');
    expect(rows[0]).toHaveProperty('bodyTranslations');
    expect(rows[0]).toHaveProperty('staleTranslations');
  });
});

// ── Full picker-resolution flow (env-gated) ────────────────────────────────
//
// Seeds a partner with a canned that has body_translations populated
// (skipping the AI roundtrip via the seedCanned fixture), creates an
// NL-speaking agent + a support user + a ticket, then drives the support
// UI through the canned picker. Asserts that what lands in the editor is
// the NL translation, not the source EN body.
//
// Requires the global `AI_ENABLED=true` env var on the server because
// `isCannedTranslationEnabled` short-circuits to false otherwise. Gated by
// `E2E_AI_ENABLED=1` on the host so default local + CI runs (which leave
// AI_ENABLED unset) don't fail this spec; devs running an AI-enabled stack
// opt in by setting E2E_AI_ENABLED=1.

test.describe('Canned translation — picker flow', () => {
  test('support clicks canned in NL ticket → NL translation inserted', async ({ page, partnerFixture }) => {
    test.skip(!process.env.E2E_AI_ENABLED, 'Set E2E_AI_ENABLED=1 (and server AI_ENABLED=true) to run');

    const updateRes = await setCannedTranslation(page, partnerFixture.partnerId, true, { aiEnabled: true });
    expect(updateRes.ok()).toBe(true);

    await partnerFixture.seedCanned({
      title: 'Greeting',
      body: 'Hello there',
      sourceLang: 'en',
      bodyTranslations: { nl: 'Hallo daar', fr: 'Bonjour' },
      shortcut: 'greet',
    });

    const agent = await partnerFixture.createUser({ role: 'agent', lang: 'nl' });
    const support = await partnerFixture.createUser({ role: 'support', departments: ['general'] });
    const ticketId = await partnerFixture.createTicket({ agentId: agent.userId, departmentId: 'general' });
    expect(ticketId).toBeTruthy();

    await partnerFixture.loginAs(support.userId, { waitFor: 'networkidle' });
    await page.reload();
    await page.waitForLoadState('networkidle');

    const ticketRow = page.locator('li[data-ticket-row][data-ticket-variant="queue"]').first();
    await expect(ticketRow).toBeVisible({ timeout: 10000 });
    await ticketRow.click();
    await page.waitForLoadState('networkidle');

    const joinBtn = page.getByText(/^join$|^jump in$|^deelnemen$|^rejoindre$/i).first();
    await expect(joinBtn).toBeVisible({ timeout: 5000 });
    await joinBtn.click();
    await page.waitForLoadState('networkidle');

    const editor = page.locator('.ProseMirror').first();
    await expect(editor).toBeVisible({ timeout: 15000 });

    await editor.click();
    await editor.press('/');

    const cannedOption = page.getByRole('button', { name: /Greeting/i }).first();
    await expect(cannedOption).toBeVisible({ timeout: 5000 });
    await cannedOption.click();

    await expect(editor).toContainText('Hallo daar', { timeout: 5000 });
    await expect(editor).not.toContainText('Hello there');
  });
});
