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
 * Returns the user's *actual* 2-letter language code (Azure SSO claim → user.lang).
 * Used for routing/filter decisions where the user's spoken language matters
 * (cross-lang banner, queue lang filter, lang dot). Independent of the UI
 * language switcher — selectedLang is purely a UX override and does NOT change
 * what we believe the user can read.
 */
export function useLang(): string {
  const user = useStore(s => s.user);
  return user?.lang || 'en';
}

/**
 * Standalone translation for non-React contexts (e.g. error handlers).
 * Uses English only since async loading isn't practical outside React.
 */
export function tBrowser(key: string): string {
  return loaded.en[key] ?? key;
}
