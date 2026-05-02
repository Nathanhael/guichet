# AI Rollout + Voice Transcription Spec

**Date:** 2026-05-02
**Status:** Design locked, ready to plan
**Source:** `/grill-me` session

## Goals

1. **Enable existing AI features** (translate, improve, summarize) on real Azure deployment for the test partner.
2. **Add voice transcription** (Whisper STT) for support staff dictation in compose.
3. **Two-tier feature control** so platform operators set what's available and partner admins set what's active per tenant.
4. **Wire whispers into the translation flow** so multilingual support teams get auto-translated internal notes.

## Locked decisions

| # | Topic | Decision |
|---|---|---|
| 1 | Voice STT scope | Support staff only; both public and whisper compose surfaces |
| 2 | Provider architecture | Extend `AzureOpenAiProvider` with `transcribe()`; no separate STT interface |
| 3 | Capture UX | Toggle mic button (click to start/stop), 60 s hard cap, pulsing red dot + elapsed timer |
| 4 | Audio pipeline | New Express route `POST /api/v1/ai/transcribe`, multipart upload, in-memory (no disk persist) |
| 5 | Transcript insert | Append to compose contents with leading space if non-empty; no preview modal; no undo toast |
| 6 | Chat model | Azure `gpt-5-mini` deployment + rename `max_tokens` → `max_completion_tokens` in `azure-openai.ts` |
| 7 | STT model | Azure `whisper` deployment (same resource, key, base URL as chat) |
| 8 | Provider choice | Azure OpenAI (not openai.com) |
| 9 | Error handling | Inline errors for mic denied / no device / network fail; toast for empty transcript; 60 s + 5 MB hard caps both client and server; mic button disabled while in-flight; MediaStream cleanup on unmount |
| 10 | Language hint to Whisper | Pass `user.lang` from JWT context |
| 11 | Audit logging | No separate `audit_log` row for transcription; `ai_usage_log` is sufficient |
| 12 | Admin UI hierarchy | Two-tier: platform operator sets `aiFeaturesAvailable`, partner admin sets `aiFeatures` subset within that envelope. New `AdminAi.tsx` panel for partner admins. |
| 13 | Whisper translation | Remove `!message.whisper` exclusion at `Message.tsx:69` so cross-language whispers translate for colleagues |
| 14 | Auto-translate strategy | Keep mount-time auto-fire (no extra clicks) + add Redis server-side cache `translation:${messageId}:${targetLang}` with 24 h TTL |
| 15 | Auto-improve modes | Keep all three (`off` / `optional` / `forced`); `forced` mode shows diff preview before send with explicit "Send improved" / "Send original" buttons (no auto-accept timer) |
| 16 | Voice + improve interaction | **REVISED 2026-05-02 late session** — voice-originated text **goes through** auto-improve in `forced` mode. Diff preview (decision 15) is the safety net — user sees AI version vs original transcript and can choose "Send original" if AI drift is unwanted. Rationale: dictated speech is structurally messier than typed text (no punctuation, run-on sentences) and benefits MOST from improve + step-wise structuring. |
| 17 | Whisper + improve interaction | Whispers skip auto-improve in both `optional` and `forced` modes (no polishing of internal shorthand). |

## Pre-requisites (operations)

Before any code merges, the test partner needs an Azure setup:

1. Create Azure OpenAI resource in `swedencentral` or `westeurope` (Sweden Central preferred for `gpt-5-mini` + `whisper` regional availability).
2. Inside the resource → Deployments → create two deployments:
   - Model `gpt-5-mini`, deployment name `gpt-5-mini`
   - Model `whisper`, deployment name `whisper`
3. Copy `KEY 1` and the endpoint URL.
4. Set environment variables:
   ```
   AI_PROVIDER=azure
   AI_BASE_URL=<endpoint url>
   AI_API_KEY=<key 1>
   AZURE_OPENAI_DEPLOYMENT=gpt-5-mini
   AZURE_OPENAI_WHISPER_DEPLOYMENT=whisper
   AI_ENABLED=true
   ```

Cost expectations for solo testing on $200 free trial:
- `gpt-5-mini`: ~$0.25/M input, ~$2/M output
- `whisper`: ~$0.006/min audio
- Realistic month of solo testing: ~$5 burn

## Schema changes

```sql
-- New JSONB column. Mirrors aiFeatures shape but represents the platform-allowed envelope.
ALTER TABLE partners ADD COLUMN ai_features_available JSONB DEFAULT '{}'::jsonb;
```

The existing `partners.aiConfig` JSONB grows by one key — no migration needed:

```ts
partners.aiConfig = {
  baseUrl: '...',
  apiKey: '...',           // or encryptedApiKey
  deployment: 'gpt-5-mini',
  whisperDeployment: 'whisper',  // NEW
}
```

The existing `partners.aiFeatures` JSONB grows by one key — no migration:

```ts
partners.aiFeatures = {
  messageImprovement: 'off' | 'optional' | 'forced',
  chatSummarization: boolean,
  translation: boolean,
  autoSummarizeOnClose: boolean,
  queueLangAwareness: boolean,
  voiceTranscription: boolean,  // NEW
}
```

## Server changes

### `server/services/ai/azure-openai.ts`

1. Rename `max_tokens` → `max_completion_tokens` in both `chat()` body (line 48) and `chatStream()` body (line 88). Required for `gpt-5-mini`.
2. Add `transcribe(audio: Buffer, opts: { mimeType, language? }): Promise<{ text: string; durationSec: number }>` method. Hits `${baseUrl}/openai/deployments/${whisperDeployment}/audio/transcriptions?api-version=${apiVersion}` as multipart form-data with `file` and optional `language` fields. Reads `whisperDeployment` from constructor (added param).
3. Constructor signature gains `whisperDeployment?: string` (optional — allows partners to enable chat without STT).

### `server/services/ai/factory.ts`

`buildProvider('azure', opts)` reads `aiConfig.whisperDeployment` and passes it to the constructor. Cache key already hashes `aiConfig`, so adding the field auto-busts the cache when it changes.

### `server/services/ai/summaryCache.ts` → generalize to translation cache

Either extend this module or add a sibling `translationCache.ts`. New helpers:

```ts
getCachedTranslation(messageId: string, targetLang: string): Promise<string | null>
setCachedTranslation(messageId: string, targetLang: string, translation: string): Promise<void>
```

Redis key: `translation:${messageId}:${targetLang}`. TTL: 24 h.

Wire into `trpc.ai.translateMessage` mutation: check cache before model call, write to cache after.

### `server/routes/ai.ts` (NEW)

```
POST /api/v1/ai/transcribe
  - requires auth (cookie JWT, support role)
  - multer.single('audio'), 5 MB limit, mime in [audio/webm, audio/ogg, audio/mp3, audio/wav]
  - language: optional form field, ISO-639-1
  - load partner config, capability gate on aiConfig.whisperDeployment + aiFeatures.voiceTranscription
  - rate-limit: existing checkRateLimit (shared bucket)
  - provider.transcribe(buffer, { mimeType, language })
  - log to ai_usage_log: { partnerId, userId, action: 'transcribe', tokens: 0, audioSec: durationSec }
  - return { text, durationSec }
```

Mounted in `app.ts` next to `uploads` and `tickets` routes.

### `server/db/schema.ts`

Add `aiFeaturesAvailable` JSONB column to `partners` table (matches `aiFeatures` shape).

### `server/trpc/routers/partner/config.ts` (or wherever partner update lives)

When partner admin updates `aiFeatures`, server validates that every truthy key is also truthy in `aiFeaturesAvailable`. Reject otherwise with `forbidden('Feature not available for this tenant')`.

When platform operator updates `aiFeaturesAvailable`, server cascades: any `aiFeatures[k]` that is no longer available auto-flips off.

## Client changes

### `client/src/components/chat/ComposeArea.tsx`

1. Add mic toggle button next to format toolbar. Visible only when:
   - `isSupport === true`
   - `partnerAiConfig.voiceTranscription === true`
   - `navigator.mediaDevices` available
2. Click → `getUserMedia({ audio: true })` → `MediaRecorder` (`audio/webm;codecs=opus`).
3. While recording: button shows pulsing red dot (`v2p-pulse` keyframe) + elapsed time `0:23` next to it. Hard auto-stop at 60 s.
4. Click again → stop, build blob, POST multipart to `/api/v1/ai/transcribe` with `language` form field set to `user.lang`.
5. On 200: append transcript to compose with leading space if `text.length > 0 && !text.endsWith(' ')`. Set `originatedFromVoice = true` until next user keystroke or send.
6. On error: inline error line below textarea (mic denied / no device / network fail) or toast (empty transcript).
7. Cleanup: stop tracks on stop AND on unmount. Disable mic button while a previous transcription is in flight.
8. State additions:
   ```ts
   const [recording, setRecording] = useState(false)
   const [transcribing, setTranscribing] = useState(false)
   const [originatedFromVoice, setOriginatedFromVoice] = useState(false)
   const [composeError, setComposeError] = useState<string | null>(null)
   const recorderRef = useRef<MediaRecorder | null>(null)
   const streamRef = useRef<MediaStream | null>(null)
   ```

### `client/src/hooks/useComposeAiImprove.ts`

1. Accept `whisperMode` and `originatedFromVoice` from caller.
2. In `improveAndSend()`, if `whisperMode || originatedFromVoice` → skip improve, just call `doSend(trimmed)`. Mode-`forced` becomes a no-op for these cases.
3. `handleImprove()` (manual click) is unchanged — user can still opt in for whispers or voice if they want.

### `client/src/components/chat/ImproveDiffModal.tsx` (NEW, for forced-mode preview)

When `improveAndSend()` runs in `forced` mode:

1. Capture original text.
2. Call `improveMutation.mutateAsync()`.
3. Open `ImproveDiffModal` showing original (red strikethrough) + improved (green) inline diff.
4. Two buttons: `Send improved` / `Send original`. Cancel-via-Esc closes modal without sending.
5. No auto-accept timer.

Use a small word-level diff library or hand-roll line-level diff — a quick `diff` chunk per word is fine for chat-length text. `diff` (npm) is the typical choice.

### `client/src/components/chat/Message.tsx`

Line 69 — flip the whisper exclusion:

```diff
- enabled: translationEnabled && !message.system && !message.whisper,
+ enabled: translationEnabled && !message.system,
```

No other change needed; the rest of `useAutoTranslation` already handles `senderLang === viewerLang` (returns null) and the on-mount fire effect at lines 74-76 keeps working.

### `client/src/components/admin/AdminAi.tsx` (NEW)

New admin panel surfaced in `AdminView` tabs. Shows:

- **Connectivity status (read-only):** provider name, model, "AI is configured by your platform operator." (Or "Not configured — contact your platform operator.")
- **Feature toggles:** one row per `aiFeaturesAvailable[k] === true`. Disabled (greyed) for keys not in the available set. Each shows a switch bound to `aiFeatures[k]`.
- **Improvement mode picker:** when `aiFeaturesAvailable.messageImprovement === true`, a 3-way selector: Off / Optional / Forced.
- **Save button** calls `trpc.partner.config.updateAiFeatures` (new procedure or extension of existing partner update).

The panel is only visible to `admin` role (not `support`, not `agent`).

### `client/src/components/platform/EditPartnerModal.tsx`

1. Add `voiceTranscription` to `BOOLEAN_FEATURES`:
   ```ts
   { key: 'voiceTranscription', label: 'Voice Transcription', description: 'Support staff can dictate replies via microphone' }
   ```
2. Add input field for `aiConfig.whisperDeployment` next to the existing chat deployment field.
3. Split the toggle UI into two columns: "Available to partner" (writes to `aiFeaturesAvailable`) and "Active by default" (writes to `aiFeatures`). Server enforces: `aiFeatures[k] === true → aiFeaturesAvailable[k] === true`. The "Active by default" toggle for a key is disabled when the "Available" toggle is off.

## Two-tier control hierarchy summary

```
Platform operator (EditPartnerModal):
  - aiEnabled: master kill switch
  - aiProvider, aiModel, aiConfig (URL, key, deployments)
  - aiFeaturesAvailable: which features the partner CAN use
  - aiFeatures: starting/default state for the partner

Partner admin (AdminAi panel):
  - aiFeatures: which available features are ACTIVE in their tenant
  - improvementMode: off | optional | forced (when available)
  - cannot change provider, model, deployments, or available envelope
```

Server validation guarantees `aiFeatures ⊆ aiFeaturesAvailable`.

## Cost & rate limit

Existing per-partner rate limit (`ai/rateLimit.ts`): 30 calls/minute, 1000 calls/day, **shared bucket** across improve / translate / summarize / transcribe. No change.

Cost monitoring: `ai_usage_log` and `daily_ai_usage` already track per-partner per-action usage. Whisper STT logs with `action: 'transcribe'` and `audioSec` in metadata.

Hard cost ceilings (per-partner monthly $ caps) are **out of scope** for this iteration — defer until a real multi-tenant production rollout.

## Errors & edge cases

| Scenario | Handling |
|---|---|
| Mic permission denied (`NotAllowedError`) | Inline error in compose: "Microphone blocked — open browser settings to allow." |
| No mic device (`NotFoundError`) | Inline error: "No microphone detected." |
| MediaRecorder unsupported (older browser) | Hide the mic button entirely. Feature-detect on mount. |
| Recording exceeds 60 s | Auto-stop at 60 s. Upload what was captured. Show toast "Stopped at 60 s limit." |
| Blob exceeds 5 MB | Reject client-side before upload. Should never happen at 60 s of opus, but defence in depth. |
| Network failure during upload | Inline error: "Network error. Try again." Mic UI stays armed. No auto-retry. |
| Whisper returns empty string | Toast: "No speech detected — try again." |
| Whisper returns wrong-language transcript | Not an error — user edits or clicks Improve to clean up. |
| User starts new recording while previous in-flight | Mic button disabled until previous resolves. |
| Component unmounts mid-recording | Stop MediaRecorder, release MediaStream tracks, abort fetch. |
| `voiceTranscription` flag flipped off mid-session | Mic button hides on next render. In-flight upload completes normally. |

## Out of scope (deliberately deferred)

- IntersectionObserver-based lazy translate trigger (cost-optimisation; we keep mount-time auto-fire for v1).
- Cursor-position transcript insert (always append).
- Per-recording language picker UI.
- Streaming partial transcripts (Whisper supports it; not needed for 60 s clips).
- Per-tenant monthly $ cap.
- Voice transcription for AgentView users.
- Mobile / iOS Safari support (support staff use desktops).
- Per-message "do not translate" toggle.
- Auto-accept timer in `forced`-mode improve preview.
- Per-action model overrides (e.g., reasoning model for canned-response matching).

## Build sequence (suggested)

Each step is independently shippable and revertible.

1. **Slice 1 — chat model fix.** Rename `max_tokens` → `max_completion_tokens` in `azure-openai.ts`. Run existing improve / translate / summarize tests against `gpt-5-mini`. No UI work.
2. **Slice 2 — translation cache.** Add Redis cache helpers, wire into `trpc.ai.translateMessage`. Verify reload cost drops to zero on cached messages.
3. **Slice 3 — whisper translation gate.** One-line `Message.tsx` change. Manual smoke test with cross-language whisper.
4. **Slice 4 — Whisper STT backend.** Extend `AzureOpenAiProvider` with `transcribe()`, add `aiConfig.whisperDeployment` plumbing, build `/api/v1/ai/transcribe` route. No UI yet — verify with `curl` / test fixture.
5. **Slice 5 — Whisper STT frontend.** Mic button in `ComposeArea`, recording UI, append-to-compose flow. Wire `originatedFromVoice` flag.
6. **Slice 6 — improve gating.** Update `useComposeAiImprove` to skip auto-improve on whisper or voice-originated text.
7. **Slice 7 — improve diff preview.** Build `ImproveDiffModal`, wire into `forced`-mode `improveAndSend()`.
8. **Slice 8 — two-tier admin schema.** Add `aiFeaturesAvailable` column, server validation in partner config update.
9. **Slice 9 — platform UI split.** Update `EditPartnerModal` to expose available vs active toggles + `whisperDeployment` input.
10. **Slice 10 — partner admin UI.** Build `AdminAi.tsx` panel and tab in `AdminView`.

## Open questions (none — all branches resolved)

All design branches reached shared understanding during the grill-me session. Ready to plan implementation.

---

## Addendum (2026-05-02, late session)

Three additional branches resolved after the initial spec was drafted.

### Locked decisions (additions)

| # | Topic | Decision |
|---|---|---|
| 18 | Prompt-engineering scope | **REVISED** — full system (D) phased as: **v1 = fase 1 + fase 3** (term lists + per-action custom instructions). **deferred = fase 2** (industry defaults, added later when more partners onboard). Fase 3 brought forward because the "step-by-step when multiple actions" use case requires per-action instructions, not just term lists. |
| 19 | Term list shape | New JSONB column `partners.aiTerms = { preserve: string[], forbidden: string[] }`. Injected into translate / improve / summarize prompts via new template variables `{{preserve_terms}}` and `{{forbidden_terms}}`. |
| 20 | Industry defaults (fase 2) | Static lookup table keyed by `partner.industry` value. Telecom default seed: `["FTTP", "MVNO", "DSL", "VoIP", "FTTH"]`. Banking, retail seeds defined when those industries actually onboard a partner. Used as fallback when `partners.aiTerms` is empty. |
| 21 | Platform AI security guards | **A + D** for v1. (A) PII redaction toggle — server-side regex scrubbing of email, BE phone, rijksregisternummer, Luhn-validated credit cards before AI calls. Replace with tokens `[EMAIL_1]`, `[PHONE_1]`. (D) Audit verbosity toggle — `metadata-only` (default) vs `full-content` (debug). |
| 22 | Override hierarchy for security guards | Platform sets global default in new "Security" tab in PlatformView. Per-partner override possible in `EditPartnerModal` but **stricter only** — partner cannot disable PII redaction if platform has it on; cannot escalate audit to `full-content` if platform mandates `metadata-only`. |
| 23 | Custom instructions per action | New JSONB column `partners.aiCustomInstructions = { improve?: string; translate?: string; summarize?: string }`. Free-form text written by partner admin in `AdminAi.tsx`. Server prepends to standard prompt template at runtime. Empty = no prefix. Applies to forced auto-improve, manual improve, translate, and summarize. AI decides conditionally based on instruction wording (e.g., "if multiple steps, format as numbered list"). |

### Schema additions (delta on top of original spec)

```sql
ALTER TABLE partners ADD COLUMN ai_terms JSONB DEFAULT '{}'::jsonb;
ALTER TABLE partners ADD COLUMN ai_custom_instructions JSONB DEFAULT '{}'::jsonb;
ALTER TABLE partners ADD COLUMN ai_pii_redaction TEXT DEFAULT NULL; -- NULL = inherit platform default; 'on' | 'off'
ALTER TABLE partners ADD COLUMN ai_audit_verbosity TEXT DEFAULT NULL; -- NULL = inherit; 'metadata' | 'full'
```

Platform-level defaults live in `system_settings` table (existing KV store):

```ts
system_settings.ai_pii_redaction_default = 'on' | 'off'
system_settings.ai_audit_verbosity_default = 'metadata' | 'full'
```

Server enforces "stricter only" rule when partner override is written.

### Server changes (delta)

#### `server/services/ai/piiRedaction.ts` (NEW)

```ts
interface RedactionResult {
  redacted: string;
  tokens: Record<string, string>;  // { '[EMAIL_1]': 'a@b.com', ... }
}

function redactPii(text: string): RedactionResult
function unredactPii(text: string, tokens: Record<string, string>): string
```

Regex patterns:
- Email: `/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g`
- BE phone: `/\b(?:\+32|0)\s?\d{2,3}\s?\d{2}\s?\d{2}\s?\d{2}\b/g`
- Rijksregisternummer: `/\b\d{2}\.?\d{2}\.?\d{2}-?\d{3}\.?\d{2}\b/g`
- Credit card: 13-19 digits with Luhn validation (helper function)

Used in `runAction.ts` before sending text to provider. Tokens preserved in a per-call map. For `improve` action, the response is unredacted before returning to client. For `translate`, tokens stay literal in output (LLMs reliably preserve `[EMAIL_1]`-style placeholders during translation).

#### `server/services/ai/runAction.ts`

1. Resolve effective PII setting: partner override or platform default.
2. If on: `const { redacted, tokens } = redactPii(input.text)`. Send `redacted` to provider.
3. After response: if action is `improve`, unredact response with `tokens`. If action is `translate`, response should already preserve tokens — log warning if any token went missing.
4. Resolve audit verbosity: partner override or platform default.
5. Write `ai_usage_log` row with full content only when `audit_verbosity === 'full'`. Otherwise log only metadata.

#### `server/services/ai/prompts.ts`

Add new template variables `{{preserve_terms}}` and `{{forbidden_terms}}`. Update default templates for `translate` and `improve`:

```
translate: |
  Translate the following text to {{targetLang}}.
  Preserve these terms exactly as-is, do not translate them:
  {{preserve_terms}}
  Do not use these forbidden words in your output:
  {{forbidden_terms}}
  Reply with ONLY the translation.
  Text: <user_content>{{text}}</user_content>
```

If a partner has empty `aiTerms`, fall back to industry defaults (fase 2). If still empty, omit the lines entirely (template renders cleanly).

#### `server/services/ai/industryDefaults.ts` (fase 2)

```ts
export const INDUSTRY_TERM_DEFAULTS: Record<string, { preserve: string[]; forbidden: string[] }> = {
  telecom: { preserve: ['FTTP', 'FTTH', 'MVNO', 'DSL', 'VoIP'], forbidden: [] },
  banking: { preserve: ['IBAN', 'BIC', 'SEPA'], forbidden: ['guarantee', 'risk-free'] },
  retail:  { preserve: [], forbidden: [] },
  general: { preserve: [], forbidden: [] },
};
```

Lookup: `INDUSTRY_TERM_DEFAULTS[partner.industry] ?? INDUSTRY_TERM_DEFAULTS.general`.

### Client changes (delta)

#### `client/src/components/admin/AdminAi.tsx`

Add a "Terminology" section to the panel:

```
[Terms]
  Preserve (don't translate / don't change in improve):
    [chip input]   FTTP × | MVNO × | DSL × | + add term
  
  Forbidden (AI must not produce these in output):
    [chip input]   promo × | discount × | + add term
  
  Inherits from industry default (telecom): FTTH, VoIP
  → [override defaults]  // expands editor; otherwise hidden defaults
```

Saves to `partners.aiTerms` via `trpc.partner.config.updateAiTerms`.

#### `client/src/components/platform/PlatformSecurity.tsx` (NEW)

New tab in PlatformView. Two toggles initially:

```
[AI Privacy]
  PII Redaction (default for all partners):
    ( ) On — strip emails / phones / IDs before AI calls
    ( ) Off
  
  Audit Verbosity (default for all partners):
    ( ) Metadata only — log tokens, cost, action
    ( ) Full content — also log full prompts and responses
  
  Per-partner overrides are configured in Edit Partner.
```

Saves to `system_settings`.

#### `client/src/components/platform/EditPartnerModal.tsx`

In the AI section, add an "AI Privacy Override" subsection:

```
[AI Privacy Override]
  PII Redaction:
    ( ) Inherit platform default (currently: On)
    ( ) Force On (cannot weaken platform setting)
    ( ) Force Off  (← greyed out if platform default = On)
  
  Audit Verbosity:
    ( ) Inherit platform default (currently: Metadata only)
    ( ) Force Metadata only
    ( ) Force Full content  (← greyed out if platform default = Metadata only)
```

The "stricter only" rule means: if platform default is `On / Metadata`, partner cannot pick `Off / Full`.

### Build sequence (updated)

Insert these between the original slices:

| slice | what |
|---|---|
| 1.5 | PII redaction module (`piiRedaction.ts` + tests) |
| 2.5 | Audit verbosity wiring in `runAction.ts` + `usage.ts` |
| 8.5 | `aiTerms` column + server template injection |
| 8.6 | Industry defaults lookup (fase 2) |
| 10.5 | Terminology editor in `AdminAi.tsx` |
| 10.6 | `PlatformSecurity.tsx` tab + `EditPartnerModal` privacy override section |

Fase 3 was originally deferred but is now **brought into v1** (see decision 23). Build sequence updated:

| slice | what |
|---|---|
| 8.5 | `aiTerms` column + server template injection |
| 8.7 | `aiCustomInstructions` column + per-action prefix injection in `prompts.ts:interpolate()` |
| 10.5 | Terminology editor + custom-instruction textareas (3 actions) in `AdminAi.tsx` |
| 10.6 | `PlatformSecurity.tsx` tab + `EditPartnerModal` privacy override section |

Fase 2 (industry defaults) remains deferred — added when more partners onboard and the curated lists are worth maintaining.

---

## Addendum 2 (2026-05-02, post-monitoring discussion)

### Decision 24 — Operational deployment pattern: B (per-tenant deployment)

For multi-BU / multi-partner usage tracking in Azure:

| pattern | description | when |
|---|---|---|
| A — shared | One Azure resource, one deployment per model, all partners share it. Per-tenant tracking only via Guichet's `ai_usage_log`. | Trial / single-BU testing |
| **B — per-tenant deployment** | One Azure resource, separate deployments per partner (e.g., `gpt-5-mini-marketing`, `whisper-marketing`). Tag deployments with `business_unit=<name>`. Azure Cost Management filters by tag → per-BU spend. | **Recommended for production multi-BU rollout** |
| C — per-tenant resource | Separate Azure resource per partner. Full isolation: own API key, own quota pool, own billing line. | Reserved for partners with strict compliance / data-residency / quota-isolation needs |

**No Guichet code changes required for B or C.** The existing `partners.aiConfig` JSONB already supports per-partner `baseUrl`, `apiKey`, `deployment`, and `whisperDeployment`. Setup is purely operational:

1. Azure: create deployment per BU with descriptive name + `business_unit` tag.
2. Guichet: per partner, set `aiConfig.deployment` + `aiConfig.whisperDeployment` to the BU's deployment names via `EditPartnerModal`.
3. Azure Cost Management: bookmark a dashboard grouped by `business_unit` tag.

### Decision 25 — In-Guichet usage UI: deferred

The earlier-proposed mini usage pill in `AdminAi.tsx` (today's calls + cost + 7-day sparkline) is **deferred**. Rationale:

- Azure OpenAI Studio + Cost Management already provides per-deployment / per-BU visibility (under deployment pattern B).
- Per-partner attribution via `ai_usage_log` remains in place server-side for future analytics needs.
- Building an in-app usage panel duplicates Azure's tooling without adding value during the trial / early-production phase.
- Reintroduce when a partner admin specifically asks to see their tenant's usage in-app, or when chargeback reporting requires it.

The `ai_usage_log` and `daily_ai_usage` tables continue to be populated by the existing `usage.ts` service — data is available the moment a UI is needed.

### Decision 26 — Cost guard for trial: Azure Cost Management budget

Before any AI deployment goes live in the trial:

1. Azure portal → Cost Management → Budgets → create budget on the Azure OpenAI resource.
2. Budget amount: $200 (full trial credit).
3. Alert thresholds: 50% / 75% / 90% / 100% — emails to platform operator.
4. Optional: action group to auto-disable the resource at 100% (only if you accept potential service interruption).

This is the primary safety net during the trial. In-Guichet rate limits (`ai/rateLimit.ts`, 30/min + 1000/day) are the secondary safety net.

---

## Addendum 3 (2026-05-02, gap-closure session)

After the primary spec was complete, a stress-test pass identified gaps versus what mature multi-tenant chat-AI systems (Intercom, Zendesk, Front) provide and what EU AI Act / GDPR compliance requires. Nine items reviewed, eight new decisions locked.

### Locked decisions (additions)

| # | Topic | Decision |
|---|---|---|
| 27 | AI disclosure badge (EU AI Act art. 50) | Show ✨ sparkle icon + hover tooltip on bubbles where AI processed the content. Applies to **improve** ("Verbeterd door AI") and **translate** ("Vertaald uit {lang}"). Skip for transcribe (speech-to-text is input method, not generated content) and summarize (internal-only, no external recipient). Visible to **all viewers** (sender + recipient). New column `messages.improved_at TIMESTAMP NULL` for improve tracking; translation badge derives from existing `senderLang !== viewerLang` render-side logic. |
| 28 | Summarize feature scope | **Removed from v1.** Feature stays in code (`trpc.ai.summarizeChat`, prompts.ts default) but not enabled in `aiFeaturesAvailable` for the test partner. AdminAi panel does not show summarize toggle, custom-instruction textarea, or feedback button. Auto-summarize-on-close also off for v1. Re-evaluate post-launch when partner admins request it. |
| 29 | Thumbs up/down feedback | New `ai_feedback` table with `{ id, partnerId, userId, action, usageLogId, rating ('up'|'down'), originalText?, aiOutput?, userFinalChoice?, comment?, createdAt }`. Feedback buttons only on **improve diff modal** (translate skipped — weak signal). `originalText` and `aiOutput` only persisted when `audit_verbosity === 'full'` per decision 21. Dashboards deferred — collect data first. |
| 30 | Send-original implicit feedback | Logged separately from explicit thumbs feedback. Stored as `ai_usage_log.metadata.sentOriginal: boolean` on the existing improve usage row (no new table). New tRPC mutation `ai.markImproveResult({ usageLogId, sentOriginal })` called from diff modal after user choice. Implicit rejection rate and explicit thumbs rate are tracked as **separate metrics** for signal purity. |
| 31 | Provider failover + degradation | (a) Server-side `isAvailable()` cache (already exists in `AzureOpenAiProvider`, 60 s TTL) + new tRPC `ai.healthCheck` query. (b) Client disables AI buttons when health check returns false; tooltip "AI tijdelijk niet beschikbaar". (c) On call failure (race-condition past health check), show toast with retry button. (d) Forced-improve mid-flow failure → fallback to original text + toast "AI verbetering mislukt, origineel verzonden". (e) Rate-limit hit → button disabled + countdown toast using existing `retryAfterSeconds`. **No automatic provider failover to alternate provider** — out of scope for trial. |
| 32 | Loading states | (a) Improve manual: spinner-in-button + button disabled. (b) Improve forced: small overlay "AI bewerkt bericht..." until diff modal opens. (c) Translate auto: "Vertalen..." inline label on bubble. (d) Transcribe: "Transcriberen..." status replaces recording UI. (e) Slow-response timer at 3s adds "Duurt langer dan verwacht..." subtext. Reuse existing primitives (`<Button loading>`, `<Spinner />`, `<Toast>`); build them if missing. |
| 33 | i18n coverage | All ~25 new AI-related UI strings translated to NL + FR + EN from v1 (no English fallback). Strings live in existing `client/src/locales/{en,fr,nl}.ts` files. Match the existing namespace style (flat or nested) at implementation time. Categories: errors (7), loading (4), buttons (4), badges (2), feedback (2), AdminAi labels (3), PlatformSecurity labels (3). |
| 34 | Dark mode + a11y mandate | All new components (mic button, `ImproveDiffModal`, `AdminAi` panel, `PlatformSecurity` tab, AI badge, loading spinners) MUST: (a) use design tokens, no hex literals — verified in both `.dark` and default; (b) keyboard-accessible (Tab, Enter, Esc); (c) ARIA labels on icon-only buttons; (d) focus trap in modals; (e) `aria-live="polite"` regions for loading status; (f) screen reader announces state changes ("Recording started", "AI version available"). Smoke-tested in both themes + with keyboard-only nav before slice merge. |
| 35 | Audit log events for AI config | Ten new action types in `audit_log`: `partner.ai.toggle`, `partner.ai.config_update`, `partner.ai.envelope_update`, `partner.ai.features_update`, `partner.ai.terms_update`, `partner.ai.instructions_update`, `partner.ai.pii_override`, `partner.ai.audit_override`, `platform.security.pii_redaction`, `platform.security.audit_verbosity`. Metadata uses **before/after diff** pattern matching existing audit drawer. **API keys** logged as masked prefix only (`'ENCRYPTED:****abc'` → `'ENCRYPTED:****xyz'`), never raw. Platform-prefix actions visible only in `PlatformAuditLog`; partner-prefix actions visible in both platform and partner audit views (filterable). |

### Schema additions (delta on top of Addendum 1 + 2)

```sql
-- Decision 27 — improve tracking
ALTER TABLE messages ADD COLUMN improved_at TIMESTAMP NULL;

-- Decision 29 — explicit AI feedback
CREATE TABLE ai_feedback (
  id              text PRIMARY KEY,
  partner_id      text NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  user_id         text NOT NULL,
  action          text NOT NULL,                   -- 'improve' | 'translate' | future
  usage_log_id    text REFERENCES ai_usage_log(id),
  rating          text NOT NULL,                   -- 'up' | 'down'
  original_text   text NULL,                       -- only when audit_verbosity = 'full'
  ai_output       text NULL,                       -- only when audit_verbosity = 'full'
  user_final_choice text NULL,                     -- 'sent_improved' | 'sent_original'
  comment         text NULL,
  created_at      timestamp NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_ai_feedback_partner_created ON ai_feedback (partner_id, created_at);
CREATE INDEX idx_ai_feedback_action_rating ON ai_feedback (action, rating);

-- Decision 30 — implicit feedback (no schema change; uses existing ai_usage_log.metadata JSONB)
```

No schema change for decisions 31, 32, 33, 34, 35 — implementation-only.

### Server changes (delta)

#### `server/services/ai/runAction.ts`
- After improve mutation, return `{ improved, usageLogId }` so client can later mark result.
- Honor `audit_verbosity` setting when persisting `original_text` / `ai_output` fields in `ai_feedback`.

#### `server/trpc/routers/ai.ts`
- New `ai.healthCheck` query — returns `{ available: boolean, lastChecked: timestamp }`. Reuses provider's `isAvailable()` cache.
- New `ai.markImproveResult` mutation — `{ usageLogId: string, sentOriginal: boolean }`. Updates `ai_usage_log.metadata`.
- New `ai.submitFeedback` mutation — `{ usageLogId, rating, comment? }`. Writes `ai_feedback` row. Persists text bodies only when audit_verbosity = 'full'.

#### `server/services/auditEmitter.ts` (or wherever audit emit lives)
- Add ten new action types to allowed-actions list.
- Helper `auditAiConfigChange(actor, partnerId, action, before, after)` for diff-style metadata.

#### `server/services/ai/azure-openai.ts` (already noted in original spec)
- `max_tokens` → `max_completion_tokens` rename.
- `transcribe()` method.

### Client changes (delta)

#### `client/src/components/chat/Message.tsx`
- Render ✨ badge (small icon next to timestamp) when `message.improvedAt` is set OR translation is active for this viewer.
- Tooltip on hover: action-specific i18n string from new locale keys.

#### `client/src/components/chat/ImproveDiffModal.tsx` (extending decision 15)
- Add 👍 / 👎 buttons in modal footer.
- Capture `usageLogId` from improve mutation result, pass to thumbs button click handler.
- After "Send improved" or "Send original" click, call `ai.markImproveResult` with `{ usageLogId, sentOriginal: bool }`.

#### `client/src/hooks/useAiHealth.ts` (NEW)
- Polls `ai.healthCheck` every 5 minutes (or on tab focus).
- Returns `{ available, lastChecked }` for components to consume.
- Wrap mic button, improve button, summarize button (if ever re-enabled) with the health gate.

#### `client/src/components/chat/ComposeArea.tsx`
- Mic button: `aria-label`, `aria-pressed`, screen-reader announce on state change.
- Improve button: spinner state, disabled when call in flight.
- Wire health gate from `useAiHealth`.
- Hook up loading states and slow-response timer.

#### `client/src/locales/{en,fr,nl}.ts`
- ~25 new keys per language, organized to match existing structure.
- FR translations drafted by assistant during build, partner admin reviews.

### Build sequence (final updates)

| slice | what |
|---|---|
| 0 | Operational — Azure resource + deployments + Cost Management budget alert (no code) |
| 1 | `max_tokens` → `max_completion_tokens` rename |
| 1.5 | PII redaction module |
| 2 | Translation Redis cache |
| 2.5 | Audit verbosity wiring |
| 3 | Whisper translation gate flip + i18n keys for new strings |
| 4 | Whisper STT backend (`AzureOpenAiProvider.transcribe()` + `/api/v1/ai/transcribe` route) |
| 5 | Whisper STT frontend (mic button + recording UI + loading states + a11y) |
| 6 | `messages.improved_at` column + AI badge rendering |
| 7 | Improve diff modal + thumbs feedback buttons + send-original logging |
| 8 | Health check (server + client hook + button gating) + error UX (toasts, cooldowns) |
| 8.5 | `aiTerms` + `aiCustomInstructions` columns + prompt template injection |
| 9 | Two-tier admin schema (`aiFeaturesAvailable` + server validation) |
| 9.5 | Audit log events for AI config changes |
| 10 | `EditPartnerModal` updates (whisperDeployment, voice toggle, two-tier UI, security overrides) |
| 10.5 | `AdminAi.tsx` panel (toggles + terms + custom instructions + feedback section) |
| 10.6 | `PlatformSecurity.tsx` tab |
| 11 | i18n FR translations review pass |
| 12 | Dark mode + a11y smoke pass on all new components |

Each slice independently shippable. Slices 1, 2, 3 alone deliver the existing AI features on Azure with cache + cross-language whispers — meaningful even before voice STT lands.

### Compliance summary

| requirement | how this spec satisfies it |
|---|---|
| EU AI Act art. 50 (transparency) | Decision 27 — AI disclosure badge on AI-touched messages |
| GDPR — minimization | Decision 11, 21, 25 — no separate audit_log for transcription, metadata-only logging by default, deferred in-app usage UI |
| GDPR — accuracy | Decisions 15, 16, 30 — diff preview + send-original tracking + thumbs feedback for AI quality monitoring |
| GDPR — purpose limitation | Decision 21 PII redaction strips identifiers before AI processing |
| Internal audit trail | Decision 35 — config changes audited with diff metadata |

### Out of scope (final)

Items deliberately deferred from v1:

- Industry term defaults (fase 2 of decision 18)
- System-prompt prefix per partner (fase 3 superseded by decision 23 custom instructions per action)
- Per-partner monthly $ cap
- Voice in AgentView
- Mobile / iOS Safari
- Streaming partial transcripts
- Cursor-position transcript insert
- Auto-accept timer in diff preview
- Per-action model overrides
- Automatic provider failover
- Auto-summary on transfer
- Sentiment / tone detection
- RAG with KB articles
- Reply suggestions
- Auto-categorization
- Custom fine-tuned models
- Speaker diarization
- Hard cost ceiling enforcement
- In-Guichet usage UI panel (deferred — Azure handles it)
- A/B testing framework
- Chain-of-thought / reasoning model usage
- Hallucination detection
- AI confidence scoring
- Random sample QA review queue
- Right-to-opt-out per user
- DPIA documentation
- Macro-style AI workflows
- Prompt library sharing
- Translation memory beyond message-level cache

These are noted so future sessions can grab them without re-deciding scope.
