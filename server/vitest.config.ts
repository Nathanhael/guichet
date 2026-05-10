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
    // Cap parallel workers. ~30 of our test files boot a PGLite
    // (in-process Postgres in WASM) which holds ~150-200 MB heap each.
    // Vitest's default = `availableParallelism()` (often 6-8 on dev/CI
    // hosts) tipped over the OOM threshold inside the server container,
    // killing `docker compose exec server npm test` with exit code 137
    // mid-run. 4 keeps peak PGLite memory well under 1 GB and full
    // suite still runs in ~3.5 min.
    poolOptions: {
      threads: {
        maxThreads: 4,
      },
    },
  },
});
