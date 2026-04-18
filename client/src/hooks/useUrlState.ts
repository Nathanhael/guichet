import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Drop-in replacement for `useState<string>` that mirrors the value into
 * `window.location.search` under the given key. Used by the audit-log views
 * so a filter selection is bookmarkable / shareable and survives reload.
 *
 * Semantics:
 *  - Empty string means "remove from URL" (keeps the URL tidy — the default
 *    value never appears as `?action=&actor=&…`).
 *  - `replaceState` is used, not `pushState`, so debounced inputs don't burn
 *    a history entry per keystroke.
 *  - Back/forward is respected: a popstate event re-seeds the state from
 *    the URL, so the filter UI tracks the browser history stack.
 *
 * Namespace lets two independent views (partner audit vs platform audit)
 * coexist without colliding on query-string keys — callers pass e.g. "p".
 */
export function useUrlParam(
  key: string,
  initial = '',
  namespace = '',
): [string, (next: string) => void] {
  const fullKey = namespace ? `${namespace}.${key}` : key;

  const read = useCallback((): string => {
    if (typeof window === 'undefined') return initial;
    const v = new URLSearchParams(window.location.search).get(fullKey);
    return v ?? initial;
  }, [fullKey, initial]);

  const [value, setValue] = useState<string>(() => read());

  const write = useCallback((next: string) => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (next === '' || next === null || next === undefined) params.delete(fullKey);
    else params.set(fullKey, next);
    const nextSearch = params.toString();
    const currentSearch = window.location.search.replace(/^\?/, '');
    if (nextSearch !== currentSearch) {
      const url = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`;
      window.history.replaceState(null, '', url);
    }
  }, [fullKey]);

  const setBoth = useCallback((next: string) => {
    setValue(next);
    write(next);
  }, [write]);

  // Respect back/forward navigation by re-reading the URL on popstate.
  const readerRef = useRef(read);
  readerRef.current = read;
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = () => setValue(readerRef.current());
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, []);

  return [value, setBoth];
}
