import logger from './logger.js';

export interface TaskRunner {
  run: (fn: () => Promise<void>) => Promise<void>;
}

/**
 * Creates a task runner with mutual exclusion.
 * If a task is already running, subsequent calls are skipped (not queued).
 * All errors are caught and logged — never propagated.
 */
export function createTaskRunner(name: string): TaskRunner {
  let running = false;

  return {
    async run(fn: () => Promise<void>): Promise<void> {
      if (running) {
        logger.debug({ task: name }, '[TaskRunner] Skipping — previous run still in progress');
        return;
      }
      running = true;
      try {
        await fn();
      } catch (err) {
        logger.error({ task: name, err: err instanceof Error ? err.message : String(err) }, '[TaskRunner] Task failed (non-fatal)');
      } finally {
        running = false;
      }
    },
  };
}
