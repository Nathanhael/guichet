# Voice Input — Design Spec

**Date:** 2026-04-19
**Scope:** Let agents/support/admins record a voice message in the chat composer; server transcribes via Azure OpenAI Whisper and drops the text into the compose box for review before send.
**Status:** Draft — awaiting approval before implementation.

## Problem

Typing is the only way to compose a message. Long multilingual responses (nl/fr/en) are slow to type, especially on mobile / tablet. Voice → text would speed up support staff without changing the on-the-wire chat shape (still a text message at the end).

## Non-Goals

- Voice **playback** in chat (recipients never hear audio — transcript only).
- Real-time live captions / streaming transcription. v1 is record → upload → transcript.
- Auto-send. Transcript always lands in the compose box for human review.
- Persisting audio. Audio is discarded after transcription. No `audio_messages` table.
- Voice for the external Agent (customer) view in v1 — internal staff only (support / admin / platform_operator).

## Solution

Mic button in `ComposeArea`. Click → record (MediaRecorder API, webm/opus). Stop → POST to new REST endpoint `/api/v1/ai/transcribe`. Server validates size + duration, calls Whisper via the AI provider, returns `{ text, language }`. Client appends transcript to the existing compose draft. Audio buffer is never written to disk.

## Scope Decisions (from brainstorming pass)

| decision | choice | rationale |
|---|---|---|
| audio capture | browser MediaRecorder (webm/opus) | native, no extra deps, broad browser support |
| transcription | server-side Azure OpenAI Whisper | reuses existing `azure-openai.ts` provider + tenant; nl/fr accuracy beats Web Speech API |
| transport | multipart POST (REST), not tRPC | tRPC is JSON-only; whisper API expects multipart anyway |
| storage | none — discard after transcription | sidesteps GDPR retention questions; matches "transcript only" UX |
| audience | internal staff only (v1) | external agents on shared/public devices = privacy + abuse risk; ship internal first, evaluate later |
| gating | per-partner `aiFeatures.voiceInput: boolean` | matches existing AI feature flag pattern |
| max duration | 1 minute (60s) | one chat reply's worth of dictation; longer = type it or split into messages |
| auto-send | never | hallucinations + accents need a human review step |

## Provider Abstraction

### `server/services/ai/types.ts` — extend

```ts
export interface TranscribeParams {
  audio: Buffer;             // raw audio bytes
  mimeType: string;          // e.g. 'audio/webm'
  filename: string;          // for whisper API form-data part
  language?: 'nl' | 'fr' | 'en'; // hint, optional — whisper auto-detects
}

export interface TranscribeResult {
  text: string;
  language: string;          // detected language code
  durationSeconds: number;
  model: string;
}

export interface AiProvider {
  readonly name: string;
  chat(params: ChatParams): Promise<ChatResult>;
  chatStream(params: ChatParams): AsyncIterable<string>;
  transcribe?(params: TranscribeParams): Promise<TranscribeResult>; // optional capability
  isAvailable(): Promise<boolean>;
}

export type AiAction =
  | 'classify' | 'suggest' | 'summarize' | 'improve'
  | 'translate' | 'match_canned'
  | 'transcribe'; // new
```

`transcribe` is **optional** on the interface. Ollama and openai-compatible providers don't implement it → factory throws `NOT_IMPLEMENTED` if a partner has voiceInput on but the configured provider lacks the method. Surface in admin UI as a disabled toggle with tooltip "Provider does not support transcription".

### `PartnerAiConfig` — extend

```ts
export interface PartnerAiConfig {
  // ...existing
  voiceInput?: boolean; // default false; platform operator toggles in EditPartnerModal
}
```

### `server/services/ai/azure-openai.ts` — implement `transcribe()`

- Endpoint: `${AZURE_OPENAI_ENDPOINT}/openai/deployments/${WHISPER_DEPLOYMENT}/audio/transcriptions?api-version=${AZURE_OPENAI_API_VERSION}`
- Method: POST, `multipart/form-data`
- Form fields: `file` (audio buffer), `model` (deployment name), optional `language`, `response_format=verbose_json` (so we get `language` + `duration` back)
- Auth: same `api-key` header as chat
- New env: `AZURE_OPENAI_WHISPER_DEPLOYMENT` — separate from chat deployment
- Provider's `isAvailable()` does not need changes; transcribe-specific availability is checked at request time

### Other providers

- `ollama.ts` — do not implement (Ollama doesn't ship Whisper today; faster-whisper as a sidecar is a v2 conversation)
- `openai-compatible.ts` — do not implement in v1 (most OpenAI-compatible servers don't expose `/audio/transcriptions`; revisit per-partner if requested)

## Composability with Existing AI Features

Voice transcripts are just text in the compose box once they arrive. They ride the existing AI pipeline naturally — but the interaction needs to be explicit so we don't accidentally double-bill or surprise users.

### Message improvement

- Transcript lands in compose → existing `messageImprovement` behavior applies, no new code needed
- Modes:
  - `off` → user sees raw transcript, sends as-is
  - `optional` → sparkle button appears (already does); one tap improves transcript before send
  - `forced` → existing auto-improve-on-send fires after the user hits Send
- **Two AI calls back-to-back** (transcribe + improve) is real but acceptable: each ≤ $0.006, total ≤ $0.012 worst case
- **Do not** offer a combined "transcribe + improve" server-side button in v1. Adds coupling, kills the "review the raw transcript before improving" workflow that catches Whisper hallucinations
- Improve button must be enabled even if `text.length < 10` doesn't normally trigger it, **when the text came from a transcript** — the user explicitly asked for AI help by recording. (Tracked via a transient `cameFromTranscript` flag on the compose state, cleared on send/clear.)

### Translation (per-viewer auto-translation)

- Existing `translation` config auto-translates messages based on `senderLang vs viewerLang` after send. Voice transcripts ride this unchanged
- Whisper auto-detects language; we capture it in `TranscribeResult.language` so the message inherits a correct `lang` field at insert time. Without this, a French dictation could be mis-tagged as the agent's `users.lang` and translation would silently break
- Concretely: the `message:send` socket handler should accept an optional `lang` override, defaulting to `users.lang`, set to `transcribeResult.language` when the compose payload originated from voice
- **Do not** use Whisper's `/audio/translations` endpoint (translates → English only). We always want native-language transcription so per-viewer translation handles the rest

### Background: how `users.lang` actually flows

Worth flagging because it's a common misconception: the in-app language switcher (`LanguageSwitcher.tsx`) is **not GUI-only**. It writes to `users.lang` and sets `lang_locked` so subsequent SSO refreshes don't overwrite it. That one field drives:

- GUI string rendering (i18n bundle)
- Outbound message tagging (`messages.sender_lang`)
- Per-viewer translation routing (`senderLang !== viewerLang` triggers translate)

So a "fr" badge on a user means both their UI is fr **and** their messages are tagged fr by default. The Whisper-detected-language override matters precisely because a user's `users.lang` is not a reliable indicator of what they actually said into the mic on a given recording.

### Worked examples (cross-language voice + improve + translate)

All examples assume `aiFeatures = { voiceInput: true, messageImprovement: 'optional', translation: true }` and an existing chat between a support user and an agent user.

| # | support.lang | agent.lang | spoken lang | Whisper detects | improve runs in | stored `senderLang` | agent sees | AI calls billed |
|---|---|---|---|---|---|---|---|---|
| A1 | fr | nl | fr | fr | fr | fr | nl (translated at render) | transcribe + improve + translate-on-render |
| A2 | fr | nl | nl | nl | nl | nl | nl (no translation) | transcribe + improve |
| B1 | fr | fr | fr | fr | fr | fr | fr (no translation) | transcribe + improve |
| B2 | fr | fr | nl | nl | nl | nl | fr (translated at render) | transcribe + improve + translate-on-render |
| C  | fr | nl | mixed (code-switch) | most-prevalent | most-prevalent | detected | translated if needed | transcribe + improve + (maybe) translate |

**Read the table this way:** the improvement step is always "polish in source language" — it never decides target language. Translation is always "render-time, per-viewer, based on stored `senderLang` vs viewer's `users.lang`." Therefore: same-language sides → translation is a free no-op. Different-language sides → existing typed-message translation pipeline kicks in unchanged. **There is no voice-specific translation logic** — the only voice-specific change is correctly stamping `senderLang` from Whisper detection instead of trusting `users.lang`.

**Edge case (mixed/code-switching speech):** Whisper picks one dominant language. If a user routinely code-switches, the auto-translation will translate the *other* language fragments too, which may produce odd results. Document as a known limitation, not a v1 fix.

**Cost ceiling per voice message** (worst case, A1/B2 with translate-on-first-render):
- transcribe: ≤ $0.006
- improve (chat completion, ~200 tokens): ~$0.001
- translate-on-render (chat completion, ~200 tokens, cached after first viewer): ~$0.001
- **total: ≤ $0.008 per message**, regardless of how many viewers (translation is cached server-side per `(messageId, targetLang)` — verify this is already the case for typed messages)

### Auto-summarize on close

No interaction. Voice-originated messages are indistinguishable from typed ones in the message log; the auto-summarize prompt sees normal text.

### Canned responses

No interaction. Canned-response picker is independent. If a user picks a canned response and then dictates an addition, the existing append-to-draft behavior applies.

### Combined cost cap

A user could dictate 60s + improve + send → ≤ $0.012 in AI spend per message. Existing per-partner per-day rate limit (`rateLimits.perDay`) covers both transcribe and improve actions in one bucket — no new cap needed, but the Grafana cost panel should split spend by `action` for visibility.

## REST Endpoint — `POST /api/v1/ai/transcribe`

Why REST and not tRPC: tRPC superjson can't carry binary efficiently; Whisper itself wants multipart.

**Request:**
- `multipart/form-data`
- field `audio`: blob, ≤ 3 MB (1 min @ 128 kbps opus ≈ 960 KB; 3 MB headroom for higher-bitrate formats), mime type in allowlist (`audio/webm`, `audio/ogg`, `audio/mp4`, `audio/mpeg`, `audio/wav`)
- field `language` (optional): `nl` | `fr` | `en`
- Auth: existing JWT cookie middleware
- Partner scope: derived from JWT context (active partner)

**Validation pipeline:**
1. Auth middleware → user must be authenticated
2. Role gate: `support | admin | platform_operator` only (not `agent`)
3. Partner check: `aiFeatures.voiceInput === true` for the active partner → else 403
4. Rate limit: reuse `ai/rateLimit.ts` per-partner (transcription counts against the same per-minute / per-day caps)
5. File: size ≤ 3 MB, duration ≤ 60s (rejected post-transcription if Whisper reports > 60s — usage row is still written so abuse shows up in metrics)
6. Mime type in allowlist

**Response:**
```ts
{ text: string, language: string, durationSeconds: number }
```

**Errors:**
- 401 unauth
- 403 wrong role / partner doesn't have voiceInput
- 413 file too large
- 415 unsupported mime
- 429 rate-limited
- 502 provider error (Whisper down / quota exceeded)
- 501 if active provider has no `transcribe` method

**Logging:** every call writes to `ai_usage_log` with `action='transcribe'`, `inputTokens=0`, `outputTokens=0`, plus a new `audio_seconds` column (nullable, only set for transcribe rows). Cost rollup uses `audio_seconds * $0.006/60`.

### Schema change: `ai_usage_log.audio_seconds`

Nullable `integer`. Only populated for `action='transcribe'` rows. `daily_ai_usage` rollup gets a parallel `total_audio_seconds` column.

## UI

### `ComposeArea` (existing — modify)

Add mic button next to the AI improve button. States:
- **idle** — mic icon, click to start recording (only renders if `aiFeatures.voiceInput` and user role ≠ agent)
- **recording** — square stop icon + elapsed counter (`0:12 / 1:00`) + small pulsing dot (no decorative motion — single 150ms fade for the dot, not a bouncy pulse; respect `prefers-reduced-motion`). At 0:50 the counter turns amber; at 1:00 recording auto-stops and uploads.
- **transcribing** — spinner + "Transcribing…"
- **error** — toast via existing `Toast` component, mic returns to idle

Keyboard: `Ctrl/Cmd + Shift + V` toggles record. Esc cancels active recording without uploading.

Transcript is **appended** to the existing draft (not replacing), separated by a space. Cursor moves to end. User can edit before pressing Send.

### Draft preservation guarantees

The compose-area draft is sacred. None of these branches may touch existing draft text:

- User cancels recording (Esc, click stop-while-empty, navigate away, page hide)
- Upload fails (network error, 5xx, timeout)
- Whisper returns empty string or whitespace-only
- Whisper returns text below a confidence/length floor (see Hallucination protection below)

Append happens **only** on successful, non-empty, non-suspect transcripts. On the failure paths above, show a toast and leave the draft exactly as it was.

### Empty-transcript handling

Whisper sometimes returns `""` for noise-only audio. Treat empty/whitespace responses as a soft error: toast "No speech detected — try again", do not append, do not bill the user against the rate limit (we already paid Azure though — the cost just shows up in the metric for tuning).

### Permissions

First mic click triggers `navigator.mediaDevices.getUserMedia({ audio: true })`. If denied → toast "Microphone access denied. Enable in browser settings." and hide the mic for the session. Re-checks on next page load (we don't persist the denial).

### `EditPartnerModal` (existing — extend)

(Verified: AI feature toggles live here, not in an `AdminAiSettings` panel — `BOOLEAN_FEATURES` array drives the UI.) Add `voiceInput` to the `BOOLEAN_FEATURES` array with label "Voice input" and a description explaining the Whisper dependency. Disabled (with tooltip "Provider does not support transcription") when the partner's configured AI provider lacks the optional `transcribe` method. Saves into `partners.aiFeatures.voiceInput`.

## Browser Compatibility & Permissions

### Secure-context requirement

`navigator.mediaDevices.getUserMedia` only works in a secure context (https or `localhost`). Mic button must check `window.isSecureContext` on mount; if false, render disabled with tooltip "Voice input requires a secure connection (HTTPS)". Prod is https; dev on localhost is fine.

### Permissions-Policy header

Verify current helmet config does not block `microphone`. Add to the `Permissions-Policy` response header:

```
Permissions-Policy: microphone=(self), camera=(), geolocation=()
```

Without this, some browsers will silently reject `getUserMedia` even on https. Audit existing helmet middleware (`server/utils/security.ts` or wherever helmet is wired) before shipping.

### Browser support matrix

| browser | MediaRecorder w/ webm/opus | notes |
|---|---|---|
| Chrome / Edge | yes | preferred mime: `audio/webm;codecs=opus` |
| Firefox | yes | same |
| Safari 14.1+ | yes | needs `audio/mp4` fallback (no webm/opus support) — feature-detect via `MediaRecorder.isTypeSupported` |
| Safari < 14.1 | no | mic button hidden |

Mime detection on the client picks the best supported type and tells the server via the multipart `audio` field's content-type header. The mime allowlist already covers the common formats.

### Mobile / touch UX

Tablets are a real support device. v1 stays with **tap-to-toggle** (tap-to-start, tap-to-stop) — same UX as desktop, lower learning cost, no thumb fatigue, easier to hand off to a colleague mid-recording. Hold-to-talk (WhatsApp-style) is more familiar for casual voice notes but is a worse fit for 60-second dictations. Revisit in v2 if support staff request it.

## Hallucination & Silence Protection

Whisper's known failure mode: when fed silence or pure noise it confidently invents text — most famously "Thank you for watching!" or "[music]" or repeated phrases. Three-layer defence:

1. **Client-side amplitude check** (before upload): sample the audio buffer; if RMS amplitude is below a threshold (e.g. -50 dBFS) for >90% of the recording → don't upload, toast "No audio detected".
2. **Client-side minimum duration**: if recording is < 1.0s, don't upload. Mostly catches accidental double-clicks.
3. **Server-side suspicion filter**: after Whisper returns, check the text against a small denylist of known hallucination phrases (`['Thank you for watching!', 'Bedankt voor het kijken!', 'Merci d'avoir regardé !', '[Music]', '[Musique]', '[Muziek]', 'Sous-titres ...']`). If matched **and** the audio was short (< 3s) **or** the detected language is suspicious — return the empty-transcript soft error instead of the hallucination. Keep the denylist in `server/services/ai/transcribeFilters.ts` so it's editable without redeploys via config.

Document the trade-off: false-negatives (rejecting a real "Bedankt!") are acceptable; users see "No speech detected" and re-record. False-positives (inserting a Whisper hallucination into a customer chat) are not acceptable.

## Internationalization (i18n)

UI strings (extend the existing nl/fr/en bundle):

| key | nl | fr | en |
|---|---|---|---|
| `voice.tooltip.idle` | "Spreek je bericht in" | "Dicter votre message" | "Dictate your message" |
| `voice.tooltip.recording` | "Stop met opnemen" | "Arrêter l'enregistrement" | "Stop recording" |
| `voice.status.recording` | "Bezig met opnemen…" | "Enregistrement…" | "Recording…" |
| `voice.status.transcribing` | "Bezig met transcriberen…" | "Transcription…" | "Transcribing…" |
| `voice.error.denied` | "Microfoontoegang geweigerd. Activeer in browserinstellingen." | "Accès au microphone refusé. Activez-le dans les paramètres." | "Microphone access denied. Enable in browser settings." |
| `voice.error.empty` | "Geen spraak gedetecteerd — probeer opnieuw" | "Aucune parole détectée — réessayez" | "No speech detected — try again" |
| `voice.error.upload` | "Transcriptie mislukt — probeer opnieuw" | "Échec de la transcription — réessayez" | "Transcription failed — try again" |
| `voice.error.unsupported` | "Voice input vereist een veilige verbinding (HTTPS)" | "L'entrée vocale nécessite une connexion sécurisée (HTTPS)" | "Voice input requires a secure connection (HTTPS)" |
| `voice.error.tooLong` | "Maximale opnametijd bereikt (1 minuut)" | "Durée maximale atteinte (1 minute)" | "Maximum recording length reached (1 minute)" |

Whisper itself is multilingual — we don't pass the user's `users.lang` as a hint by default (Whisper's auto-detect is more accurate when the recording's actual language differs from the UI language, e.g. nl agent dictating a fr reply for a fr customer).

## Accessibility

- Mic button is a `<button>` with `aria-label` from the i18n table, `aria-pressed={isRecording}` toggling between idle/recording states
- Elapsed counter renders inside an `aria-live="polite"` region so screen readers can announce significant moments. Polite (not assertive) so it doesn't spam every second; we update the live region only at start, at the amber threshold (0:50), and at auto-stop
- Keyboard flow: button is reachable via Tab, activatable via Enter/Space, plus the global `Ctrl/Cmd + Shift + V` shortcut. Esc to cancel works without the button being focused
- Focus is preserved on the compose textarea throughout; the mic button does not steal focus when entering the recording state
- `prefers-reduced-motion`: the pulsing-dot animation is replaced with a solid red dot (no fade) when the user prefers reduced motion

## Resource Cleanup

The MediaRecorder + audio MediaStream both hold OS-level resources; the OS shows a recording indicator while the stream is live. Failure to release = trust issue ("why is my mic on after I left the page?").

Cleanup must run on:
- Successful upload (after we have the buffer, stop tracks before sending)
- User cancel (Esc, click stop-while-empty)
- Auto-stop at duration cap
- Tab visibility change to `hidden` (`document.addEventListener('visibilitychange')`) — abort recording if user switches tabs
- React unmount (component cleanup via `useEffect` return)
- `beforeunload` (page navigation)

Cleanup steps in order:
1. `mediaRecorder.stop()` if still recording
2. `stream.getTracks().forEach(track => track.stop())`
3. Null out refs to allow GC
4. Reset compose state to `idle`

Concurrent-recording across tabs: the browser will hand the mic to the second tab and revoke from the first. Spec accepts this — the abandoned tab's MediaRecorder will fire `onerror` and we go to the error state. No cross-tab coordination needed.

## Audit Logging

- `ai.transcribe` action in `audit_log`, actor = userId, target = partnerId, metadata = `{ durationSeconds, detectedLanguage, model }`
- **Do not log the transcript text.** It will become a chat message and is auditable through the message archive — duplicating it in audit_log is a GDPR over-collection risk.

## Cost & Rate Limiting

- Whisper billed per audio minute (~$0.006/min on Azure).
- 1 min cap per recording → ≤ $0.006 per request worst case.
- Rate limit (reusing existing `rateLimit.ts`): default 20 transcriptions/min per partner, 500/day. Configurable per partner via `aiFeatures.rateLimits`.

### Metrics

- `guichet_ai_transcribe_seconds_total{partnerId}` counter — total audio seconds sent to Whisper
- `guichet_ai_transcribe_requests_total{partnerId,outcome}` counter — outcome ∈ `success | empty | filtered_hallucination | provider_error | rate_limited`
- `guichet_ai_transcribe_duration_seconds` histogram — server-side request latency (Whisper round-trip)
- `guichet_ai_transcribe_cancellation_rate{partnerId}` gauge — % of recordings cancelled before upload (high cancel rate = UX problem)

### Grafana panel

Add a "Voice transcription" row to the existing AI cost dashboard with:
- Stacked area: estimated $/day per partner (`sum by (partnerId) (rate(guichet_ai_transcribe_seconds_total[1d])) * 0.006 / 60`)
- Outcome breakdown: success vs empty vs hallucination-filtered vs error
- p50 / p95 latency

### Alert rules

- `WhisperCostHigh` — partner spend > $10/day for 1h (default threshold; per-partner override via Alertmanager labels)
- `WhisperErrorRateHigh` — `provider_error` rate > 10% over 15m
- `WhisperHallucinationFilterSpike` — `filtered_hallucination` count > 20/h (suggests denylist needs tuning OR Azure changed model behavior)

## Privacy / GDPR

- Audio is held in memory only (multer memoryStorage); never written to disk.
- Buffer reference released immediately after the Whisper call resolves/rejects.
- Audio leaves the server only as a request body to Azure OpenAI in the partner's configured region (same data path as chat completions).
- Transcript becomes a chat message → existing message retention applies.
- No new GDPR DPIA item — same data classification as the existing chat-summarization feature, smaller surface area.

## Test Strategy

### Unit (`server/services/ai/azure-openai.test.ts`)

- `transcribe()` builds the right multipart body (mock `fetch`)
- Throws on missing `WHISPER_DEPLOYMENT` env
- Surfaces 4xx/5xx from Azure as typed errors

### Unit (`server/routes/ai.test.ts` — new)

- 401 without JWT
- 403 for `agent` role
- 403 if partner `aiFeatures.voiceInput` is false
- 413 over 3 MB
- 415 wrong mime
- 429 over rate limit
- 501 if active provider lacks `transcribe`
- Happy path: returns `{ text, language, durationSeconds }`, writes `ai_usage_log` row with `audio_seconds` set
- Audit row has no transcript text
- Hallucination denylist: short audio + denylisted phrase → returns empty + increments `filtered_hallucination` metric
- Empty Whisper response: returns soft error, increments `outcome=empty` metric

### E2E (Playwright)

- Mock `getUserMedia` + Whisper response
- Click mic → record 2s → stop → assert "Transcribing…" → assert text appears in compose box
- Existing draft text is preserved when transcript is appended
- Cancel via Esc → no upload happens, draft preserved
- Auto-stop fires at 1:00 mark (use fake timers)
- Mic button hidden for agent-role user
- Mic button disabled when `window.isSecureContext` is false
- Tab visibility change to `hidden` → recording aborts, no upload
- Empty transcript response → toast appears, draft preserved
- Voice transcript → improve button enabled even for short text (cameFromTranscript flag)
- Voice transcript → message sent → message `lang` field reflects Whisper-detected language, not `users.lang`
- Screen-reader: aria-live region updates fire at start, amber threshold, auto-stop only

### Load (k6)

Skip for v1. Whisper latency dominates and is out of our control; we'd be benchmarking Azure not our code.

## Rollout

1. **Pre-flight**: confirm `Permissions-Policy: microphone=(self)` in helmet config; confirm Whisper is available in the Azure region we use (westeurope / northeurope candidates).
2. Schema migration: add `ai_usage_log.audio_seconds` (nullable int) + `daily_ai_usage.total_audio_seconds`.
3. Add `transcribe()` to Azure provider; ship behind feature flag (env `WHISPER_DEPLOYMENT` unset → endpoint returns 501).
4. Set `WHISPER_DEPLOYMENT` in non-prod, exercise via REST endpoint manually with sample webm/mp4/wav files.
5. Ship i18n strings for nl/fr/en.
6. Ship platform-operator toggle (`voiceInput` in `EditPartnerModal` BOOLEAN_FEATURES).
7. Ship `ComposeArea` mic UI, gated on the partner flag.
8. Wire metrics + Grafana panel + Alertmanager rules.
9. Default `voiceInput: false` for all partners. Platform operators opt partners in.

## Follow-Ups (Out of Scope for v1)

- Voice input for external `AgentView` (customer side) — needs separate privacy review.
- Live streaming transcription (Azure Speech Service is the right tool, not OpenAI Whisper).
- Speaker diarization for multi-party recordings.
- Local/self-hosted Whisper via a sidecar for partners that don't want audio leaving their region.
- Voice playback (audio attachments) — different feature, different storage story.

## Open Questions

- [ ] Should transcript prefix/suffix indicate origin (e.g. italic "*[voice]* …")? Lean **no** — user will edit before sending; provenance belongs in audit, not the message body.
- [ ] Do we want a per-user opt-out (e.g. agent doesn't want their voice recorded even momentarily)? Probably no — they choose whether to click the button.
- [ ] Hallucination denylist — should it be in code or in `system_settings` for hot-tuning without a deploy? Lean **system_settings** to react to Azure model updates within hours, not days.
- [ ] Should we send `users.lang` as a Whisper hint, or always rely on auto-detect? Spec says auto-detect; needs validation against real bilingual recordings during beta.
