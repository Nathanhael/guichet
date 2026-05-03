# Canned-response auto-translation (per-partner gated)

**Date:** 2026-05-03
**Status:** Plan; not yet executing
**Author:** Bart + Claude

## Context

Today canned responses are single-language: admins write one body in `canned_responses.body`, support staff insert it as-is. When the partner's customer-facing communication spans NL/FR/EN (typical for Belgian telco like Proximus), admins must hand-author three copies and keep them in sync.

This plan adds AI-translated canned responses behind a per-partner platform-operator toggle. When enabled, admins write the canned in one source language; the AI populates NL/FR (or whichever two are not the source). Translations are editable. When disabled, behaviour reverts to today's single-body flow with zero schema-visible UX change.

The existing `runAiAction({ action: 'translate' })` pipeline is already wired with the partner glossary substitution (`{{preserve_terms}}` / `{{forbidden_terms}}`) — canned translations get the same Proximus-product-name protection for free.

## Decisions

### Decision 1 — Translate at write-time (eager), not read-time

Admins curate canned wording carefully and want to *see* the FR/NL versions before they go to customers. Read-time translation (lazy + cached) is great for SaaS scale but the wrong fit for a curation-oriented tool. Cost is bounded (~2 calls per canned create) and amortized across many uses.

### Decision 2 — Feature flag in `aiFeatures` JSONB, named `cannedTranslation`

Matches the existing per-partner AI-feature pattern (`messageImprovement`, `translation`, `voiceTranscription`, `queueLangAwareness`). Effective only when `aiEnabled=true` AND `aiFeatures.cannedTranslation=true`. Surfaced in `EditPartnerModal.tsx` as one row in `BOOLEAN_FEATURES`. Validated in `featuresEnvelope.ts` so platform operators can constrain partner-admin choices via `aiFeaturesAvailable`.

### Decision 3 — Schema is partner-agnostic; new columns ship for everyone

`source_lang text` + `body_translations jsonb default '{}'::jsonb` are added to `canned_responses` regardless of any partner's flag state. They're inert until the flag flips. Bending schema per-tenant is more risk than the unused-columns cost.

### Decision 4 — Toggle-off preserves data

Flipping `cannedTranslation=false` after data exists hides the multi-lang UI and reverts the picker to inserting `body` as-is, but leaves `body_translations` populated in the DB. Re-enabling restores everything. This makes the flag a one-click reversible operation, not a destructive one.

### Decision 5 — Backfill is opt-in, not automatic

When a partner first enables the flag, existing canneds have empty `body_translations`. The admin sees a banner in `AdminCannedResponses`: "X canned responses don't have translations yet — translate now?" They click to run the backfill. Auto-running on flag-flip would surprise operators with bills they didn't authorize.

### Decision 6 — Source-edit marks translations stale; manual regen per language

Editing the source body sets a `staleTranslations: true` flag (or a per-language hash that no longer matches). UI shows a per-language warning and a "Regenerate" button. Auto-regen on every save spends tokens on incremental edits the admin is still tweaking. Manual regen costs one click but leaves the admin in control.

## Surface area

### Schema

Drizzle migration adds two columns to `canned_responses`:

| Column | Type | Default | Notes |
|---|---|---|---|
| `source_lang` | `text` | `'en'` | Two-letter code matching `users.lang`. Existing rows backfill to `'en'` (or partner's default). |
| `body_translations` | `jsonb` | `'{}'::jsonb` | `{ "nl": "...", "fr": "..." }`. The `source_lang` entry is intentionally omitted (lives in `body`). |

Backfill handling for existing rows is just the column defaults — no data migration needed.

### Server

**`server/services/cannedTranslation.ts`** (new):
- `translateCanned(partnerId, userId, body, sourceLang) → { nl?, fr?, en? }` — runs `runAiAction({ action: 'translate' })` for each non-source language, returns the translated bodies. Returns the original on AI failure (graceful degradation).
- `isFeatureOn(partnerId)` helper that checks `aiEnabled` AND `aiFeatures.cannedTranslation`.

**`server/trpc/routers/cannedResponse.ts`** (existing):
- `create`: accept new optional `sourceLang` input. After insert, if the feature is on, fan out `translateCanned()` and update `body_translations`.
- `update`: same shape; if `body` changed, mark stale (clear `body_translations` or set per-key hash).
- `regenerate(id, langs[])` (new): force re-translate the listed languages. Admin-gated, partner-scoped, feature-gated.
- `backfillUntranslated()` (new): translate all canneds in the partner where `body_translations` is empty. Returns count. Admin-gated, feature-gated.
- `getForPicker(ticketId)` (existing/new): return canneds resolved to recipient lang. The picker doesn't need to know about translations — server returns the right body based on ticket context.

**`server/services/ai/featuresEnvelope.ts`**:
- Add `'cannedTranslation'` to `BOOLEAN_FEATURES` so `aiFeaturesAvailable` envelope validation covers it.

**`server/services/ai/config.ts`**:
- Add `cannedTranslation` to `PartnerAiConfig` and `getPartnerAiConfig` reading.
- Add `'cannedTranslation'` to the `isFeatureEnabled` feature union.

### Client

**`client/src/components/platform/EditPartnerModal.tsx`**:
- Add one row to `BOOLEAN_FEATURES`:
  ```
  { key: 'cannedTranslation', label: 'Canned translation', description: 'Auto-translate canned responses to NL/FR/EN; admin-editable' }
  ```
- Add to both `aiFeatures` and `aiFeaturesAvailable` Zod input schemas in `server/trpc/routers/platform/partners.ts`.

**`client/src/components/platform/types.ts`**:
- Add `cannedTranslation?: boolean` to the `AiFeatures` interface.

**`client/src/components/admin/AdminCannedResponses.tsx`**:
- Read `cannedTranslation` from partner config (via existing tRPC query).
- When OFF: render today's UI unchanged.
- When ON:
  - Add a source-language picker to the create/edit form (default = admin's UI lang).
  - Render a 3-tab body editor (Source / NL / FR / EN minus source). Each non-source tab is read-only by default with an "Edit" toggle and a "Regenerate" button.
  - Show a banner above the list when any canned has empty `body_translations`: "X canned responses don't have translations — translate now?" → calls `backfillUntranslated`.
  - Show a per-language stale warning when `body_translations` is missing or marked stale after a source edit.

**`client/src/components/CannedResponsePicker.tsx`**:
- When the feature is off, behaviour unchanged.
- When on: insert `body_translations[recipientLang] ?? body`. Recipient lang comes from the ticket's agent-side `users.lang` (already in scope via the ticket query).

### Locales

Add new strings to `client/src/locales/{en,nl,fr}.ts`:
- `admin_canned_translate_label` — "Translation" (tab label group)
- `admin_canned_translate_source_lang` — "Source language"
- `admin_canned_translate_regenerate` — "Regenerate"
- `admin_canned_translate_stale` — "Source changed — translation may be out of date"
- `admin_canned_translate_backfill_banner` — "{count} canned responses don't have translations yet"
- `admin_canned_translate_backfill_button` — "Translate all"

## Build sequence

| Step | Files | Verifies |
|---|---|---|
| 1. Migration + schema constants | `server/db/schema.ts`, new Drizzle migration file | `npx drizzle-kit generate` produces a clean diff; columns are nullable / have defaults so existing tests still pass |
| 2. Feature flag plumbing | `featuresEnvelope.ts` + test, `config.ts`, `types.ts`, `platform/partners.ts` Zod | `featuresEnvelope.test.ts` updated for the 4-boolean count; `isFeatureEnabled` returns false until partner toggled on |
| 3. Server-side translation service | `cannedTranslation.ts` + test, `cannedResponse.ts` router updates | New tRPC test: feature off → canned creation skips translate. Feature on → translate is called twice and result lands in `body_translations`. AI failure → canned still saves (graceful). |
| 4. Picker server resolution | `cannedResponse.ts` (`getForPicker` or equivalent) | tRPC test: recipient `lang='nl'` returns `body_translations.nl` when present, else falls back to `body`. Feature off → always returns `body`. |
| 5. Platform UI toggle | `EditPartnerModal.tsx`, `client/src/components/platform/types.ts` | Manual smoke: platform operator can flip the toggle on guichet-main; tRPC mutation persists; partner config query reflects change. |
| 6. Admin UI multi-lang editor | `AdminCannedResponses.tsx`, locales | Vitest: feature off → only single-body editor renders. Feature on → 3-tab editor + regenerate button + stale warning. Edit source → stale flag set on existing translations. |
| 7. Picker client | `CannedResponsePicker.tsx` | Vitest: with feature on + recipient `lang='fr'`, picker inserts the FR translation; missing FR → falls back to source. Feature off → always inserts source. |
| 8. Backfill flow | New `cannedResponse.backfillUntranslated` mutation + admin banner | tRPC test: 5 canneds with empty translations → backfill triggers 10 translate calls (5 × 2 langs) → all canneds end with populated `body_translations`. Feature off → mutation rejected with FORBIDDEN. |
| 9. E2E | `testing/e2e/admin-canned-translation.spec.ts` (new) | Platform operator enables flag → admin creates canned in EN → NL/FR auto-populated → support inserts canned in NL ticket → NL body sent. |
| 10. Local CI | `scripts/ci.ps1` | Typecheck + tests + migration + e2e all green. |

## Risks

| Risk | Mitigation |
|---|---|
| Translation cost spike when admins create many canneds | Per-partner rate limit already gates `runAiAction`. Backfill is opt-in. Failed translations don't retry automatically. |
| AI mistranslation poisons customer-facing output | Admin sees all 3 versions in the editor and can manually edit any tab. Glossary preserves brand terms via `{{preserve_terms}}`. Forbidden list strips AI's filler in the translated output. |
| Source-edit "stale" state confuses admins | Per-language warning + explicit "Regenerate" button. No silent retranslation. |
| Schema columns shipped but feature off → confusion in DB tools | Columns have sensible defaults; `body_translations='{}'` reads the same as "no translations yet" regardless of flag state. Documented in the schema comment. |
| Picker performance regression from extra JSON field | `body_translations` is the same row, no additional join. Negligible. |
| E2E test relies on real AI provider | Mock the translate call in the spec (mirroring `ai-features.spec.ts` pattern with `mockAiResponses`). |

## What this plan does NOT cover

- Admin bulk-edit flows (e.g. "find/replace across all canneds") — out of scope.
- Translation memory / per-partner glossary versioning — current glossary already applies; no new mechanism.
- Customer-side display of canneds in their language (this is a staff-side picker; the customer just sees the inserted message). The translation IS the language match.
- Telemetry on which translation languages get used most — interesting but not blocking.

## Open questions for review

1. **Source-lang choice on create:** default to admin's UI lang, or always `'en'`? Current default in plan: admin's UI lang. Override if you'd rather standardize on EN-as-canonical.
2. **Backfill UX:** banner-and-button (current plan) vs. drop-down menu item ("Tools → Translate all") — which is more discoverable for your admins?
3. **Stale signal:** simple boolean per language vs. content-hash comparison? Boolean is simpler; hash is more robust if the source body's whitespace changes a lot. Recommend boolean for v1.
