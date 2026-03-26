import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    env: {
      JWT_SECRET: 'test-secret-key-only-for-unit-tests',
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://user:password@localhost:5432/tessera',
    },
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
