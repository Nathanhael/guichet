import type { BrowserContext } from '@playwright/test';
import { API_URL, APP_URL, TEST_USERS } from './constants.js';

/**
 * Login a user in a separate browser context by injecting auth state into localStorage.
 * Use this for multi-user tests (e.g., agent + support in parallel).
 */
export async function loginInContext(
  context: BrowserContext,
  userKey: keyof typeof TEST_USERS,
) {
  const page = await context.newPage();
  const user = TEST_USERS[userKey];

  const res = await page.request.post(`${API_URL}/api/v1/auth/login`, {
    data: { id: user.id, password: user.password },
  });
  if (!res.ok()) throw new Error(`Login failed for ${user.id}: ${res.status()}`);

  const data = await res.json();
  const { token, user: userProfile, memberships, activePartnerId } = data;

  console.log(`E2E: Navigating to ${APP_URL} for login injection...`);
  await page.goto(APP_URL);
  await page.evaluate((params: Record<string, unknown>) => {
    localStorage.setItem('token', params.token as string);
    localStorage.setItem('user', JSON.stringify(params.userProfile));
    localStorage.setItem('memberships', JSON.stringify(params.memberships));
    localStorage.setItem('activePartnerId', params.activePartnerId as string);
    const ms = params.memberships as Array<{ id: string }>;
    if (ms && ms.length > 0) {
      localStorage.setItem('activeMembershipId', ms[0].id);
    }
  }, { token, userProfile, memberships, activePartnerId });

  await page.reload({ waitUntil: 'networkidle' });
  return page;
}
