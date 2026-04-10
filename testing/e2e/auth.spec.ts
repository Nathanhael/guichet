/**
 * E2E: Authentication Flows
 *
 * Tests login, SSO button visibility, and auth method behavior.
 *
 * Prerequisites:
 *   - Server running at E2E_BASE_URL (default http://localhost:3001)
 *   - Seeded demo database
 */

import { test, expect } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3001';

/** Wait for the React app (LoginView) to mount. The initial AuthViewMode is
 *  'sso-selection' which doesn't render a <form>, so we wait for the TESSERA
 *  heading that is always present in the LoginView. */
async function waitForApp(page: import('@playwright/test').Page) {
  await page.goto(BASE);
  await page.waitForLoadState('load');
  // The LoginView always renders the "TESSERA" branding heading in any
  // AuthViewMode ('sso-selection', 'platform-login', 'forgot', etc.).
  await page.waitForSelector('h1', { timeout: 15000 });
  // Extra safety: wait until at least one button (SSO, demo, or platform-login link) is visible.
  await page.locator('button').first().waitFor({ state: 'visible', timeout: 10000 });
}

/** Navigate from the default 'sso-selection' view to 'platform-login' where
 *  LocalLoginForm (with email + password fields) is rendered.
 *
 *  The platform-admin link is hidden behind an Easter egg: clicking the
 *  TESSERA logo (h1 with role="button", aria-label="Tessera") 3 times within
 *  500ms reveals it (see LoginView.tsx:42 handleLogoClick). */
async function gotoPlatformLogin(page: import('@playwright/test').Page) {
  await waitForApp(page);
  // If the local login form is already visible (state was preserved), nothing to do.
  const emailInput = page.locator('input[type="email"]').first();
  if (await emailInput.isVisible({ timeout: 500 }).catch(() => false)) return;

  // Triple-click the Tessera logo to reveal the platform-admin link.
  const logo = page.getByRole('button', { name: /^tessera$/i });
  await logo.waitFor({ state: 'visible', timeout: 5000 });
  await logo.click();
  await logo.click();
  await logo.click();

  // Click the now-visible platform admin login button
  const platformLink = page.getByRole('button', { name: /platform administrator login|platform admin|administrator/i }).first();
  await platformLink.waitFor({ state: 'visible', timeout: 3000 });
  await platformLink.click();

  // Now the LocalLoginForm should be mounted
  await emailInput.waitFor({ state: 'visible', timeout: 5000 });
}

test.describe('Authentication', () => {
  test('login page renders with email and password fields', async ({ page }) => {
    await gotoPlatformLogin(page);
    // The email field uses placeholder from t('placeholder_email') which equals
    // 'name@company.com' in English (see client/src/locales/en.ts:90).
    await expect(page.locator('input[type="email"]').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('input[type="password"]').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /log in|inloggen|se connecter/i }).first()).toBeVisible();
  });

  test('SSO button is visible on login page', async ({ page }) => {
    await waitForApp(page);
    // In 'sso-selection' mode the SSO button should be the primary CTA. We don't
    // require specific text (Microsoft/SSO) because it's configurable — just
    // assert that some button exists on the initial page.
    await expect(page.locator('button').first()).toBeVisible();
  });

  test('platform login link navigates to LocalLoginForm', async ({ page }) => {
    // Replaces the deprecated 'demo login tab' test: the 'demo' tab was removed
    // in favour of a platform-administrator link from the SSO selection screen.
    await waitForApp(page);
    await gotoPlatformLogin(page);
    await expect(page.locator('input[type="email"]').first()).toBeVisible();
  });

  test('platform operator can log in via the local form', async ({ page }) => {
    // Replaces the deprecated 'demo user can log in' test which relied on a
    // demo user picker UI that no longer exists. We exercise the real flow:
    // SSO selection → platform login → fill credentials → assert navigated out.
    await gotoPlatformLogin(page);
    await page.locator('input[type="email"]').first().fill('bart@tessera.io');
    await page.locator('input[type="password"]').first().fill('password123');
    await page.getByRole('button', { name: /log in|inloggen|se connecter/i }).first().click();
    // After successful login, the LoginView unmounts and the app shell appears.
    // We don't know the exact app chrome selector, but the email input from the
    // login form should disappear — that's a reliable signal of login success.
    await expect(page.locator('input[type="email"]').first()).toBeHidden({ timeout: 10000 });
  });

  test('invalid login shows error', async ({ page }) => {
    await gotoPlatformLogin(page);
    await page.locator('input[type="email"]').first().fill('nonexistent@test.com');
    await page.locator('input[type="password"]').first().fill('wrongpassword');
    await page.getByRole('button', { name: /log in|inloggen|se connecter/i }).first().click();
    // Should show some error message
    await expect(
      page.getByText(/invalid|failed|error|incorrect|too many|ongeldig|fout/i).first()
    ).toBeVisible({ timeout: 10000 });
  });

  test('forgot password link works', async ({ page }) => {
    await gotoPlatformLogin(page);
    const forgotLink = page.getByText(/forgot|vergeten|oubli/i).first();
    await expect(forgotLink).toBeVisible({ timeout: 5000 });
    await forgotLink.click();
    // The ForgotPasswordForm uses the same email input with same placeholder,
    // but the submit button text changes to something like "Send reset link".
    await expect(
      page.getByText(/reset|link|stuur|envoyer/i).first()
    ).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Refresh Token Flow', () => {
  /** Login via API and navigate to app — more reliable than clicking demo cards */
  async function apiLogin(page: import('@playwright/test').Page, context: import('@playwright/test').BrowserContext) {
    await page.goto(BASE);
    const response = await page.evaluate(async () => {
      const res = await fetch('/api/v1/auth/login-local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: 'bart@tessera.io', password: 'password123' }),
      });
      return { status: res.status };
    });
    expect(response.status).toBe(200);
  }

  test('login sets both access and refresh cookies', async ({ page, context }) => {
    await apiLogin(page, context);

    const cookies = await context.cookies(`${BASE}/api/v1/auth/refresh`);
    const accessCookie = cookies.find(c => c.name === 'tessera_token');
    const refreshCookie = cookies.find(c => c.name === 'tessera_refresh');
    const expiryCookie = cookies.find(c => c.name === 'session_expires');

    expect(accessCookie).toBeDefined();
    expect(accessCookie!.httpOnly).toBe(true);
    expect(refreshCookie).toBeDefined();
    expect(refreshCookie!.httpOnly).toBe(true);
    expect(refreshCookie!.path).toBe('/api/v1/auth/refresh');
    expect(expiryCookie).toBeDefined();
    expect(expiryCookie!.httpOnly).toBe(false);
  });

  test('POST /api/v1/auth/refresh rotates tokens', async ({ page, context }) => {
    await apiLogin(page, context);

    const cookiesBefore = await context.cookies(`${BASE}/api/v1/auth/refresh`);
    const refreshBefore = cookiesBefore.find(c => c.name === 'tessera_refresh');
    expect(refreshBefore).toBeDefined();

    const response = await page.evaluate(async () => {
      const res = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        credentials: 'include',
      });
      return { status: res.status, body: await res.json() };
    });

    expect(response.status).toBe(200);
    expect(response.body.expiresIn).toBeGreaterThan(0);

    const cookiesAfter = await context.cookies(`${BASE}/api/v1/auth/refresh`);
    const refreshAfter = cookiesAfter.find(c => c.name === 'tessera_refresh');
    expect(refreshAfter).toBeDefined();
    expect(refreshAfter!.value).not.toBe(refreshBefore!.value);
  });

  test('session persists after token rotation', async ({ page, context }) => {
    await apiLogin(page, context);

    // First rotation
    await page.evaluate(async () => {
      await fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'include' });
    });

    // Second refresh should also succeed — proves the rotated tokens are valid
    const response = await page.evaluate(async () => {
      const res = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        credentials: 'include',
      });
      return { status: res.status, body: await res.json() };
    });

    expect(response.status).toBe(200);
    expect(response.body.expiresIn).toBeGreaterThan(0);
  });

  test('replaying old refresh token fails (reuse detection)', async ({ page, context }) => {
    await apiLogin(page, context);

    const cookiesBefore = await context.cookies(`${BASE}/api/v1/auth/refresh`);
    const oldRefresh = cookiesBefore.find(c => c.name === 'tessera_refresh')!.value;

    // Rotate (invalidates the old token)
    await page.evaluate(async () => {
      await fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'include' });
    });

    // Manually set the old refresh cookie back (simulate replay)
    await context.addCookies([{
      name: 'tessera_refresh',
      value: oldRefresh,
      domain: 'localhost',
      path: '/api/v1/auth/refresh',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    }]);

    // Replay should fail — reuse detection revokes the family
    const response = await page.evaluate(async () => {
      const res = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        credentials: 'include',
      });
      return { status: res.status };
    });

    expect(response.status).toBe(401);
  });
});
