import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './testing/e2e',
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3001',
    headless: true,
    screenshot: 'only-on-failure',
    locale: 'en-US',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
