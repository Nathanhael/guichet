import { createHash } from 'crypto';
import { eq } from 'drizzle-orm';
import type { AiProvider } from './types.js';
import { getAiContext } from './context.js';
import { validateAiBaseUrl, validateResolvedAiUrl } from './validateUrl.js';
import { OllamaProvider } from './ollama.js';
import { AzureOpenAiProvider } from './azure-openai.js';
import { OpenAiCompatibleProvider } from './openai-compatible.js';

// ─── Provider Cache ─────────────────────────────────────────────────────────
// Keyed by a hash of the config that created them, so changing env vars or
// partner settings creates a new instance.

const providerCache = new Map<string, AiProvider>();
const MAX_CACHE_SIZE = 100;

function hashKey(key?: string): string {
  if (!key) return 'none';
  return createHash('sha256').update(key).digest('hex').slice(0, 8);
}

function cacheKey(provider: string, ...parts: (string | undefined)[]): string {
  return [provider, ...parts.filter(Boolean)].join(':');
}

/**
 * Build a provider from explicit config values.
 */
function buildProvider(
  providerName: string,
  opts: { baseUrl?: string; apiKey?: string; model?: string; deployment?: string } = {},
): AiProvider {
  const { config } = getAiContext();

  switch (providerName) {
    case 'ollama':
      return new OllamaProvider(
        opts.baseUrl || config.OLLAMA_HOST,
        opts.model || config.OLLAMA_MODEL,
      );

    case 'azure':
    case 'azure-openai': {
      const baseUrl = opts.baseUrl || config.AI_BASE_URL;
      const apiKey = opts.apiKey || config.AI_API_KEY;
      const deployment = opts.deployment || config.AZURE_OPENAI_DEPLOYMENT;
      if (!baseUrl) throw new Error('AI_BASE_URL is required for Azure OpenAI');
      if (!apiKey) throw new Error('AI_API_KEY is required for Azure OpenAI');
      if (!deployment) throw new Error('AZURE_OPENAI_DEPLOYMENT is required for Azure OpenAI');
      return new AzureOpenAiProvider(baseUrl, apiKey, deployment);
    }

    case 'openai-compatible': {
      const baseUrl = opts.baseUrl || config.AI_BASE_URL;
      if (!baseUrl) throw new Error('AI_BASE_URL is required for openai-compatible provider');
      return new OpenAiCompatibleProvider(
        baseUrl,
        opts.model || 'default',
        opts.apiKey || config.AI_API_KEY,
      );
    }

    default:
      throw new Error(`Unknown AI provider: ${providerName}`);
  }
}

/**
 * Get the AI provider for a given partner.
 *
 * Resolution order:
 * 1. If `partnerId` is provided, check `partners.ai_provider` + `partners.ai_config`
 * 2. Fall back to global env vars (`AI_PROVIDER`, `OLLAMA_HOST`, etc.)
 * 3. Cache provider instances per config hash
 */
export async function getProvider(partnerId?: string): Promise<AiProvider> {
  const { db, logger, config, schema, decrypt } = getAiContext();
  const { partners } = schema;

  // ── Per-partner override ──────────────────────────────────────────────────
  if (partnerId) {
    const [partner] = await db
      .select({
        aiProvider: partners.aiProvider,
        aiModel: partners.aiModel,
        aiConfig: partners.aiConfig,
      })
      .from(partners)
      .where(eq(partners.id, partnerId))
      .limit(1);

    if (partner?.aiProvider) {
      const aiConfig = (partner.aiConfig ?? {}) as Record<string, unknown>;

      // Decrypt API key if encrypted (SEC-5)
      let apiKey = aiConfig.apiKey as string | undefined;
      if (!apiKey && aiConfig.encryptedApiKey) {
        try {
          apiKey = decrypt(aiConfig.encryptedApiKey as string);
        } catch (err) {
          logger.error({ partnerId, err: err instanceof Error ? err.message : String(err) }, '[ai] Failed to decrypt API key — AI disabled for this partner');
          apiKey = undefined;
        }
      }

      const key = cacheKey(
        partner.aiProvider,
        partnerId,
        partner.aiModel ?? undefined,
        aiConfig.baseUrl as string | undefined,
        hashKey(apiKey),
      );

      if (!providerCache.has(key)) {
        if (providerCache.size >= MAX_CACHE_SIZE) {
          const firstKey = providerCache.keys().next().value;
          if (firstKey) providerCache.delete(firstKey);
        }
        logger.info({ partnerId, provider: partner.aiProvider }, 'Creating per-partner AI provider');
        const isDev = config.NODE_ENV === 'development';
        validateAiBaseUrl(aiConfig.baseUrl as string | undefined, isDev);
        await validateResolvedAiUrl(aiConfig.baseUrl as string | undefined, isDev);
        providerCache.set(
          key,
          buildProvider(partner.aiProvider, {
            baseUrl: aiConfig.baseUrl as string | undefined,
            apiKey,
            model: partner.aiModel ?? undefined,
            deployment: aiConfig.deployment as string | undefined,
          }),
        );
      }
      return providerCache.get(key)!;
    }
  }

  // ── Global fallback ───────────────────────────────────────────────────────
  const key = cacheKey(config.AI_PROVIDER, config.AI_BASE_URL, config.OLLAMA_HOST);

  if (!providerCache.has(key)) {
    if (providerCache.size >= MAX_CACHE_SIZE) {
      const firstKey = providerCache.keys().next().value;
      if (firstKey) providerCache.delete(firstKey);
    }
    logger.info({ provider: config.AI_PROVIDER }, 'Creating global AI provider');
    providerCache.set(key, buildProvider(config.AI_PROVIDER));
  }

  return providerCache.get(key)!;
}

/**
 * Check if AI is globally enabled AND (optionally) enabled for a specific partner.
 */
export async function isAiEnabled(partnerId?: string): Promise<boolean> {
  const { db, config, schema } = getAiContext();
  const { partners } = schema;

  if (!config.AI_ENABLED) return false;

  if (partnerId) {
    const [partner] = await db
      .select({ aiEnabled: partners.aiEnabled })
      .from(partners)
      .where(eq(partners.id, partnerId))
      .limit(1);

    return partner?.aiEnabled ?? false;
  }

  return true;
}

/**
 * Clear the provider cache (useful for tests or config hot-reload).
 */
export function clearProviderCache(): void {
  providerCache.clear();
}
