/**
 * Per-canned auto-translation. Wraps `runAiAction({ action: 'translate' })`
 * for each non-source language and aggregates the results.
 *
 * Failures are silently dropped per-language (graceful degradation): the
 * canned still saves with whatever translations succeeded. Caller is
 * responsible for the feature gate; this service trusts it.
 */

import { runAiAction } from './runAction.js';
import { isFeatureEnabled } from './config.js';
import { getAiContext } from './context.js';

export type SupportedLang = 'nl' | 'fr' | 'en';
export const ALL_LANGS: readonly SupportedLang[] = ['nl', 'fr', 'en'];

const LANG_NAMES: Record<SupportedLang, string> = {
  nl: 'Dutch',
  fr: 'French',
  en: 'English',
};

export async function isCannedTranslationEnabled(partnerId: string): Promise<boolean> {
  return isFeatureEnabled(partnerId, 'cannedTranslation');
}

export async function translateCanned(
  partnerId: string,
  userId: string,
  body: string,
  sourceLang: SupportedLang,
  langs: readonly SupportedLang[] = ALL_LANGS,
): Promise<Partial<Record<SupportedLang, string>>> {
  const { logger } = getAiContext();
  const targets = langs.filter((l) => l !== sourceLang);

  const results = await Promise.allSettled(
    targets.map((target) =>
      runAiAction({
        partnerId,
        userId,
        feature: 'cannedTranslation',
        action: 'translate',
        vars: {
          text: body,
          targetLang: LANG_NAMES[target],
        },
        temperature: 0.3,
        maxTokens: 1024,
      }).then((result) => ({ target, content: result.content })),
    ),
  );

  const out: Partial<Record<SupportedLang, string>> = {};
  for (const r of results) {
    if (r.status === 'fulfilled') {
      out[r.value.target] = r.value.content;
    } else {
      logger.warn(
        { err: r.reason instanceof Error ? r.reason.message : String(r.reason), partnerId },
        'Canned translation failed for one language',
      );
    }
  }
  return out;
}
