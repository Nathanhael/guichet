import { useCallback, useEffect, useState } from 'react';
import { trpc } from '../utils/trpc';

export interface LinkPreview {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
}

interface UseComposeLinkPreviewParams {
  text: string;
}

interface UseComposeLinkPreviewResult {
  livePreview: LinkPreview | null;
  dismiss: (url: string) => void;
}

const DEBOUNCE_MS = 800;
const MIN_QUERY_LEN = 10;

/**
 * Unfurls the first URL in the compose buffer 800ms after the user stops
 * typing. Dismissed URLs stay hidden until the buffer no longer contains
 * them — retyping the same URL re-shows the card.
 */
export function useComposeLinkPreview({
  text,
}: UseComposeLinkPreviewParams): UseComposeLinkPreviewResult {
  const [debouncedText, setDebouncedText] = useState('');
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedText(text), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const query = trpc.linkPreview.fetchForCompose.useQuery(
    { text: debouncedText },
    {
      enabled: /https?:\/\//i.test(debouncedText) && debouncedText.length >= MIN_QUERY_LEN,
      staleTime: 60_000,
      retry: 0,
    },
  );

  const data = (query.data ?? null) as LinkPreview | null;
  const livePreview = data && !dismissed.has(data.url) ? data : null;

  useEffect(() => {
    if (dismissed.size === 0) return;
    let changed = false;
    const next = new Set(dismissed);
    for (const url of dismissed) {
      if (!text.includes(url)) {
        next.delete(url);
        changed = true;
      }
    }
    if (changed) setDismissed(next);
  }, [text, dismissed]);

  const dismiss = useCallback((url: string) => {
    setDismissed((prev) => new Set(prev).add(url));
  }, []);

  return { livePreview, dismiss };
}
