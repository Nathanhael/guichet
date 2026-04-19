import { useSyncExternalStore, useCallback } from 'react';
import useStore from './store/useStore';
import en from './locales/en';

// -- Locale cache ---------------------------------------------------------------
type TranslationSet = Record<string, string>;

const loaded: Record<string, TranslationSet> = { en };
let listeners: Array<() => void> = [];

function subscribe(cb: () => void) {
  listeners.push(cb);
  return () => { listeners = listeners.filter(l => l !== cb); };
}

function getSnapshot() { return loaded; }

/** Dynamically import a locale and notify subscribers. */
async function ensureLocale(lang: string): Promise<void> {
  if (loaded[lang]) return;
  try {
    const mod = await (
      lang === 'nl' ? import('./locales/nl') :
      lang === 'fr' ? import('./locales/fr') :
      null
    );
    if (mod) {
      loaded[lang] = mod.default;
      listeners.forEach(l => l());
    }
  } catch {
    // Silently fall back to English
  }
}

// -- Hooks ----------------------------------------------------------------------

/**
 * Returns a translation function. Loads the active locale on demand,
 * falling back to English until it's ready.
 */
export function useT() {
  const user = useStore(s => s.user);
  const selectedLang = useStore(s => s.selectedLang);
  const cache = useSyncExternalStore(subscribe, getSnapshot);

  const browserLang = typeof navigator !== 'undefined' ? navigator.language.slice(0, 2) : 'en';
  const langKey = selectedLang || user?.lang || browserLang || 'en';
  const lang = (langKey in cache) ? langKey : 'en';

  // Trigger async load if not yet cached
  if (!(langKey in cache)) {
    ensureLocale(langKey);
  }

  return useCallback(
    (key: string): string => {
      return cache[lang]?.[key] ?? cache.en[key] ?? key;
    },
    [cache, lang],
  );
}

/**
 * Returns the active 2-letter language code, matching the resolution logic of useT().
 */
export function useLang(): string {
  const user = useStore(s => s.user);
  const selectedLang = useStore(s => s.selectedLang);
  const browserLang = typeof navigator !== 'undefined' ? navigator.language.slice(0, 2) : 'en';
  return selectedLang || user?.lang || browserLang || 'en';
}

/**
 * Standalone translation for non-React contexts (e.g. error handlers).
 * Uses English only since async loading isn't practical outside React.
 */
export function tBrowser(key: string): string {
  return loaded.en[key] ?? key;
}
