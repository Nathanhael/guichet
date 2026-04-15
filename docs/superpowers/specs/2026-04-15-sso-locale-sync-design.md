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

### New column: `users.langLocked` (boolean, default `false`)

Tracks whether the user has manually overridden the locale. Once locked, SSO claim no longer updates `users.lang`.

### Decision matrix on SSO login

| Partner `syncLocaleFromSso` | User `langLocked` | Claim present | Action |
|---|---|---|---|
| `false` | — | — | No change (backward compat) |
| `true` | `false` | yes, mapped | Update `users.lang` to mapped claim |
| `true` | `false` | no / unmapped | Fall through: keep existing `users.lang` or set browser default on first login |
| `true` | `true` | — | No change (user override wins) |

### Manual override flow (client)

- User opens `LanguageSwitcher`, picks a different locale.
- Client calls new `trpc.user.setLocale({ lang, lockFromSso: true })` mutation.
- Server sets `users.lang` + `users.langLocked = true`. Logs to audit trail.
- User gets "Unlock" affordance in the switcher to re-enable SSO sync:
  - Calls `trpc.user.setLocale({ lockFromSso: false })`, no lang change.
  - Next SSO login re-syncs from claim.

### First login of a local operator (no SSO)

Browser `Accept-Language` header → run through same mapper → set `users.lang`. `langLocked` stays `false`.

---

## Partner opt-in

Add boolean column `partners.syncLocaleFromSso` (default `false`). Platform operator UI (`AdminPartnerConfig`) exposes a toggle. Existing tenants aren't surprised; new tenants can opt in.

SSO routes check this flag before running the sync. When `false`, the claim is ignored even if present — respects tenant policy.

---

## Client UX changes

### Post-auth `LanguageSwitcher`

- Replace `🇧🇪 NL / 🇫🇷 FR / 🇬🇧 EN` with native-language labels: `Nederlands / Français / English`. No emoji. No flag SVG. Text-only, matches brutalist JetBrains Mono aesthetic.
- When `partners.syncLocaleFromSso=true` AND `users.langLocked=false`:
  - Show a small "SYNCED FROM SSO" badge next to the current language.
  - On manual pick, confirm via tooltip that this will override SSO (sets `langLocked=true`).
- When `langLocked=true`:
  - Show "UNLOCK SSO SYNC" button below the picker.

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
ALTER TABLE partners ADD COLUMN sync_locale_from_sso BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE partners ADD COLUMN sso_attribute_map JSONB;
```

### Backfill

- `users.lang_locked = FALSE` for all existing rows. If any user has a `lang` value that differs from the tenant default, we have no audit trail distinguishing "user picked it" from "admin set it during seed" — leave `false`. Next SSO login with `syncLocaleFromSso=true` will re-sync. Users re-override as needed. Acceptable for a dev-favored migration.
- `partners.sync_locale_from_sso = FALSE` — opt-in per partner.
- `partners.sso_attribute_map = NULL` — defaults used until configured.

### Rollback

Drop the three columns. Feature gracefully no-ops: SSO route checks `if (partner.syncLocaleFromSso)`, missing column → falsy → skip. Existing `users.lang` behavior unaffected.

---

## Test plan

### Server (Vitest)

- `server/services/localeSync.test.ts` — mapper table: `nl-BE` → `nl`, `fr-FR` → `fr`, `de-DE` → `null`, `en` → `en`, `''` → `null`, `null` → `null`, `EN-US` → `en` (case insensitive).
- `server/services/ssoClaims.test.ts` — attribute lookup with/without partner override, claim extraction from SAML + OIDC response fixtures.
- `server/routes/sso.test.ts` — integration: mock Entra response with `preferredLanguage: "fr-FR"`, assert `users.lang = 'fr'`, `langLocked = false`, audit log entry.
- Decision matrix: exhaustive test cases for the 5 rows above.
- Reuse detection: replay old SAML response after override lock → user lang unchanged.

### Client (Vitest + jsdom)

- `LanguageSwitcher.test.tsx` — renders native-language labels (no emoji), shows "SYNCED FROM SSO" badge when applicable, shows "UNLOCK" button when locked.
- Manual pick triggers `setLocale` mutation with `lockFromSso: true`.
- Unlock triggers `setLocale` with `lockFromSso: false`.

### E2E (Playwright)

New `testing/e2e/sso-locale-sync.spec.ts`:

1. Seed partner with `syncLocaleFromSso=true`, SSO user with no `users.lang` set.
2. Mock SSO IdP returns `preferredLanguage=fr-BE`.
3. Log in → assert UI is French.
4. Manually switch to English in the switcher → assert UI is English, `langLocked` set.
5. Log out, log in again (same IdP claim) → assert UI stays English.
6. Click "UNLOCK SSO SYNC" → log out, log in again → assert UI is French again.

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

## Open questions (need user decision before implementation)

1. **Default opt-in**: should `syncLocaleFromSso` default to `true` for new partners (safer UX default) or `false` (explicit tenant choice)? Recommending `false` — explicit consent aligns with existing multi-tenant opt-in patterns.
2. **Per-user opt-out UI**: expose the "unlock SSO sync" button always, or hide it from partners that don't use SSO? Recommending: show only when `partners.authMethod !== 'local'`.
3. **Login page flag handling**: leave flags as-is until proven broken, or remove proactively? Recommending: leave, with monitoring — the login chunk has a different byte layout.
4. **Attribute map UI**: new platform operator tab vs. inline edit in partner config vs. JSON textarea? Recommending: JSON textarea in partner config initially; dedicated UI if multi-field mapping becomes common.

---

## Implementation order

1. Migration (users.langLocked, partners.syncLocaleFromSso, partners.ssoAttributeMap).
2. `server/services/localeSync.ts` + unit tests.
3. `server/services/ssoClaims.ts` + unit tests.
4. Wire into `server/routes/sso.ts` SAML + OIDC callbacks.
5. `trpc.user.setLocale` mutation.
6. Client `LanguageSwitcher` refactor — text labels + lock badge + unlock button.
7. Remove `🇧🇪 / 🇫🇷 / 🇬🇧` string literals from post-auth chunk.
8. Add `build` step to `scripts/ci.ps1`.
9. E2E spec `sso-locale-sync.spec.ts`.
10. Admin UI for `syncLocaleFromSso` toggle + attribute map editor.

Estimated effort: half a day end-to-end, assuming the upstream SAML/OIDC plumbing is intact (it is — see `decisions/guichet-internal-sso-mail-skip` for recent SSO work).

---

## References

- Upstream: Rolldown repo `rolldown/rolldown` — file `rolldown_utils/src/hash_placeholder.rs`.
- Prior art in this codebase: `server/routes/sso.ts`, `partner_group_mappings` table, `decisions/guichet-internal-sso-mail-skip` wiki page (skip-mail-on-internal-SSO pattern — similar SSO-claim-plumbing shape).
- CLAUDE.md rules applied: no `any`, Zod on server, tRPC for new endpoints, brutalist tokens only (no flag images), multi-tenant isolation preserved (`partner_id` filter on every query).
