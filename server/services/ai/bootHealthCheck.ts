import { getProvider } from './factory.js';
import { getAiContext } from './context.js';

/**
 * Smoke-test the global AI provider at startup using its non-billable
 * `isAvailable()` probe (lists deployments, no inference cost).
 *
 * Logs at `error` level on failure so a stale API key — e.g. when an
 * Azure OpenAI resource rotates key1/key2 and the Container App secret
 * goes out of sync — surfaces in container logs immediately on revision
 * start. Without this, `bulkHistoryPrewarm.ts` and `runAction.ts`
 * swallow the 401, the client falls back to the original text, and the
 * breakage stays silent until someone notices translations stopped.
 *
 * Non-fatal: server continues to boot. AI features will throw at use-time.
 */
export async function runAiBootHealthCheck(): Promise<void> {
  const { config, logger } = getAiContext();
  if (!config.AI_ENABLED) {
    logger.info('[ai-health] AI_ENABLED=false — skipping boot health check');
    return;
  }
  try {
    const provider = await getProvider();
    const ok = await provider.isAvailable();
    if (ok) {
      logger.info({ provider: provider.name }, '[ai-health] provider reachable at boot');
    } else {
      logger.error(
        { provider: provider.name, baseUrl: config.AI_BASE_URL },
        '[ai-health] provider unreachable at boot — likely stale API key or wrong endpoint. AI features will fail silently until fixed.',
      );
    }
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      '[ai-health] boot health check threw — AI features may fail',
    );
  }
}
