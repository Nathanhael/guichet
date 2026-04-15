# SSO-Driven Locale Sync — Design Spec

**Date**: 2026-04-15
**Goal**: Derive user interface language from the identity provider's `preferredLanguage` claim on each SSO login, instead of requiring every user to pick their locale manually. Keep the manual `LanguageSwitcher` as an override.

**Secondary outcome**: Removes flag emojis (🇧🇪 / 🇫🇷 / 🇬🇧) from the post-auth JavaScript chunk, which unblocks the Vite 8 / Rolldown production build currently panicking inside `rolldown_utils/src/hash_placeholder.rs:56` on a mid-codepoint byte slice through the FR flag.

---

## Motivation

### Current state

- `client/src/locales/{en,fr,nl}.ts` — three static locale dictionaries.
- `client/src/components/LanguageSwitcher.tsx` — dropdown labeled `🇧🇪 NL / 🇫🇷 FR / 🇬🇧 EN`.
- `users.lang` column (`nl | fr | en`) persists the choice; `useTranslation` hook reads from the Zustand config slice.
- On first SSO login, the user lands on whatever default the server chose (usually `en`) and must manually switch.

### Two problems

1. **UX**: Enterprise tenants expect identity-managed locale (IT admins set `preferredLanguage` in Entra / Google Workspace; users should not re-pick per app).
2. **Build**: The flag-emoji string `🇧🇪 NL` lives in the same post-auth chunk as other app state. Rolldown's placeholder resolver slices that chunk's output at byte offsets without `char_indices()` traversal — byte 105 lands mid-codepoint inside 🇧🇪 (bytes 103..107). Confirmed pre-existing at commit `0a7ba58` (before the Guichet rebrand). Upstream bug. Moving emoji flags out of the post-auth chunk side-steps it.

---

## Non-goals

- Right-to-left language support (no Arabic/Hebrew in the current locale set).
- Per-partner translation overrides beyond what already exists (partner name, dept labels).
- Auto-translation of user-generated content (already handled by `ai/prompts.ts` translate action).

---

## Claim sources per IdP

| IdP | Primary claim | Format | Fallback claims |
|---|---|---|---|
| Entra ID / Azure AD | `preferredLanguage` | BCP 47 (`nl-BE`, `en-US`) | `locale`, `ctry` |
| Google Workspace | `locale` | BCP 47 (`nl`, `en-US`) | none; may need extra OAuth scope |
| Generic SAML | `urn:oid:2.16.840.1.113730.3.1.39` | BCP 47 or ISO 639-1 | tenant-configured attribute name |
| Okta / OneLogin / Keycloak | `locale` (OIDC) or configurable SAML attr | varies | tenant-configured |

### Attribute mapping strategy

Extend the existing `partner_group_mappings` pattern with a new table `partner_sso_attribute_map` (or simpler: add a JSONB column `ssoAttributeMap` on `partners`). Platform operator configures per-partner:

```json
{
  "locale": "preferredLanguage",
  "firstName": "givenName",
  "lastName": "sn"
}
```

Defaults preserve current behavior when the column is null. A lookup helper reads the attribute name from partner config, falls back to a default list, and returns the raw claim value.

**Implementation placement**: new file `server/services/ssoClaims.ts` holds the lookup + mapper. Existing `sso.ts` route imports and calls it after the IdP response is parsed.

---

## BCP 47 → supported-locale mapper

Pure function in `server/services/localeSync.ts`:

```typescript
const SUPPORTED = ['nl', 'fr', 'en'] as const;
type Supported = (typeof SUPPORTED)[number];

export function mapClaimToLocale(claim: string | null | undefined): Supported | null {
  if (!claim) return null;
  const primary = claim.toLowerCase().split('-')[0];
  if (SUPPORTED.includes(primary as Supported)) return primary as Supported;
  return null;
}
```

Table:

| Claim value | Mapped |
|---|---|
| `nl-BE`, `nl-NL`, `nl` | `nl` |
| `fr-BE`, `fr-FR`, `fr-CA`, `fr` | `fr` |
| `en-US`, `en-GB`, `en` | `en` |
| `de-DE`, `es-ES`, anything else | `null` (fall through) |

`null` return falls back to existing `users.lang`, then browser `Accept-Language` header, then `en`.

---

## Sync policy

### Product rule

**SSO claim is the source of truth for locale. User can override via UI; override persists across sessions until explicitly unlocked.**

One rule, no per-partner toggle. Simpler DB, simpler mental model. If a tenant ever needs to opt out, that becomes a future feature — YAGNI for v1.

### New column: `users.langLocked` (boolean, default `false`)

Tracks whether the user has manually overridden the locale. Once locked, SSO claim no longer updates `users.lang`.

### Decision matrix on login

| Auth path | `langLocked` | Claim present | Action |
|---|---|---|---|
| Local password | — | — | No change (no claim exists; `Accept-Language` fallback on first-ever login only) |
| SSO | `false` | yes, mapped | Update `users.lang` to mapped claim |
| SSO | `false` | no / unmapped | Keep existing `users.lang` (no overwrite with null) |
| SSO | `true` | — | No change (user override wins) |

### Manual override flow (client)

- User opens `LanguageSwitcher`, picks a different locale.
- Client calls new `trpc.user.setLocale({ lang, lockFromSso: true })` mutation.
- Server sets `users.lang` + `users.langLocked = true`. Logs to audit trail.
- Badge flips from "SYNCED FROM SSO" to "UNLOCK SSO SYNC" button.
- Clicking unlock calls `trpc.user.setLocale({ lockFromSso: false })` (no lang change). Next SSO login re-syncs from claim.

### First login of a local operator (no SSO)

Browser `Accept-Language` header → run through same mapper → set `users.lang`. `langLocked` stays `false`. (Future SSO logins, if the operator ever has an SSO account in another tenant, would sync normally.)

---

## Handling existing users

Production tenants already have users with manually-picked `users.lang` values. On first SSO login after this ships, the claim will overwrite `users.lang` because `langLocked=false` on all pre-existing rows.

**Chosen path: let it happen.** User notices the wrong locale, clicks the switcher once, `langLocked=true`, done. One-click recovery. Cost: temporary confusion for a handful of users who had deliberately-different locales.

**Alternative considered (rejected):** one-time backfill setting `langLocked=true` on every existing row. Safer but delays the benefit indefinitely for users whose current `users.lang` matches what the claim would have set anyway. The audit trail can't distinguish user-picked from admin-seeded values, so the backfill is too conservative.

Documented in `CHANGELOG.md` as expected behavior when this ships.

---

## Client UX changes

### Post-auth `LanguageSwitcher`

- Replace `🇧🇪 NL / 🇫🇷 FR / 🇬🇧 EN` with native-language labels: `Nederlands / Français / English`. No emoji. No flag SVG. Text-only, matches brutalist JetBrains Mono aesthetic.
- When the user logged in via SSO AND `langLocked=false`:
  - Show a small "SYNCED FROM SSO" badge next to the current language.
  - On manual pick, tooltip confirms this overrides SSO sync (sets `langLocked=true`).
- When `langLocked=true` AND the user has an SSO auth path available:
  - Show "UNLOCK SSO SYNC" button below the picker.
- When the user is a local-only platform operator (no SSO in their auth history):
  - Hide the badge + unlock button entirely. Switcher behaves like today.

Check "has SSO available" via `users.lastAuthMethod` (new column, see Migration) rather than per-partner `authMethod`, since `both`-mode partners have a mix of SSO and local users in the same tenant.

### Login page (`LoginView`)

Pre-auth. User identity unknown; cannot apply claim.

**Keep flag emojis here** — they live in a separate Vite chunk (login is a top-level route, split from the main app shell). Rolldown panic doesn't trigger for that chunk's layout.

If the panic does recur on the login chunk after other changes, fall back to native-language labels here too.

### New route: `trpc.user.setLocale`

```typescript
setLocale: protectedProcedure
  .input(z.object({
    lang: z.enum(['nl', 'fr', 'en']).optional(),
    lockFromSso: z.boolean().optional(),
  }))
  .mutation(async ({ ctx, input }) => {
    const patch: Partial<User> = {};
    if (input.lang) patch.lang = input.lang;
    if (typeof input.lockFromSso === 'boolean') patch.langLocked = input.lockFromSso;
    if (Object.keys(patch).length === 0) return { ok: true };
    await db.update(users).set(patch).where(eq(users.id, ctx.userId));
    await auditLog.record('user.locale.changed', ctx.userId, ctx.partnerId, { ...patch });
    return { ok: true };
  }),
```

---

## Migration (Drizzle)

New migration `drizzle/NNNN_sso_locale_sync.sql`:

```sql
ALTER TABLE users ADD COLUMN lang_locked BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN last_auth_method TEXT;  -- 'local' | 'sso' | NULL
ALTER TABLE partners ADD COLUMN sso_attribute_map JSONB;
```

### Backfill

- `users.lang_locked = FALSE` for all existing rows. See "Handling existing users" above for the rationale — we accept one-time locale overwrite on first SSO login rather than a conservative backfill.
- `users.last_auth_method = NULL` — populated on next login.
- `partners.sso_attribute_map = NULL` — defaults used until platform operator configures per-partner overrides.

### Rollback

Drop the three columns. Feature gracefully no-ops: SSO route reads `partner.ssoAttributeMap` defensively (`?? DEFAULT_MAP`), missing column → defaults used → behavior falls back to "no sync on login". Existing `users.lang` values unaffected.

---

## Test plan

### Server (Vitest)

- `server/services/localeSync.test.ts` — mapper table: `nl-BE` → `nl`, `fr-FR` → `fr`, `de-DE` → `null`, `en` → `en`, `''` → `null`, `null` → `null`, `EN-US` → `en` (case insensitive).
- `server/services/ssoClaims.test.ts` — attribute lookup with/without partner override, claim extraction from SAML + OIDC response fixtures.
- `server/routes/sso.test.ts` — integration: mock Entra response with `preferredLanguage: "fr-FR"`, assert `users.lang = 'fr'`, `langLocked = false`, `lastAuthMethod = 'sso'`, audit log entry.
- Decision matrix: exhaustive test cases for the 4 rows above.
- Override lock: replay SAML response after user set `langLocked=true` → `users.lang` unchanged.
- Unmapped claim: SSO response with `preferredLanguage: "de-DE"` → existing `users.lang` preserved (no null overwrite).

### Client (Vitest + jsdom)

- `LanguageSwitcher.test.tsx` — renders native-language labels (no emoji), shows "SYNCED FROM SSO" badge when applicable, shows "UNLOCK" button when locked.
- Manual pick triggers `setLocale` mutation with `lockFromSso: true`.
- Unlock triggers `setLocale` with `lockFromSso: false`.

### E2E (Playwright)

New `testing/e2e/sso-locale-sync.spec.ts`:

1. Seed an SSO-capable partner with a user who has no `users.lang` set.
2. Mock SSO IdP returns `preferredLanguage=fr-BE`.
3. Log in → assert UI is French, "SYNCED FROM SSO" badge visible.
4. Manually switch to English in the switcher → assert UI is English, `langLocked=true`, badge replaced by "UNLOCK SSO SYNC" button.
5. Log out, log in again (same IdP claim) → assert UI stays English (override wins).
6. Click "UNLOCK SSO SYNC" → log out, log in again → assert UI is French again, badge returns.
7. Local platform operator login (no SSO) → assert switcher shows no badge and no unlock button.

---

## Rolldown build verification

### Current failure

```
thread panicked at rolldown_utils/src/hash_placeholder.rs:56:38
byte index 105 is not a char boundary; it is inside '🇧' (bytes 103..107)
```

Chunk containing `var r = {nl: '🇧🇪 NL', fr: '🇫🇷 FR', en: '🇬🇧 EN'}` — the post-auth `useStore` / toolbar chunk.

### Fix verification

After removing flag emojis from `LanguageSwitcher.tsx`, the string literal disappears from the post-auth chunk. Rolldown's byte-slice call still fires but on different chunk content that doesn't contain multi-byte codepoints at the problem offset.

**Regression guard**: add a build step to `scripts/ci.ps1` that runs outside the `-Skip e2e` branch:

```powershell
Run-Step "build" @("docker compose exec client npm run build")
```

Currently the build only runs as part of `e2e`, which is skipped in the default CI invocation. Promoting it to its own step catches future regressions.

### Login chunk note

If flag emojis in `LoginView` eventually trigger the same panic (chunk byte offsets can shift with code changes), replace them with native labels or inline SVG flags served as static assets.

---

## Alternatives considered

### 1. Upgrade Vite / Rolldown

- Vite 8 bundles Rolldown 0.x. Check the latest Rolldown release for a `hash_placeholder` char-boundary fix.
- If a newer release ships the fix, upgrade Vite alongside (`vite@latest`).
- **Verdict**: still worth doing independently, but doesn't solve the UX problem. This proposal's approach solves both.

### 2. Replace flag emojis with SVG country-flag icons

- Static SVG assets under `client/public/flags/` imported in `LanguageSwitcher`.
- Pro: preserves visual flag cue.
- Con: extra HTTP requests, brutalist aesthetic actively avoids decorative imagery, doesn't address the IdP UX question.
- **Verdict**: reject; text labels match the brutalist spec and remove the bundler trap entirely.

### 3. Downgrade to Vite 7 (Rollup backend)

- Lose Rolldown's speed gain, avoid its bugs.
- Pro: fastest unblock.
- Con: regression on build time; Vite 7 is being phased out; doesn't solve UX.
- **Verdict**: temporary backstop if upgrade + this proposal both slip.

### 4. File upstream Rolldown issue and wait

- Acceptable for the build bug alone, but leaves UX unsolved.
- **Verdict**: file the issue anyway as a courtesy; do not gate this proposal on it.

---

## Decisions made

1. **~~Per-partner opt-in~~** — REJECTED. Product rule is "SSO claim drives locale, user can override via UI" for every tenant that uses SSO. No `partners.syncLocaleFromSso` column. Simpler DB, simpler UI, simpler mental model.
2. **Badge + unlock UI visibility** — hide when the user's `lastAuthMethod` is `'local'` (e.g., platform operators with no SSO path). Show for all SSO-authenticated users.
3. **Login page flag emojis** — leave as-is. The login chunk has different byte layout from the panicking post-auth chunk. Add `build` step to `scripts/ci.ps1` so future regressions fail fast; replace with text labels only if the login chunk ever panics.
4. **Attribute map UI** — JSON textarea in partner config, validated with Zod on submit. Graduate to a dedicated form if the shape grows beyond 5 keys or platform operators request it.

## Remaining open questions

- **Audit verbosity**: log every SSO-driven locale sync, or only transitions where `users.lang` actually changes? Recommending: log only changes (claim matched current value is noise).
- **Rate limiting on `setLocale`**: any need to cap how often a user can flip lang? Recommending: no — the switcher already requires manual click, no automated abuse vector.

---

## Implementation order

1. Migration (`users.langLocked`, `users.lastAuthMethod`, `partners.ssoAttributeMap`).
2. `server/services/localeSync.ts` + unit tests (pure mapper).
3. `server/services/ssoClaims.ts` + unit tests (attribute lookup, per-partner override).
4. Wire into `server/routes/sso.ts` SAML + OIDC callbacks. Stamp `users.lastAuthMethod` on every successful login (both SSO and local paths).
5. `trpc.user.setLocale` mutation + audit log entry.
6. Client `LanguageSwitcher` refactor — text labels, "SYNCED FROM SSO" badge, "UNLOCK SSO SYNC" button, visibility gated by `lastAuthMethod`.
7. Remove `🇧🇪 / 🇫🇷 / 🇬🇧` string literals from post-auth chunks; verify Rolldown build passes.
8. Add `build` step to `scripts/ci.ps1` (outside the e2e skip branch).
9. E2E spec `testing/e2e/sso-locale-sync.spec.ts` covering the 7 scenarios above.
10. Admin UI for per-partner SSO attribute-map JSON editor (`AdminPartnerConfig` or platform SSO tab).
11. CHANGELOG entry noting the "first SSO login may overwrite manually-set locale once" behavior for existing users.

Estimated effort: half a day end-to-end, assuming the upstream SAML/OIDC plumbing is intact (it is — see `decisions/guichet-internal-sso-mail-skip` for recent SSO work).

---

## References

- Upstream: Rolldown repo `rolldown/rolldown` — file `rolldown_utils/src/hash_placeholder.rs`.
- Prior art in this codebase: `server/routes/sso.ts`, `partner_group_mappings` table, `decisions/guichet-internal-sso-mail-skip` wiki page (skip-mail-on-internal-SSO pattern — similar SSO-claim-plumbing shape).
- CLAUDE.md rules applied: no `any`, Zod on server, tRPC for new endpoints, brutalist tokens only (no flag images), multi-tenant isolation preserved (`partner_id` filter on every query).
