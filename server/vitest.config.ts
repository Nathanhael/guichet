import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    env: {
      JWT_SECRET: 'test-secret-key-only-for-unit-tests-padding-to-reach-sixty-four-c!',
      NODE_ENV: 'test',
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://user:password@localhost:5432/guichet',
    },
    // Bumped from 15s after the lifecycle PGLite suite (~40s of WASM
    // boot + migration across 7 files) started competing with the
    // socket-isolation tests' beforeEach `await import(...)` for the
    // event loop under full-suite load.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
