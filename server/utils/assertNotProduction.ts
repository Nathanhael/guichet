/**
 * Throws if NODE_ENV === 'production'. Used at module-load by files that
 * must never exist in a production build (test fixtures, dev-only routes).
 *
 * Pattern: import this util at the very top of a file and call it
 * unconditionally. Production server boots fail fast on import — there is
 * no path where the file's exports are reachable at runtime in prod.
 *
 * Reads `process.env.NODE_ENV` directly rather than going through `config.ts`
 * — `config.ts` is heavily mocked across the test suite, and the module-cache
 * shape interacts badly with `vi.doMock` in full-suite cadence (the assertion
 * fails to fire because a sibling test's config import is still cached).
 * Reading the env var directly is module-cache-free and survives any test
 * isolation strategy.
 */
export function assertNotProduction(reason?: string): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `Production-restricted module loaded${reason ? `: ${reason}` : ''}. ` +
        `This file must not be imported when NODE_ENV=production.`,
    );
  }
}
