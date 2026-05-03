import { useState, useEffect, useRef, useCallback } from 'react';
import { trpc } from '../utils/trpc';

/**
 * In-memory translation cache with LRU eviction.
 * Key: `${messageId}:${targetLang}` → translated text.
 * Persists across re-renders but not page reloads.
 * Capped at 500 entries to prevent unbounded memory growth.
 */
const MAX_CACHE_SIZE = 500;
const translationCache = new Map<string, string>();

function cacheSet(key: string, value: string) {
  // LRU eviction: delete oldest entries when cache is full
  if (translationCache.size >= MAX_CACHE_SIZE) {
    const firstKey = translationCache.keys().next().value;
    if (firstKey) translationCache.delete(firstKey);
  }
  translationCache.set(key, value);
}

/**
 * Concurrency limiter for translation API calls.
 * Only MAX_CONCURRENT translations can be in-flight at once; the rest are queued.
 */
let inFlight = 0;
const MAX_CONCURRENT = 3;
const queue: Array<() => void> = [];

function acquireSlot(): Promise<void> {
  if (inFlight < MAX_CONCURRENT) {
    inFlight++;
    return Promise.resolve();
  }
  return new Promise((resolve) => queue.push(() => { inFlight++; resolve(); }));
}

function releaseSlot() {
  inFlight--;
  const next = queue.shift();
  if (next) next();
}

/**
 * Hook for auto-translating a message when senderLang !== viewerLang.
 *
 * Translation is NOT fired automatically on mount. Call `translate()` to
 * trigger translation on demand (e.g. when the message becomes visible).
 * A module-level concurrency limiter ensures at most 3 translations are
 * in-flight at once.
 *
 * Returns:
 * - `translated`: the translated text (or null while loading / if same lang)
 * - `loading`: whether a translation is in progress
 * - `translate`: function to trigger translation on demand
 * - `needsTranslation`: whether the message needs translation
 * - `showOriginal` / `setShowOriginal`: toggle to view original text
 */
export function useAutoTranslation(opts: {
  messageId: string;
  text: string;
  senderLang: string;
  viewerLang: string;
  enabled: boolean;
  prewarmed?: string;
}) {
  const { messageId, text, senderLang, viewerLang, enabled, prewarmed } = opts;
  const needsTranslation = enabled && senderLang && viewerLang && senderLang !== viewerLang;
  const cacheKey = `${messageId}:${viewerLang}`;

  if (prewarmed && !translationCache.has(cacheKey)) {
    cacheSet(cacheKey, prewarmed);
  }

  const [translated, setTranslated] = useState<string | null>(
    needsTranslation ? (translationCache.get(cacheKey) ?? null) : null,
  );
  const [loading, setLoading] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const isMounted = useRef(true);

  const translateMutation = trpc.ai.translateMessage.useMutation();

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  const translate = useCallback(async () => {
    if (!needsTranslation) return;

    // Already cached
    if (translationCache.has(cacheKey)) {
      setTranslated(translationCache.get(cacheKey)!);
      return;
    }

    // Don't translate very short texts (emojis, media-only)
    if (!text || text.length < 2) return;

    // Already loading or already translated
    if (loading || translated) return;

    setLoading(true);

    await acquireSlot();
    try {
      if (!isMounted.current) return;

      const result = await translateMutation.mutateAsync({
        messageId,
        text,
        targetLang: viewerLang as 'nl' | 'en' | 'fr',
      });

      if (isMounted.current) {
        cacheSet(cacheKey, result.translated);
        setTranslated(result.translated);
      }
    } catch {
      // Silently fail — show original text
    } finally {
      releaseSlot();
      if (isMounted.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageId, text, senderLang, viewerLang, enabled, needsTranslation, loading, translated]);

  return {
    translated: needsTranslation ? translated : null,
    loading: needsTranslation ? loading : false,
    translate,
    showOriginal,
    setShowOriginal,
    needsTranslation: !!needsTranslation,
  };
}
