/**
 * Bulk-prewarm Redis translation cache for a window of history messages
 * so the client's useAutoTranslation hook hits cache instantly on render —
 * eliminating per-message flicker when a support joins (or transfers in)
 * to a ticket with cross-lang history.
 *
 * Replaces the older single-msg `firstMessageTranslate.ts` path. Bulk
 * handles msg #1 too; no separate code path needed.
 *
 * Flow:
 *   1. Skip if `supportLang` not in NL/FR/EN.
 *   2. Skip if partner's `aiFeatures.translation` is off.
 *   3. Filter messages: drop system/whisper, drop empty, drop same-lang,
 *      drop digit/punct/emoji-only via `shouldSkipTranslation`.
 *   4. Per-message: cache hit → reuse; cache miss → AI call → cache write.
 *   5. Concurrency-bounded (default 3) and budget-capped (default 8000ms).
 *      Whatever finishes within the budget ships in the result Map and
 *      Redis cache; the rest falls back to client lazy on-render.
 *
 * Returns a Map of messageId → translated text so the caller can stamp
 * `msg.translations[supportLang]` on rows being emitted via
 * ticket:history (avoids a second client round-trip on initial render).
 *
 * Best-effort: per-message failures are swallowed; the client's
 * useAutoTranslation hook is the always-available fallback.
 */

import { runAiAction } from './runAction.js';
import { getCachedTranslation, setCachedTranslation } from './translateCache.js';
import { isFeatureEnabled } from './config.js';
import { shouldSkipTranslation } from './translateGuards.js';
import { getAiContext } from './context.js';

const SUPPORTED_LANGS = new Set(['nl', 'fr', 'en']);
type Lang = 'nl' | 'fr' | 'en';

const LANG_NAME: Record<Lang, string> = {
  nl: 'Dutch',
  fr: 'French',
  en: 'English',
};

const DEFAULT_BUDGET_MS = 8000;
const DEFAULT_CONCURRENCY = 3;

/** Duck-typed message shape — accepts both DB rows and mapped wire-rows.
 * `system`/`whisper` accept `number` (legacy 0/1 schema) and `boolean`
 * (newer code paths) so callers don't need to coerce. */
interface PrewarmableMessage {
  id: string;
  text?: string | null;
  originalText?: string | null;
  senderLang?: string | null;
  system?: boolean | number | null;
  whisper?: boolean | number | null;
}

export interface BulkPrewarmOpts {
  messages: PrewarmableMessage[];
  supportLang: string;
  partnerId: string;
  /** Joining support's userId — for AI usage logging attribution. */
  supportUserId: string;
  /** Hard cap. Defaults to 8000ms. Whatever finishes ships; rest = lazy. */
  budgetMs?: number;
  /** Concurrency cap. Defaults to 3 (matches client semaphore). */
  concurrency?: number;
}

export async function prewarmHistoryTranslations(
  opts: BulkPrewarmOpts,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();

  if (!SUPPORTED_LANGS.has(opts.supportLang)) return result;

  let enabled: boolean;
  try {
    enabled = await isFeatureEnabled(opts.partnerId, 'translation');
  } catch {
    return result;
  }
  if (!enabled) return result;

  const lang = opts.supportLang as Lang;
  const budgetMs = opts.budgetMs ?? DEFAULT_BUDGET_MS;
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;

  const targets = opts.messages.filter((m) => {
    if (m.system || m.whisper) return false;
    const text = m.text ?? m.originalText ?? '';
    if (!text) return false;
    if (!m.senderLang || m.senderLang === lang) return false;
    if (shouldSkipTranslation(text)) return false;
    return true;
  });

  if (targets.length === 0) return result;

  // Simple in-process semaphore. Matches client-side useAutoTranslation
  // limiter (3) so the per-partner rate-limit budget isn't burned in one go.
  let inFlight = 0;
  const queue: Array<() => void> = [];
  const acquire = (): Promise<void> => {
    if (inFlight < concurrency) {
      inFlight++;
      return Promise.resolve();
    }
    return new Promise((r) => queue.push(() => { inFlight++; r(); }));
  };
  const release = (): void => {
    inFlight--;
    const next = queue.shift();
    if (next) next();
  };

  // `done` flips true the moment the budget timer fires OR all work settles.
  // Per-msg callbacks check this before mutating `result` so the snapshot we
  // hand back to the caller cannot be corrupted by an in-flight worker that
  // finishes after `Promise.race` resolves. The AI call + Redis write still
  // proceed (intentional — warms the cache for the NEXT join in this lang),
  // we just don't echo their results back into the post-budget Map.
  let done = false;

  const work = Promise.allSettled(
    targets.map(async (m) => {
      await acquire();
      try {
        const text = m.text ?? m.originalText ?? '';
        const cached = await getCachedTranslation(m.id, lang);
        if (cached) {
          if (!done) result.set(m.id, cached);
          return;
        }
        const r = await runAiAction({
          partnerId: opts.partnerId,
          userId: opts.supportUserId,
          feature: 'translation',
          action: 'translate',
          vars: { text, targetLang: LANG_NAME[lang] },
          temperature: 0.3,
          maxTokens: 1024,
        });
        const translated = r.content.trim();
        if (translated) {
          // Always write to Redis even after budget — late arrivals warm
          // the cache for subsequent joins to the same lang.
          await setCachedTranslation(m.id, lang, translated);
          if (!done) result.set(m.id, translated);
        }
      } catch {
        // Per-msg fail is silent — client lazy fallback handles it.
      } finally {
        release();
      }
    }),
  );

  await Promise.race([
    work.then(() => { done = true; }),
    new Promise<void>((r) => setTimeout(() => { done = true; r(); }, budgetMs)),
  ]);

  // Snapshot before returning so any post-budget worker that races past the
  // `done` flag check (impossible on V8's single-threaded loop today, but
  // defensive against future caller patterns that yield mid-iteration over
  // the returned Map) still cannot corrupt the caller's view.
  const snapshot = new Map(result);

  if (snapshot.size < targets.length) {
    const { logger } = getAiContext();
    if (snapshot.size === 0) {
      // Total failure (likely AOAI down or all calls rate-limited) — surface
      // at warn so on-call sees it without scraping debug logs.
      logger.warn(
        {
          partnerId: opts.partnerId,
          supportLang: lang,
          candidates: targets.length,
          budgetMs,
        },
        '[bulkHistoryPrewarm] zero translations completed — provider may be down or rate-limited; client lazy fallback engaged for entire history',
      );
    } else {
      // Partial success (budget bit, or per-msg failures) — debug only.
      logger.debug(
        {
          partnerId: opts.partnerId,
          supportLang: lang,
          prewarmed: snapshot.size,
          candidates: targets.length,
          budgetMs,
        },
        '[bulkHistoryPrewarm] partial — remainder will fall back to client lazy',
      );
    }
  }

  return snapshot;
}
