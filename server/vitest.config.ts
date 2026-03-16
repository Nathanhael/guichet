import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    env: {
      JWT_SECRET: 'test-secret-key-only-for-unit-tests',
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://user:password@localhost:5432/tessera',
    },
    // Prevent process.exit from crashing the test runner if possible,
    // though config.ts calls it immediately on import.
  },
});
