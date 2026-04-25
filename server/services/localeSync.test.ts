import { describe, it, expect } from 'vitest';
import {
  mapClaimToLocale,
  resolveLocaleClaimKeys,
  extractLocaleClaim,
  computeLocaleUpdate,
} from './localeSync.js';

describe('mapClaimToLocale', () => {
  it('maps Dutch regional variants to nl', () => {
    expect(mapClaimToLocale('nl-BE')).toBe('nl');
    expect(mapClaimToLocale('nl-NL')).toBe('nl');
    expect(mapClaimToLocale('nl')).toBe('nl');
  });

  it('maps French regional variants to fr', () => {
    expect(mapClaimToLocale('fr-BE')).toBe('fr');
    expect(mapClaimToLocale('fr-FR')).toBe('fr');
    expect(mapClaimToLocale('fr-CA')).toBe('fr');
    expect(mapClaimToLocale('fr')).toBe('fr');
  });

  it('maps English regional variants to en', () => {
    expect(mapClaimToLocale('en-US')).toBe('en');
    expect(mapClaimToLocale('en-GB')).toBe('en');
    expect(mapClaimToLocale('en')).toBe('en');
  });

  it('is case-insensitive', () => {
    expect(mapClaimToLocale('EN-US')).toBe('en');
    expect(mapClaimToLocale('NL-be')).toBe('nl');
    expect(mapClaimToLocale('FR')).toBe('fr');
  });

  it('returns null for unsupported languages', () => {
    expect(mapClaimToLocale('de-DE')).toBeNull();
    expect(mapClaimToLocale('es')).toBeNull();
    expect(mapClaimToLocale('ja-JP')).toBeNull();
  });

  it('returns null for empty / missing claims', () => {
    expect(mapClaimToLocale('')).toBeNull();
    expect(mapClaimToLocale(null)).toBeNull();
    expect(mapClaimToLocale(undefined)).toBeNull();
  });
});

describe('resolveLocaleClaimKeys', () => {
  it('uses defaults when attribute map is null / undefined', () => {
    expect(resolveLocaleClaimKeys(null)).toEqual(['preferredLanguage', 'locale', 'xms_lang']);
    expect(resolveLocaleClaimKeys(undefined)).toEqual(['preferredLanguage', 'locale', 'xms_lang']);
    expect(resolveLocaleClaimKeys({})).toEqual(['preferredLanguage', 'locale', 'xms_lang']);
  });

  it('puts override first, keeps defaults as fallback', () => {
    const keys = resolveLocaleClaimKeys({ locale: 'customLocaleAttr' });
    expect(keys[0]).toBe('customLocaleAttr');
    expect(keys).toContain('preferredLanguage');
    expect(keys).toContain('locale');
  });

  it('deduplicates when override matches a default', () => {
    const keys = resolveLocaleClaimKeys({ locale: 'locale' });
    expect(keys.filter((k) => k === 'locale')).toHaveLength(1);
    expect(keys[0]).toBe('locale');
  });

  it('ignores empty/whitespace override', () => {
    expect(resolveLocaleClaimKeys({ locale: '' })).toEqual(['preferredLanguage', 'locale', 'xms_lang']);
    expect(resolveLocaleClaimKeys({ locale: '   ' })).toEqual(['preferredLanguage', 'locale', 'xms_lang']);
  });
});

describe('extractLocaleClaim', () => {
  it('returns the first non-empty claim value under the candidate keys', () => {
    expect(
      extractLocaleClaim({ preferredLanguage: 'fr-BE' }, null),
    ).toBe('fr-BE');
    expect(
      extractLocaleClaim({ locale: 'en-US', xms_lang: 'de-DE' }, null),
    ).toBe('en-US');
  });

  it('prefers partner override over defaults', () => {
    expect(
      extractLocaleClaim(
        { customAttr: 'nl-BE', preferredLanguage: 'en-US' },
        { locale: 'customAttr' },
      ),
    ).toBe('nl-BE');
  });

  it('falls back to defaults when override key is missing', () => {
    expect(
      extractLocaleClaim(
        { preferredLanguage: 'fr-FR' },
        { locale: 'customAttr' },
      ),
    ).toBe('fr-FR');
  });

  it('ignores non-string claim values', () => {
    expect(extractLocaleClaim({ preferredLanguage: 42 }, null)).toBeNull();
    expect(extractLocaleClaim({ preferredLanguage: null }, null)).toBeNull();
  });

  it('returns null when no candidate key has a value', () => {
    expect(extractLocaleClaim({}, null)).toBeNull();
    expect(extractLocaleClaim({ unrelated: 'foo' }, null)).toBeNull();
  });

  it('trims whitespace from matched values', () => {
    expect(extractLocaleClaim({ preferredLanguage: '  fr-FR  ' }, null)).toBe('fr-FR');
  });
});

describe('computeLocaleUpdate', () => {
  it('returns null when user has locked the lang', () => {
    expect(
      computeLocaleUpdate({ currentLang: 'en', langLocked: true, claim: 'fr-FR' }),
    ).toBeNull();
  });

  it('returns mapped locale when claim differs from current', () => {
    expect(
      computeLocaleUpdate({ currentLang: 'en', langLocked: false, claim: 'fr-BE' }),
    ).toBe('fr');
    expect(
      computeLocaleUpdate({ currentLang: null, langLocked: false, claim: 'nl' }),
    ).toBe('nl');
  });

  it('returns null when mapped locale matches current (no-op)', () => {
    expect(
      computeLocaleUpdate({ currentLang: 'fr', langLocked: false, claim: 'fr-FR' }),
    ).toBeNull();
  });

  it('returns null when claim is empty / unmapped (no overwrite)', () => {
    expect(
      computeLocaleUpdate({ currentLang: 'en', langLocked: false, claim: null }),
    ).toBeNull();
    expect(
      computeLocaleUpdate({ currentLang: 'en', langLocked: false, claim: 'de-DE' }),
    ).toBeNull();
  });
});
