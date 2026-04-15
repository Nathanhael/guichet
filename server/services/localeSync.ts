/**
 * SSO-driven locale sync — pure helpers for mapping IdP `preferredLanguage`
 * (BCP 47) claims to Guichet's supported locale set (nl / fr / en).
 *
 * Product rule: the SSO claim drives `users.lang` on every login, unless the
 * user has manually overridden via the UI (`users.langLocked = true`). See
 * `docs/superpowers/specs/2026-04-15-sso-locale-sync-design.md`.
 */

export const SUPPORTED_LOCALES = ['nl', 'fr', 'en'] as const;
export type SupportedLocale = typeof SUPPORTED_LOCALES[number];

/**
 * Maps a BCP 47 language tag (or bare ISO 639-1 code) to one of Guichet's
 * supported locales. Case-insensitive. Returns null for anything we can't map.
 *
 * Examples:
 *   `nl-BE`, `NL-nl`, `nl`  → `'nl'`
 *   `fr-FR`, `fr-CA`, `fr`  → `'fr'`
 *   `en-US`, `en-GB`, `en`  → `'en'`
 *   `de-DE`, `es`, ``, null → `null`
 */
export function mapClaimToLocale(claim: string | null | undefined): SupportedLocale | null {
  if (!claim) return null;
  const primary = claim.toLowerCase().split('-')[0];
  return (SUPPORTED_LOCALES as readonly string[]).includes(primary)
    ? (primary as SupportedLocale)
    : null;
}

/**
 * Resolves which attribute name holds the locale claim for a given partner.
 *
 * Partners may override per-IdP quirks via `partners.ssoAttributeMap.locale`
 * (e.g. Okta sometimes ships `locale`, Entra ships `preferredLanguage`, some
 * tenants use custom SAML attributes). Falls back to the Entra defaults we
 * already extract inline.
 *
 * Returns the ORDERED list of claim keys to try — first non-empty claim wins.
 */
export function resolveLocaleClaimKeys(
  attributeMap: { locale?: string } | null | undefined,
): string[] {
  const override = attributeMap?.locale?.trim();
  const defaults = ['preferredLanguage', 'locale', 'xms_lang'];
  if (override) return [override, ...defaults.filter((k) => k !== override)];
  return defaults;
}

/**
 * Extracts a locale claim value from a raw claims object using the partner's
 * configured attribute-map (or defaults). Returns the first non-empty string
 * found under the candidate keys, or null.
 */
export function extractLocaleClaim(
  claims: Record<string, unknown>,
  attributeMap: { locale?: string } | null | undefined,
): string | null {
  for (const key of resolveLocaleClaimKeys(attributeMap)) {
    const value = claims[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

/**
 * High-level decision: given the user's current state + the IdP claim,
 * should we update `users.lang`? Returns the new locale to write, or null
 * if no update should happen.
 *
 *   langLocked=true             → null (user override wins)
 *   claim empty or unmapped     → null (don't overwrite with null)
 *   claim maps to current lang  → null (no-op, avoids write amplification)
 *   otherwise                    → the mapped locale
 */
export function computeLocaleUpdate(params: {
  currentLang: string | null | undefined;
  langLocked: boolean;
  claim: string | null;
}): SupportedLocale | null {
  if (params.langLocked) return null;
  const mapped = mapClaimToLocale(params.claim);
  if (mapped === null) return null;
  if (mapped === params.currentLang) return null;
  return mapped;
}
