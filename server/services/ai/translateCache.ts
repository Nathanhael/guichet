import { getAiContext } from './context.js';

const TRANSLATION_TTL = 24 * 60 * 60; // 24 hours
const LANGS = ['nl', 'fr', 'en'] as const;
type Lang = (typeof LANGS)[number];

function key(messageId: string, targetLang: Lang): string {
  return `translation:${messageId}:${targetLang}`;
}

/**
 * Get a cached translation for a message + target language.
 */
export async function getCachedTranslation(messageId: string, targetLang: Lang): Promise<string | null> {
  try {
    const { redis: r } = getAiContext();
    if (!r) return null;
    return await r.get(key(messageId, targetLang));
  } catch {
    return null;
  }
}

/**
 * Store a translation in cache with 24h TTL.
 */
export async function setCachedTranslation(messageId: string, targetLang: Lang, translation: string): Promise<void> {
  try {
    const { redis: r } = getAiContext();
    if (!r) return;
    await r.set(key(messageId, targetLang), translation, { EX: TRANSLATION_TTL });
  } catch (err) {
    const { logger } = getAiContext();
    logger.warn({ err, messageId, targetLang }, 'Failed to cache translation');
  }
}

/**
 * Invalidate all cached translations for a message (e.g., after edit/delete).
 */
export async function invalidateTranslation(messageId: string): Promise<void> {
  try {
    const { redis: r } = getAiContext();
    if (!r) return;
    // Delete every lang variant — bounded set keeps this O(LANGS).
    await r.del(LANGS.map((l) => key(messageId, l)));
  } catch {
    // Silently ignore — worst case the entry is stale until TTL expires
  }
}
