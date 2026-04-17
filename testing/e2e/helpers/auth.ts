import type { Page } from '@playwright/test';

/**
 * Shared Playwright helpers for the E2E suite. Previously every spec held a
 * copy of `loginAsDemo`, which made a historic race hard to fix everywhere
 * at once (the second `page.evaluate(sessionStorage.setItem)` could find its
 * execution context destroyed if the login fetch triggered a client-side
 * navigation — classic "Execution context was destroyed, most likely because
 * of a navigation" flake).
 *
 * The helper below does the whole dance — login fetch + sessionStorage seed
 * — inside a single `page.evaluate`, so there is no window for a navigation
 * to land between the two steps. The explicit `await page.reload()` is the
 * only navigation we then invoke, and we await its completion before
 * returning to the caller.
 */

export const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3001';
export const DEMO_PASSWORD = 'password123';

export interface LoginResult {
  ok: boolean;
  status?: number;
  user?: { id: string; name: string; email: string; role: string; isPlatformOperator?: boolean; lang?: string };
  memberships?: Array<{ id: string; partnerId: string; partnerName: string; role: string }>;
  activePartnerId?: string;
}

export interface LoginOptions {
  /**
   * Force a specific locale override on the stored `user` object — matches
   * the pattern used by `chat-demo.spec.ts` where specific fixtures are
   * assigned different UI languages to exercise the i18n path.
   */
  lang?: string;
  /**
   * Which Playwright load state to wait for after the initial `page.goto`
   * and after the post-login reload. Default `'load'`. Chat-heavy specs
   * that need socket/network quiescence (e.g. chat-enhancements) pass
   * `'networkidle'`.
   */
  waitFor?: 'load' | 'networkidle';
  /**
   * Whether to seed `activeMembershipId` / `activePartnerId` in
   * sessionStorage.
   *   `'auto'` (default) — seed unless the logged-in user is a platform
   *   operator. Platform operators land on PlatformView and should not be
   *   auto-routed into a partner's AdminView.
   *   `false` — never seed (e.g. platform-only scenarios).
   *   `true` — always seed (legacy behavior).
   */
  seedActiveMembership?: 'auto' | boolean;
}

/**
 * Log a demo user in via `/api/v1/auth/login` and seed the expected
 * sessionStorage keys the Zustand auth slice hydrates from. Returns the
 * parsed login response so the caller can assert on it or skip the test
 * when the seed data is missing.
 */
export async function loginAsDemo(
  page: Page,
  userId: string,
  options: LoginOptions = {},
): Promise<LoginResult> {
  const waitFor = options.waitFor ?? 'load';
  const seedActiveMembership = options.seedActiveMembership ?? 'auto';
  const lang = options.lang;

  await page.goto(BASE);
  await page.waitForLoadState(waitFor);

  const data = await page.evaluate(
    async ({ uid, seedMode, langOverride }) => {
      const res = await fetch('/api/v1/auth/dev-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ userId: uid }),
      });
      if (!res.ok) return { ok: false, status: res.status } as LoginResult;
      const json = (await res.json()) as {
        user: LoginResult['user'] & Record<string, unknown>;
        memberships: LoginResult['memberships'];
        activePartnerId?: string;
      };

      // Apply caller-supplied locale override so fixtures that expect a
      // specific UI language get it even when the server-side user row has
      // a different default.
      if (langOverride && json.user) {
        json.user.lang = langOverride;
      }

      // Seed Zustand-hydrated keys in the SAME evaluate so a stray navigation
      // (auth-reactive hook, useTokenRefresh kick-off, etc.) cannot destroy
      // the execution context between "login succeeded" and "sessionStorage
      // written" — the flake the E2E suite used to chase across 16 specs.
      sessionStorage.setItem('user', JSON.stringify(json.user));
      sessionStorage.setItem('memberships', JSON.stringify(json.memberships));

      const isPlatformOp = Boolean(json.user?.isPlatformOperator);
      const shouldSeedMembership =
        seedMode === true || (seedMode === 'auto' && !isPlatformOp);
      if (shouldSeedMembership && json.memberships && json.memberships.length > 0) {
        sessionStorage.setItem('activeMembershipId', json.memberships[0].id);
        sessionStorage.setItem('activePartnerId', json.memberships[0].partnerId);
      }
      return { ok: true, ...json } as LoginResult;
    },
    {
      uid: userId,
      seedMode: seedActiveMembership,
      langOverride: lang ?? null,
    },
  );

  if (!data.ok) {
    // eslint-disable-next-line no-console
    console.error(`[loginAsDemo] Login API failed for ${userId}: ${data.status}`);
    return data;
  }

  await page.reload();
  await page.waitForLoadState(waitFor);
  return data;
}
