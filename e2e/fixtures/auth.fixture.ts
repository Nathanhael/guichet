import { test as base, type Page } from '@playwright/test';
import { API_URL, APP_URL, TEST_USERS } from '../lib/constants.js';

type TestUser = keyof typeof TEST_USERS;

type AuthFixtures = {
  loginAs: (user: TestUser) => Promise<Page>;
};

export const test = base.extend<AuthFixtures>({
  loginAs: async ({ page }, use) => {
    const fn = async (userKey: TestUser) => {
      const user = TEST_USERS[userKey];
      console.log(`E2E: Logging in as ${userKey} (${user.id})...`);
      
      const res = await page.request.post(`${API_URL}/api/auth/login`, {
        data: { id: user.id, password: user.password },
      });
      
      if (!res.ok()) {
        const errorText = await res.text();
        throw new Error(`E2E: Login failed for ${user.id}: ${res.status()} ${errorText}`);
      }

      const data = await res.json();
      const { token, user: userProfile, memberships, activePartnerId } = data;
      console.log(`E2E: Login successful for ${user.id}, received token.`);

      // Navigate to the app first to establish origin
      await page.goto(APP_URL);

      await page.evaluate((params: any) => {
        console.log('E2E: Injecting localStorage state...');
        localStorage.setItem('token', params.token);
        localStorage.setItem('user', JSON.stringify(params.userProfile));
        localStorage.setItem('memberships', JSON.stringify(params.memberships));
        localStorage.setItem('activePartnerId', params.activePartnerId);
        if (params.memberships && params.memberships.length > 0) {
          localStorage.setItem('activeMembershipId', params.memberships[0].id);
        }
      }, { token, userProfile, memberships, activePartnerId });

      // Reload to pick up the new localStorage state
      console.log('E2E: Reloading page to apply state...');
      await page.reload({ waitUntil: 'networkidle' });

      return page;
    };

    await use(fn);
  },
});

export { expect } from '@playwright/test';
