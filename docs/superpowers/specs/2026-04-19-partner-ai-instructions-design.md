# Partner AI Instructions ("House Style") — Design Spec

**Date:** 2026-04-19
**Scope:** Per-partner, structured AI instructions ("house style") that prepend to every AI action (improve, translate, summarize, suggest, transcribe-cleanup). Prevents bland/generic AI output; lets each partner enforce tone, terminology, and language conventions without rewriting raw prompt templates.
**Status:** Draft — awaiting approval before implementation.

## Problem

Today's AI prompts are generic ([prompts.ts](server/services/ai/prompts.ts)):

> "Rewrite the following message to be clearer, more professional, and well-structured."

> "Translate the following text to {targetLang}. Preserve the tone and meaning."

A raw partner-level override exists via `aiPromptTemplates` table, but:

- **No UI** — only editable by direct DB write (verified: zero client references to `aiPromptTemplates`)
- **Wholesale rewrite** — partner must replace the entire prompt to add even a one-line directive ("never use the customer's first name without verifying it")
- **Per-action** — to enforce tone consistently across improve + translate + summarize, partner must rewrite all three in sync

Result: partners with strong brand voice (formal vs casual, technical vs lay, terminology) get AI output that doesn't sound like them. Specific incoming need: when fr support replies in a nl ticket, the translation should follow the partner's nl conventions (formal `u` vs informal `je`, modern Dutch vs Belgian Flemish formal, preserved English technical terms, etc.) — not just generic translation.

## Non-Goals

- **Per-user instructions.** "Each agent has their own voice" is too granular and fragments the partner's brand.
- **Per-ticket instructions.** Overkill; instructions are partner-level config, not per-conversation.
- **Free-form prompt rewrite UI.** Existing `aiPromptTemplates` covers the power-user case (still no UI for it — that's a separate decision). This spec is the structured / safe / curated layer above raw prompts.
- **AI-driven instruction suggestions** ("we noticed you say 'collègues' often, want us to add that to your style?"). Cool, but not v1.
- **Preview / dry-run mode for instructions.** Worth doing eventually but adds a 2nd AI call per preview; defer.

## Solution

New per-partner JSONB field `partners.ai_instructions` with a small structured schema. Server prepends a **system-message preamble** assembled from the structured fields to existing prompts, without rewriting them.

**Editor ownership splits by responsibility:**

- **Partner admin** edits the house-style content (in AdminView, new component `AdminAiStyle.tsx`). Brand/tone/terminology is the partner's domain.
- **Platform operator** sets the guardrails (in PlatformView): enables/disables advanced fields, maintains a global content-policy denylist, can override or clear any partner's house style, holds a kill switch.

This separation matches existing patterns: platform operator owns infrastructure + cost decisions, partner admin owns content + brand. The same partner can have rich house-style without becoming a Guichet support ticket every time they want to tweak tone.

## Scope Decisions

| decision | choice | rationale |
|---|---|---|
| layering | preamble prepended to existing prompts (not replacement) | preserves the curated default prompts, partner only adds spice |
| storage | JSONB column on `partners` | no new table for ≤ 1KB of structured config |
| schema | structured fields + escape hatch (free text 500 char) | structured = predictable; free text = covers what we didn't anticipate |
| scope of application | improve, translate, summarize, suggest | not classify (machine-only output, no tone) and not match_canned (matching, not generating) |
| editor | new `AdminAiStyle.tsx` in AdminView (partner admin) | brand voice = content, owned by partner |
| feature on/off | `aiFeatures.aiInstructionsEnabled` (kill switch) + `aiFeatures.aiInstructionsAdvanced` (advanced-fields gate) — both in EditPartnerModal | platform operator decides whether partner sees house style at all and whether free-text fields are unlocked |
| guardrails | three-tier (hard limits, content-policy denylist, advanced-fields gate) | see "Guardrails" section below |
| prompt-injection safety | preamble is config text (validated against denylist + Zod limits); user-supplied message bodies still escaped via existing `interpolate()` | defence-in-depth: partner-supplied config + user-supplied content both filtered |

## Guardrails (three-tier)

Partner admins editing freely without bounds creates three distinct risks: prompt-injection (jailbreaking the model via house-style text), brand drift (rude/discriminatory tone), and token bloat (every AI call gets more expensive). Mitigated by three layered tiers:

### Tier 1 — Hard Limits (always on, code-enforced)

Already covered in the Data Model section below; restated here for completeness.

- Char caps per field (200 / 500 chars)
- Max items in arrays (50 preserveTerms)
- Total assembled preamble cap (~1000 chars), truncate-with-warning beyond
- Enum values for `tone`, `audience`, `pronouns`
- Zod validation at the tRPC boundary

These catch honest mistakes and naive misuse. Cannot be relaxed per partner.

### Tier 2 — Content Policy Denylist (always on, platform-operator-maintained)

Reuses the existing `services/guards.ts` pipeline (injection / threats / discrimination / repetition detectors) — **do not build a parallel safety system**. Apply the same detectors to house-style text at two checkpoints:

| checkpoint | behavior on hit |
|---|---|
| **save time** (`partner.updateAiInstructions`) | block submission; return Zod-style error to partner admin: "Phrase X violates platform content policy (category: injection)" |
| **assembly time** (`assembleSystemPreamble`) | defensive re-check (denylist may have updated since save); strip the offending field, log to audit, emit metric, continue assembling. **Never block a live AI call** — degrades silently to defaults. |

In addition to `guards.ts` patterns, ship a small platform-operator-managed denylist for prompt-injection markers specifically:

- `</system>`, `</user_content>`, `</prompt>`, `<system>`, `<user>`
- "ignore (all|any|the above) (previous|prior) instructions"
- "you are now (a|an|the) "
- "respond (only )?(in|as) (base64|DAN|developer mode|jailbreak)"
- "forget (your|all) (instructions|rules|guidelines)"

Stored in a new `ai_content_policy` table (see schema below). Edited via PlatformView panel.

### Tier 3 — Advanced-Fields Gate (per-partner, platform-operator opt-in)

New `aiFeatures.aiInstructionsAdvanced: boolean` flag.

| flag value | partner admin sees |
|---|---|
| `false` (default for new partners) | structured fields only — tone, audience, pronouns, preserveTerms, languageNotes |
| `true` | structured fields + free-text fields — `additionalContext`, `languagePairs` |

Free-text is the highest-risk surface (longest, most variable, hardest to validate). Defaulting to off means a brand-new partner literally cannot write a prompt-injection attempt without the platform operator first opting them in.

When the gate is off, the editor renders the advanced fields as disabled inputs with a tooltip: "Free-text instructions require platform operator approval. Contact support."

## Platform-Operator Capabilities

Three capabilities live in PlatformView (no per-partner UI):

### 1. Override / clear (always available)

`PlatformAiStyleAudit.tsx` panel lists every partner's current house-style config. Each row has an "Override" button that lets the platform operator clear or replace any field. Audited as `platform.ai_instructions_overridden` with both `before` and `after`. Used for: removing offensive content, fixing prompt-injection that slipped past the denylist, helping a partner who accidentally broke their own AI output.

### 2. Audit / search

Same `PlatformAiStyleAudit.tsx` panel supports search across all partners' house-style content. Useful for: "which partners reference 'OAuth' in preserveTerms", "any partner using `du` form", "partners with non-empty additionalContext". Read-only view aside from the override button.

### 3. Kill switch

`aiFeatures.aiInstructionsEnabled: boolean` (default `true`). When `false`, `assembleSystemPreamble` returns `null` even if `ai_instructions` is populated. Partner admin still sees the editor but with a banner: "House style is currently disabled by your administrator." Use case: emergency rollback if a partner's AI calls start producing bad output and we don't have time to find which field caused it.

## Data Model

### `partners.ai_instructions` JSONB (new)

```ts
type PartnerAiInstructions = {
  // ─── Tone ───────────────────────────────────────────────
  tone?: 'formal' | 'casual' | 'neutral'; // default 'neutral'

  // ─── Audience ───────────────────────────────────────────
  audience?: 'technical' | 'layperson' | 'mixed'; // default 'mixed'

  // ─── Pronoun convention per language ────────────────────
  pronouns?: {
    nl?: 'u' | 'je';                 // default: u (formal)
    fr?: 'vous' | 'tu';              // default: vous (formal)
    en?: 'formal' | 'casual';        // n/a in english but reserved
  };

  // ─── Preserve as-is during translation ──────────────────
  preserveTerms?: string[];          // e.g. ["MyApp Pro", "OAuth", "GUICHET"], max 50 entries, each ≤ 80 chars

  // ─── Per-language additional notes ──────────────────────
  languageNotes?: {
    nl?: string;                     // ≤ 200 chars, e.g. "Use modern Dutch, avoid Flemish formal."
    fr?: string;                     // ≤ 200 chars, e.g. "Standard European French, not Quebec."
    en?: string;                     // ≤ 200 chars
  };

  // ─── Language-pair-specific overrides ───────────────────
  languagePairs?: {
    [pair: string]: string;          // key like "fr->nl", value ≤ 200 chars
  };

  // ─── Free-form escape hatch ─────────────────────────────
  additionalContext?: string;        // ≤ 500 chars, prepended last
};
```

Hard validation in Zod:
- `preserveTerms`: array.max(50), each `string().min(1).max(80)`
- `languageNotes` / `languagePairs`: each value max 200 chars
- `additionalContext`: max 500 chars
- Total assembled preamble capped at ~1000 chars to avoid blowing the prompt budget; truncate with warning if exceeded

No migration risk: JSONB column accepts `null` / `{}` for partners with no instructions configured.

### `ai_content_policy` table (new)

Platform-operator-managed denylist for the Tier 2 guardrail. Versioned (never delete, only deactivate) for compliance / audit.

```sql
id              uuid primary key
pattern         text not null               -- literal substring or regex
pattern_type    text not null               -- 'literal' | 'regex'
category        text not null               -- 'injection' | 'discrimination' | 'threat' | 'jailbreak' | 'other'
severity        text not null               -- 'block' (save+assembly) | 'warn' (assembly-only, log)
active          boolean not null default true
created_by      text not null references users(id)
created_at      timestamptz not null default now()
deactivated_at  timestamptz
notes           text                        -- platform-operator note for why
```

Indexed on `(active, category)`. In-process cached for 60s, busted on update via Redis pubsub. Pre-seeded with the injection-marker patterns listed in Tier 2 above.

### `aiFeatures` (existing JSONB — extend)

```ts
{
  // existing
  voiceInput?: boolean;
  translation?: boolean;
  messageImprovement?: 'off' | 'optional' | 'forced';
  // new
  queueLangAwareness?: boolean;        // from routing spec
  aiInstructionsEnabled?: boolean;     // default true; kill switch
  aiInstructionsAdvanced?: boolean;    // default false; advanced-fields gate
}
```

## Server Layer

### `server/services/ai/instructions.ts` (new)

```ts
export interface AssemblePreambleParams {
  partnerId: string;
  action: AiAction;
  targetLang?: 'nl' | 'fr' | 'en';   // for translate
  sourceLang?: 'nl' | 'fr' | 'en';   // for translate
}

export async function assembleSystemPreamble(
  params: AssemblePreambleParams,
): Promise<string | null>;
```

Returns a string that gets injected as a `system` message before the user prompt. Returns `null` when:

- partner has no instructions configured (current behavior preserved → no behavior change for non-adopting partners), OR
- `aiFeatures.aiInstructionsEnabled === false` (kill switch tripped)

Before returning, every assembled field is run through the Tier 2 denylist (defensive re-check). Fields that match are stripped from the preamble, the strip event is logged to `audit_log` (`platform.ai_instructions_field_stripped`, metadata = `{ field, category, pattern, partnerId }`), and the `guichet_ai_instructions_stripped_total{partnerId,category}` counter is incremented. Assembly continues with the remaining fields. **Never throws on denylist hit — degrades silently** so a stale denylist update can't break live AI calls.

Assembly order (deterministic, for reproducibility):
1. Tone directive (if set): "Reply in a [formal|casual|neutral] tone."
2. Audience directive (if set): "Audience is [technical|layperson|mixed]."
3. Pronoun convention for the active output language (if set, language-relevant)
4. Preserve-as-is list (if non-empty): "Preserve these terms exactly as written, do not translate or rephrase: [list]."
5. Language note for the active output language (if set)
6. Language-pair note (translate only, if `${sourceLang}->${targetLang}` matches a configured pair)
7. Additional context (if set)

Each directive on its own line. Final preamble passed as a separate `system` message in the chat completion request, not concatenated into the user prompt — this lets the model treat it as governing-instructions rather than user content.

### Wiring into existing actions

Modify each AI action runner in `server/services/ai/runAction.ts` (and the per-action services that bypass it):

- `improve` — assemble for action='improve', no lang context → prepend
- `translate` — assemble for action='translate', sourceLang from `senderLang`, targetLang from input → prepend
- `summarize` — assemble for action='summarize' → prepend
- `suggest` — assemble for action='suggest' → prepend
- `classify`, `match_canned` — **do not** assemble; these are machine-output actions, instructions would only confuse the model

Pseudocode:
```ts
const preamble = await assembleSystemPreamble({ partnerId, action, sourceLang, targetLang });
const messages = preamble
  ? [{ role: 'system', content: preamble }, ...existingMessages]
  : existingMessages;
```

### Prompt-injection safety

Defence-in-depth across four layers:

1. **Tier 1 hard limits** (Zod) — caps lengths, restricts enums, prevents the obvious bloat / injection attempt of "stuff 50KB into additionalContext"
2. **Tier 2 content-policy denylist** — `guards.ts` detectors + injection-marker patterns block the known prompt-injection forms at save AND assembly time
3. **Tier 3 advanced-fields gate** — `additionalContext` (the highest-risk surface) is platform-operator opt-in per partner
4. **User-content escaping** — message bodies still go through existing `interpolate()` escaping (`<` → `&lt;`)
5. **Tenant isolation** — even if all four layers fail, a partner attempting to jailbreak their own AI calls only affects their own tenant's output. No cross-tenant blast radius.

Audit captures every change to `ai_instructions` (`partner.ai_instructions_updated`), every override (`platform.ai_instructions_overridden`), every denylist strip (`platform.ai_instructions_field_stripped`).

Document the trust boundaries explicitly in the JSDoc on `assembleSystemPreamble` and in `docs/AUDIT_RUNBOOK.md`.

### Caching

Per-partner instructions are read on every AI call → cache in-process for 60s with a Redis pubsub bust on update (same pattern as partner config caching, if any exists). Reduces DB hits. Cache key: `aiInstructions:${partnerId}`.

## Audit Logging

- `partner.ai_instructions_updated` — actor = partner admin userId, target = partnerId, metadata = `{ before, after }` (full JSONB diff)
- `platform.ai_instructions_overridden` — actor = platform operator userId, target = partnerId, metadata = `{ before, after, reason }`
- `platform.ai_instructions_field_stripped` — actor = `system`, target = partnerId, metadata = `{ field, category, pattern }` — emitted when assembly-time denylist trips
- `platform.content_policy_created` / `_deactivated` — actor = platform operator userId, target = `policy:${id}`, metadata = `{ pattern, category, severity }`
- `partner.ai_instructions_kill_switch_toggled` — emitted via the existing aiFeatures-changed audit when `aiInstructionsEnabled` flips

All diffs ≤ 1KB so no truncation needed.

## tRPC Endpoints

### `partner.updateAiInstructions` (admin only — partner-scoped)

```ts
input: {
  partnerId: string,
  instructions: PartnerAiInstructions | null,  // null clears
}
```

- Role gate: `adminProcedure` (NOT `platformProcedure`) — partner admin owns content
- Pre-condition: throws `FAILED_PRECONDITION` if `aiEnabled === false` for the partner
- Pre-condition: throws `FAILED_PRECONDITION` if `aiFeatures.aiInstructionsEnabled === false` (kill switch)
- Tier 2 save-time check: each field passed through denylist; first hit returns `BAD_REQUEST` with `{ field, category, pattern }`
- Tier 3 advanced-field check: if `aiFeatures.aiInstructionsAdvanced === false` and input contains non-empty `additionalContext` or `languagePairs`, returns `BAD_REQUEST` "Advanced fields are not enabled for this partner"
- Validates against Zod schema (Tier 1)
- Destructive-admin check applies (B2B guests rejected, per existing pattern)
- Audit-logs change (`partner.ai_instructions_updated` with before/after diff)
- Busts pubsub message on update so other servers drop their cache

### `partner.getAiInstructions` (any authenticated, partner-scoped)

```ts
input: { partnerId: string }
output: {
  instructions: PartnerAiInstructions | null,
  enabled: boolean,           // aiFeatures.aiInstructionsEnabled
  advancedAllowed: boolean,   // aiFeatures.aiInstructionsAdvanced
}
```

The editor UI uses `enabled` / `advancedAllowed` to render banners + disable advanced fields.

### `platform.overrideAiInstructions` (platform-operator only)

```ts
input: {
  partnerId: string,
  instructions: PartnerAiInstructions | null,
  reason: string,    // required, ≤ 500 chars, written to audit
}
```

Same Zod validation as the admin endpoint, but bypasses the `aiInstructionsAdvanced` gate (platform operator can write whatever) and bypasses denylist save-block (denylist still strips at assembly time as a final defence). Audited as `platform.ai_instructions_overridden` with `before`, `after`, and `reason`.

### `platform.listAiInstructionsAcrossPartners` (platform-operator only)

```ts
input: { search?: string, limit, cursor }
output: {
  items: Array<{
    partnerId: string,
    partnerName: string,
    instructions: PartnerAiInstructions | null,
    enabled: boolean,
    advancedAllowed: boolean,
    updatedAt: string,
  }>,
  nextCursor,
}
```

Backs the PlatformView audit panel. `search` matches against any text content in any partner's instructions (server-side full-text-ish, case-insensitive substring is fine for v1).

### `platform.contentPolicy.list` / `create` / `deactivate` (platform-operator only)

CRUD for `ai_content_policy` rows. Standard pattern; no special semantics. Deactivation is soft (sets `deactivated_at`, `active = false`).

## UI — `AdminAiStyle.tsx` (new, AdminView)

New panel in AdminView, accessible from the existing AdminView nav as "AI House Style". Visibility rules:

- Hidden if `aiEnabled === false` for the partner
- Visible-but-disabled-with-banner if `aiFeatures.aiInstructionsEnabled === false`: "House style is currently disabled by your administrator. Existing config is preserved but not applied."
- Fully editable otherwise

Form sections:

| section | input | gate |
|---|---|---|
| Tone | radio: Formal / Casual / Neutral | always available |
| Audience | radio: Technical / Layperson / Mixed | always available |
| Pronoun convention | per-language dropdowns (NL: u/je, FR: vous/tu) | always available |
| Preserve as-is | tag input (chip-style), e.g. "MyApp Pro", "OAuth" | always available |
| Language notes | per-language textareas (NL/FR/EN), 200 char counter | always available |
| Language pairs | dynamic list of `from→to` + textarea (200 char) | requires `aiInstructionsAdvanced` |
| Additional context | textarea (500 char counter) | requires `aiInstructionsAdvanced` |

Advanced fields render disabled with tooltip when not unlocked: "Free-text instructions require platform operator approval. Contact support."

**Live preview panel** at the bottom: shows the assembled preamble for a sample action (default: `improve`, English). Server-side fetch debounced 300ms after edit; falls back to client-side reconstruction if endpoint unavailable. Lets partner admin see what the AI will actually receive without making a real AI call.

**Save** button disabled while form has validation errors. Save-time denylist hits surface as inline field errors with the matched category and a link to the platform's content-policy explanation.

## UI — `PlatformAiStyleAudit.tsx` (new, PlatformView)

New panel in PlatformView, behind a "AI House Style" tab. For platform operators only. Two sub-views:

### Audit / search

Lists partners (paginated). Columns: partner name, last-updated, has free-text? (yes/no), has language-pairs? (yes/no), kill-switch state, advanced-gate state. Search box filters by content match. Click a row → drawer with full assembled config.

### Override

In the row drawer, an "Override" button opens a modal with the same form as `AdminAiStyle.tsx` (no advanced-gate restriction). Submit requires a non-empty `reason` field. Audit row written.

## UI — `PlatformContentPolicy.tsx` (new, PlatformView)

New panel in PlatformView, behind a "AI Content Policy" tab. For platform operators only. CRUD list of `ai_content_policy` rows. Columns: pattern, type (literal/regex), category, severity, active, created-by, created-at. Add / deactivate buttons. Soft-delete only — never DELETE rows.

## UI — `EditPartnerModal` (existing — extend)

Add `aiInstructionsEnabled` (default `true`) and `aiInstructionsAdvanced` (default `false`) to the `BOOLEAN_FEATURES` array with appropriate labels and descriptions referencing this spec.

## i18n

Form labels in nl/fr/en (extending existing bundle):

| key | nl | fr | en |
|---|---|---|---|
| `ai.style.tab` | "AI Huisstijl" | "Style maison IA" | "AI House Style" |
| `ai.style.tone.formal` | "Formeel" | "Formel" | "Formal" |
| `ai.style.tone.casual` | "Informeel" | "Décontracté" | "Casual" |
| `ai.style.tone.neutral` | "Neutraal" | "Neutre" | "Neutral" |
| `ai.style.audience.technical` | "Technisch" | "Technique" | "Technical" |
| `ai.style.audience.layperson` | "Leek" | "Profane" | "Layperson" |
| `ai.style.audience.mixed` | "Gemengd" | "Mixte" | "Mixed" |
| `ai.style.preserve.label` | "Bewaar deze termen onvertaald" | "Conserver ces termes tels quels" | "Preserve these terms as-is" |
| `ai.style.languageNotes.label` | "Taal-specifieke instructies" | "Instructions par langue" | "Language-specific notes" |
| `ai.style.preview.label` | "Voorbeeld preamble" | "Aperçu du préambule" | "Preamble preview" |
| `ai.style.disabled.banner` | "AI Huisstijl is uitgeschakeld door uw beheerder. Bestaande configuratie wordt bewaard maar niet toegepast." | "Le style maison IA est désactivé par votre administrateur. La configuration existante est préservée mais non appliquée." | "House style is currently disabled by your administrator. Existing config is preserved but not applied." |
| `ai.style.advanced.locked` | "Vrije-tekst-instructies vereisen toestemming van de platformbeheerder. Neem contact op met support." | "Les instructions en texte libre nécessitent l'approbation de l'opérateur de la plateforme. Contactez le support." | "Free-text instructions require platform operator approval. Contact support." |
| `ai.style.policy.violation` | "Deze tekst overtreedt het inhoudsbeleid van het platform (categorie: {category})" | "Ce texte viole la politique de contenu de la plateforme (catégorie : {category})" | "This text violates platform content policy (category: {category})" |

## Test Strategy

### Unit (`server/services/ai/instructions.test.ts`)

- Empty config → returns `null`
- Single tone directive → preamble has one line
- All fields populated → preamble has correct order, no missing pieces
- Language-pair filter: `fr→nl` configured but action is `translate` from nl→en → pair note NOT included
- Pronoun selection picks the active output language only
- Length cap: oversized config truncates, logs warning
- Multi-tenancy: partner A's instructions never leak into partner B's preamble

### Unit (`server/services/ai/runAction.test.ts`)

- `improve` action with partner instructions → system message contains preamble
- `classify` action → preamble NOT injected
- Cache: two consecutive calls within 60s only one DB read
- Cache bust: pubsub message clears cache mid-window

### Unit (`server/services/ai/contentPolicy.test.ts` — new)

- Literal pattern matches case-insensitively
- Regex pattern compiles + matches
- Inactive rows are skipped
- Cache busts on pubsub message
- `block` severity throws at save-time check; `warn` severity strips at assembly-time only

### Unit (`server/trpc/routers/partner.test.ts` — extend)

- `updateAiInstructions` rejects when `aiEnabled === false` (FAILED_PRECONDITION)
- Rejects when `aiInstructionsEnabled === false`
- Rejects `additionalContext` when `aiInstructionsAdvanced === false`
- Allows `additionalContext` when `aiInstructionsAdvanced === true`
- Denylist hit returns BAD_REQUEST with field+category
- B2B guest admin → FORBIDDEN (destructive-admin gate)

### Unit (`server/trpc/routers/platform.test.ts` — extend)

- `overrideAiInstructions` requires `reason`
- Override bypasses advanced-fields gate
- Override audit row contains before/after/reason

### E2E (Playwright)

- Partner admin opens AdminView → AI House Style panel
- Set tone=formal, save → reload → tone=formal persists
- Try to enter `additionalContext` while gate=off → field is disabled, tooltip visible
- Platform operator flips `aiInstructionsAdvanced=true` → admin reloads → field unlocks
- Try to save "ignore all previous instructions" → save blocked, inline error appears
- Live preview panel updates as fields change
- Platform operator opens PlatformView → AI House Style Audit → searches "OAuth" → matching partners listed
- Platform operator overrides one partner with reason "removing offensive tone" → audit log row visible
- Platform operator flips kill switch off → admin sees disabled banner, AI calls don't include preamble (verify via `ai_usage_log` debug or server log)
- Reset all fields to empty → save → AI calls behave identically to pre-feature

## Rollout

1. Migration: add `partners.ai_instructions` JSONB column (default `null`) + `ai_content_policy` table. Pre-seed denylist with the injection-marker patterns listed in Tier 2.
2. Extend `aiFeatures` Zod validator with `aiInstructionsEnabled` (default `true`) and `aiInstructionsAdvanced` (default `false`).
3. Ship `assembleSystemPreamble` + denylist assembly-time strip + `runAction.ts` wiring. Behavior unchanged for partners with `null` instructions.
4. Ship tRPC endpoints: `partner.updateAiInstructions` + `partner.getAiInstructions` (admin) and `platform.overrideAiInstructions` + `platform.listAiInstructionsAcrossPartners` + `platform.contentPolicy.*` (platform operator) with audit hooks.
5. Ship `EditPartnerModal` extension for the two new aiFeatures booleans.
6. Ship `AdminAiStyle.tsx` + i18n strings.
7. Ship `PlatformAiStyleAudit.tsx` + `PlatformContentPolicy.tsx`.
8. Wire metrics: `guichet_ai_instructions_assembled_total{partnerId}`, `guichet_ai_instructions_stripped_total{partnerId,category}`, `guichet_ai_instructions_overridden_total`.
9. Add Alertmanager rule `AiInstructionsHighStripRate` — strip rate > 5/min for any partner sustained 10m → suggests partner is fighting the denylist.
10. Document in `docs/USER_GUIDE.md` (admin section) with examples + `docs/AUDIT_RUNBOOK.md` (oncall section) for the strip / override audit events.
11. Pilot with the bilingual partner that prompted this — they configure their nl/fr conventions. Measure CSAT / message-thumbs-up before/after.

## Composability with Other Specs

- **Voice input** ([2026-04-19-voice-input-design.md](docs/superpowers/specs/2026-04-19-voice-input-design.md)) — when an improved-then-translated voice transcript fires, it picks up the partner's house style automatically. No additional wiring; voice transcripts ride the same `improve` and `translate` actions.
- **Language-aware routing** ([2026-04-19-language-aware-routing-design.md](docs/superpowers/specs/2026-04-19-language-aware-routing-design.md)) — when fr support replies in a nl ticket, the auto-translation runs through this preamble, applying nl pronoun convention, preserved terms, and `fr->nl` pair notes. This is the high-leverage combo: the routing spec gets fr support to grab nl tickets, this spec makes their replies sound native.

## Follow-Ups (Out of Scope for v1)

- Per-language `aiInstructions` overrides (fully separate config per output language) — overkill until structured fields prove insufficient
- A/B testing harness: partner runs two versions for a week, compares CSAT
- AI-suggested instructions ("Other partners in retail use these…")
- Import/export of instructions as JSON for templating across multiple partners
- Free-form prompt template UI exposing the existing `aiPromptTemplates` table (raw power-user mode)

## Open Questions

- [ ] Should `additionalContext` allow markdown / multi-line, or strictly single-paragraph plain text? Lean: plain text with `\n` allowed.
- [ ] Preview panel: pure client-side reconstruction or call `assembleSystemPreamble` server-side for accuracy? Spec says debounced 300ms server fetch — confirm acceptable for ops cost.
- [ ] Should we surface the assembled preamble in `ai_usage_log` for debuggability, or omit (privacy/clutter)? Lean: omit by default, opt-in via partner debug flag.
- [ ] Should partner admin be able to *see* (read-only) the active denylist patterns so they understand what's blocked, or do we treat patterns as platform-confidential? Lean: show categories only ("injection / discrimination / threat"), hide specific patterns to avoid evasion.
- [ ] When the kill switch is flipped on a partner with non-empty instructions, do we keep the config (current proposal) or wipe it? Keep — fast revert if the kill switch was pulled in error.
- [ ] Strip-rate alert threshold (5/min for 10m) — too sensitive? Calibrate after first month of data.
