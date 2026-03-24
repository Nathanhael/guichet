import { useState, useEffect, useRef } from 'react';
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
 * Hook for auto-translating a message when senderLang !== viewerLang.
 *
 * Returns:
 * - `translated`: the translated text (or null while loading / if same lang)
 * - `loading`: whether a translation is in progress
 * - `showOriginal` / `setShowOriginal`: toggle to view original text
 */
export function useAutoTranslation(opts: {
  messageId: string;
  text: string;
  senderLang: string;
  viewerLang: string;
  enabled: boolean;
}) {
  const { messageId, text, senderLang, viewerLang, enabled } = opts;
  const needsTranslation = enabled && senderLang && viewerLang && senderLang !== viewerLang;
  const cacheKey = `${messageId}:${viewerLang}`;

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

  useEffect(() => {
    if (!needsTranslation) {
      setTranslated(null);
      return;
    }

    // Already cached
    if (translationCache.has(cacheKey)) {
      setTranslated(translationCache.get(cacheKey)!);
      return;
    }

    // Don't translate very short texts (emojis, media-only)
    if (!text || text.length < 2) return;

    let cancelled = false;
    setLoading(true);

    translateMutation
      .mutateAsync({
        text,
        targetLang: viewerLang as 'nl' | 'en' | 'fr',
      })
      .then((result) => {
        if (!cancelled && isMounted.current) {
          cacheSet(cacheKey, result.translated);
          setTranslated(result.translated);
        }
      })
      .catch(() => {
        // Silently fail — show original text
      })
      .finally(() => {
        if (!cancelled && isMounted.current) setLoading(false);
      });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageId, text, senderLang, viewerLang, enabled]);

  return {
    translated: needsTranslation ? translated : null,
    loading: needsTranslation ? loading : false,
    showOriginal,
    setShowOriginal,
    needsTranslation: !!needsTranslation,
  };
}
