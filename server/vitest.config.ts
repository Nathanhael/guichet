import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    env: {
      JWT_SECRET: 'test-secret-key-only-for-unit-tests-padding-to-reach-sixty-four-c!',
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://user:password@localhost:5432/tessera',
      PLATFORM_ADMIN_PASSWORD: '',
    },
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
