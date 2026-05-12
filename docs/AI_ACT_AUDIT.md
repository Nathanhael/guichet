# AI Act Risk Audit — Guichet

**Jurisdiction:** EU AI Act (Regulation (EU) 2024/1689) + GDPR + Belgian DPA.
**Operator size:** Medium enterprise (≥ 50 employees → CPPT; potentially ≥ 100 → CE).
**Last reviewed:** 2026-05-12.

This document maps every AI capability shipped by Guichet against the Act's risk tiers, lists the transparency obligations triggered, and records the current compliance posture + gaps. Update on every change to `AiAction` or `PartnerAiConfig`.

## 1. Scope

**Deployment context.** Guichet is an internal collaboration tool between two classes of worker employed by the same partner: *agents* (front-line employees who handle external customer matters in other channels) and *experts* (subject-matter specialists who answer agent queries inside Guichet). External end-users do not interact with Guichet directly. Every AI-touched message is exchanged between two workers of the same employer, which shifts the transparency analysis: the "natural person exposed to AI-generated content" in Art. 50(2) is always a workplace colleague, never a consumer. Worker-facing obligations (CCT 81, AI Act Annex III §4(b)) carry the weight; consumer-facing obligations (Art. 50(2) deepfake / synthetic content) carry less.

All AI capabilities are server-side, multi-tenant, opt-in per partner via `partners.ai_config` and globally gated by `AI_ENABLED`. Provider abstraction in `server/services/ai/` (Azure OpenAI primary, OpenAI-compatible fallback). The supported actions enumerated in `server/services/ai/types.ts` (`AiAction`):

| Action | What it does | Subject | Initiator | Decision authority |
|---|---|---|---|---|
| `improve` | Rewrites an agent's outgoing draft for tone/grammar | Agent draft → end-user customer | Agent (optional mode) or auto (forced mode) | Agent — sees diff, can revert (`userFinalChoice`) |
| `translate` | Translates a message body for the viewer's locale | Either side's message | Server (background, cached) | None — augmentation only |
| `transcribe` | Speech-to-text for agent voice dictation | Agent audio (no biometric ID) | Agent (mic button) | Agent — sees transcript before sending |
| `classify` | Categorises a ticket | Ticket metadata + first message | Server (background) | None — informational |
| `suggest` | Drafts a reply suggestion | Conversation thread | Agent (button) | Agent — accepts/edits/discards |
| `match_canned` | Picks the closest canned response | Conversation context | Agent (autocomplete) | Agent — accepts/edits/discards |

**Common properties:**
- Always human-in-the-loop on the staff side. No AI output is delivered to the end-user customer without an agent send action (with the partial exception of `improve` in `forced` mode — see §4).
- PII redaction (`server/services/ai/piiRedaction.ts`) strips emails, Belgian phone numbers, NRN, and Luhn-valid card numbers before any prompt leaves the server.
- All calls logged in `ai_usage_log` (partner, user, action, model, tokens, latency, success). Per-partner audit verbosity (`hash | metadata | full`) governs whether prompt and response bodies are persisted.

## 2. Risk Classification

| AI Act tier | Triggered? | Reasoning |
|---|---|---|
| Prohibited (Art. 5) | No | No biometric categorisation, no emotion recognition in the workplace beyond what the AI Act allows for safety/medical, no social scoring, no predictive policing. `transcribe` is plain STT — no voice-identification or affective inference. |
| High-risk (Annex III) | **Conditional — §2.1** | Depends on how usage logs are used internally. |
| Limited-risk / transparency (Art. 50) | **Yes — §2.2** | Generative + translation content delivered to a natural person (the end-user customer). |
| Minimal-risk | Default | All other operational risk. |
| GPAI / foundation-model obligations | Provider-side | Azure OpenAI / OpenAI provide model-card and systemic-risk attestations; we are a *deployer*, not a *provider*. |

### 2.1 High-risk conditional path — Annex III §4(b)

> "AI systems intended to be used to monitor and evaluate the performance and behaviour of persons in work-related relationships."

`ai_usage_log` and `daily_ai_usage` capture per-user AI usage volumes. If a partner admin uses these tables to evaluate staff performance, allocate work, or take HR action, the deployment shifts into Annex III §4(b) → high-risk.

**Position:** Guichet does **not** intend these tables for performance evaluation. They exist for cost tracking, capacity planning, and rate-limit enforcement. This intent must be documented in the partner's internal AI policy and reflected in the works-council disclosure (see `WORKS_COUNCIL_DISCLOSURE.md`). Any departure from this intent re-triggers the high-risk obligations (Art. 9–15, fundamental-rights impact assessment under Art. 27).

**Mitigation in product:**
- Per-user breakdown of `ai_usage_log` is not exposed to partner admins in the UI today; only aggregate views are shown.
- Add an explicit "purpose limitation" note in the admin AI usage panel when it lands (UI gap — see §4).

### 2.2 Transparency tier — Art. 50

| Obligation | Applies? | Current state |
|---|---|---|
| Art. 50(1): inform users they interact with an AI system | **No** — the visible interlocutor is always a human agent. The AI is invisible scaffolding. | N/A |
| Art. 50(2): mark machine-generated or manipulated content as artificially generated, in a machine-readable format | **Yes for `improve`, partial for `translate`** — but the exposed person is a workplace colleague, not a consumer (see §1) | `messages.improvedAt` flags improved messages; UI shows ✨ next to the timestamp **for the agent**. Cross-side marking inside the worker-to-worker chat is low-priority polish, not a deepfake-grade obligation. |
| Art. 50(3): inform persons exposed to emotion-recognition or biometric-categorisation | No | Not used. |
| Art. 50(4): label deepfake / synthetic text on matters of public interest | No | Private B2C / B2B customer support is out of scope. |

## 3. GDPR Cross-cutting

| Article | State |
|---|---|
| Art. 5(1)(c) data minimisation | PII redaction enforced pre-prompt (`piiRedaction.ts`). Audit verbosity defaults to `metadata`, not `full`. |
| Art. 13/14 information | Add AI-processing notice to privacy policy. Currently not present per partner template. **Gap.** |
| Art. 22 automated decision-making | **N/A** — no AI feature produces a legal or similarly significant effect on the data subject without human review. |
| Art. 28 processor terms | Azure OpenAI DPA in place; data residency is `francecentral` (verified, see memory `azure_openai_deployment.md`). |
| Art. 30 records of processing | Per-partner `ai_usage_log` retention 30 days, aggregated into `daily_ai_usage`. ROPA entry required at deployer level. |
| Art. 32 security | Provider API keys encrypted at rest via `services/encryption.ts` (AES-GCM, `FIELD_ENCRYPTION_SECRET`). |
| Art. 35 DPIA | **Recommended but not strictly required** under current scope. A DPIA covering combined effect of staff monitoring (CCT 81) + AI logging is advisable. |

## 4. Gaps + Remediation

| # | Gap | Priority | Fix |
|---|---|---|---|
| G1 | Receiving colleague (agent reading an expert reply, or vice versa) cannot see when the message was AI-improved or machine-translated | **Closed** — already implemented prior to this audit. | `Message.tsx` renders `✨` for any message with `improvedAt` set or when the viewer is reading a translation (`isShowingTranslation`), regardless of `isMine`. Covered by `Message.aiBadge.test.tsx`. |
| G2 | No first-touch AI disclosure inside the agent↔expert chat | **Deferred / covered indirectly** — `AiDisclosureBanner` ships the workforce-level reminder one level up (view shell). An in-chat reminder per ticket would be redundant. | If user-feedback later asks for it, render a one-time per-ticket info-bar in `ChatHeader`. Not scheduled. |
| G3 | No worker-facing disclosure that AI usage is logged | **Closed** | `AiDisclosureBanner` (once per `user × partner`, dismissable) renders in both `SupportView` and `AgentView`; opens `AiDisclosureModal` with the worker-facing summary. |
| G4 | Privacy notice does not mention AI processing | **Closed** | `PARTNER_PRIVACY_NOTICE_SNIPPET.md` provides NL / FR / EN boilerplate for the partner's worker privacy notice (Art. 13). |
| G5 | No documented purpose-limitation policy for `ai_usage_log` | **Closed** | `WORKS_COUNCIL_DISCLOSURE.md` §4 documents the policy. `AdminAi`'s "Privacy & compliance" section surfaces a button that opens `AiDisclosureModal` (worker-facing summary) and a footnote pointing partners at the full template for the CE / CPPT consultation. |
| G6 | DPIA not on file | Medium | Produce a DPIA covering the combined AI + monitoring scope. Out of scope for this engineering change. |

After the per-membership opt-out + UI follow-up + this polish, the engineering gap list collapses to **G6 only** (a legal artefact). All transparency obligations achievable in code are met before the Art. 50 phased-applicability deadline of 2026-08-02.

## 5. Review cadence

- Re-audit on any change to `AiAction`, `PartnerAiConfig`, prompt templates, or provider.
- Re-audit annually regardless of changes.
- AI Act phased applicability: prohibited practices since 2025-02-02; transparency obligations under Art. 50 apply from 2026-08-02 — Guichet's transparency gaps must close before that date.
