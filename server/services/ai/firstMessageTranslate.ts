/**
 * Mini-fix: best-effort translation of a ticket's first agent message at the
 * moment a support staff member joins, so the support's chat history renders
 * with msg #1 already translated to their language — no client-side flicker.
 *
 * Scope: msg #1 only. New incoming messages use the existing send.ts prewarm
 * path (viewerLangs populated once support is in the room). History items
 * past msg #1 fall back to client-side useAutoTranslation on render.
 *
 * Flow:
 *   1. Skip if support's lang === sender's lang or sender lang missing.
 *   2. Skip if partner's `aiFeatures.translation` is off.
 *   3. Hit Redis cache first — peer-warm in same lang means zero AI spend.
 *   4. On miss, call the translation provider via `runAiAction`.
 *   5. Store result in Redis (same key as on-demand translate path).
 *
 * Returns the translated text, or null if any of the above bailed/failed.
 * Errors are swallowed — this is a best-effort optimization; the client's
 * useAutoTranslation hook is the fallback.
 */

import { runAiAction } from './runAction.js';
import { getCachedTranslation, setCachedTranslation } from './translateCache.js';
import { isFeatureEnabled } from './config.js';
import { getAiContext } from './context.js';

const SUPPORTED_LANGS = new Set(['nl', 'fr', 'en']);
type Lang = 'nl' | 'fr' | 'en';

const LANG_NAME: Record<Lang, string> = {
  nl: 'Dutch',
  fr: 'French',
  en: 'English',
};

export interface TranslateFirstMessageOpts {
  messageId: string;
  text: string;
  senderLang: string;
  supportLang: string;
  partnerId: string;
  /** Used only for AI usage logging — the support who triggered the join. */
  supportUserId: string;
}

export async function translateFirstAgentMessage(
  opts: TranslateFirstMessageOpts,
): Promise<string | null> {
  const { messageId, text, senderLang, supportLang, partnerId, supportUserId } = opts;

  if (!text || text.trim().length === 0) return null;
  if (!senderLang || senderLang === supportLang) return null;
  if (!SUPPORTED_LANGS.has(supportLang)) return null;

  let translationEnabled = false;
  try {
    translationEnabled = await isFeatureEnabled(partnerId, 'translation');
  } catch {
    return null;
  }
  if (!translationEnabled) return null;

  const lang = supportLang as Lang;

  const cached = await getCachedTranslation(messageId, lang);
  if (cached) return cached;

  try {
    const result = await runAiAction({
      partnerId,
      userId: supportUserId,
      feature: 'translation',
      action: 'translate',
      vars: {
        text,
        targetLang: LANG_NAME[lang],
      },
      temperature: 0.3,
      maxTokens: 1024,
    });
    const translated = result.content.trim();
    if (!translated) return null;
    await setCachedTranslation(messageId, lang, translated);
    return translated;
  } catch (err) {
    const { logger } = getAiContext();
    logger.warn(
      { err, messageId, supportLang, partnerId },
      '[firstMessageTranslate] translate failed; client will fall back to on-demand',
    );
    return null;
  }
}
