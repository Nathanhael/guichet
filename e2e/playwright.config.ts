import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'docker',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:5173',
      },
    },
    {
      name: 'docker-edge',
      use: {
        ...devices['Desktop Edge'],
        channel: 'msedge',
        baseURL: 'http://localhost:5173',
      },
    },
    {
      name: 'mock',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:4173',
      },
    },
    {
      name: 'mock-edge',
      use: {
        ...devices['Desktop Edge'],
        channel: 'msedge',
        baseURL: 'http://localhost:4173',
      },
    },
  ],
});
