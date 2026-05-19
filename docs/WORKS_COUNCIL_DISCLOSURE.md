# Works Council Disclosure — AI Use in Guichet

**For:** Conseil d'Entreprise (CE) and / or Comité pour la Prévention et la Protection au Travail (CPPT) of any Belgian medium-enterprise partner running Guichet.
**Legal basis:** CCT n° 39 (information and consultation on technology with collective consequences for workers), CCT n° 81 (privacy in electronic monitoring at work), GDPR Art. 88, EU AI Act Annex III §4(b).
**Document type:** Information note for the consultation round mandated by CCT 39. **Not** a consent form — the consultation is mandatory but the employer is not required to obtain individual worker consent for legitimate processing.

> This is a template the **partner** completes and presents to its own works council. Guichet (the platform vendor) provides the technical disclosure; the partner remains the data controller and the employer for CCT purposes.

## 1. What is being introduced

Guichet is the internal collaboration platform that connects two classes of worker employed by the partner: *agents* (front-line staff who handle external customer matters through other channels) and *experts* (subject-matter specialists who answer agent queries inside Guichet). External end-users do not interact with Guichet directly — every conversation in the platform is worker-to-worker within the same employer.

AI-assisted features can be enabled per partner by an administrator. When enabled, the following AI capabilities may be used by both classes of worker:

| Capability | Use | Worker-facing effect |
|---|---|---|
| Message improvement | Rewrites an outgoing draft for tone or grammar. | Either optional (sparkle button) or forced (auto-improve on send) depending on partner config. Worker always sees the result before send; revert is one click. |
| Translation | Translates incoming customer messages into the worker's locale, and outgoing replies into the customer's locale. | Background — adds a translation badge; original wording is always one click away. |
| Voice dictation | Speech-to-text. Worker speaks into a microphone, gets a transcript to edit and send. | Voluntary. Audio is sent to the AI provider for transcription only; no voice biometric is stored or analysed. |
| Reply suggestion | Drafts a candidate reply the worker can accept, edit, or discard. | Always reviewed by the worker. |
| Ticket classification | Picks a category for an incoming ticket. | Routing aid only; the worker can re-classify. |
| Canned-response match | Suggests the closest pre-written reply. | Worker chooses. |

**Provider:** an EU-hosted AI provider — selection pending. EU-only data residency is a hard requirement of the provider selection; a DPA will be executed with the chosen provider before AI features are activated. The selection will be presented to the works council before activation.

**PII protection:** Email addresses, Belgian phone numbers, national-register numbers, and credit-card numbers are stripped from prompts before they reach the AI provider.

## 2. Why it is being introduced

- Reduce time spent on routine drafting and translation across NL / FR / EN.
- Improve response quality and consistency.
- Lower the language barrier between staff and customers in Belgium's multilingual environment.

No headcount reduction is planned as a consequence of this rollout. The employer should confirm or qualify this statement before presenting to the CE.

## 3. Data processed about workers

The system records the following about each worker who uses an AI feature:

| Field | Source table | Retention | Purpose |
|---|---|---|---|
| Worker user id, partner id | `ai_usage_log` | 30 days, then aggregated | Cost attribution, rate-limit enforcement, troubleshooting. |
| Action (`improve` / `translate` / …), provider, model | `ai_usage_log` | 30 days, then aggregated | Same. |
| Tokens consumed, latency, success / error flag | `ai_usage_log` | 30 days, then aggregated | Same. |
| Prompt and response text (only when partner's audit verbosity is set to `full`) | `ai_usage_log.prompt`, `ai_usage_log.response` | 30 days | Optional audit trail. **Default is `metadata`, not `full` — full capture is an explicit admin decision.** |
| Thumbs-up / thumbs-down feedback the worker gives on an AI output | `ai_feedback` | 30 days | Feature improvement. Voluntary on the worker's part. |
| `userFinalChoice` (kept the AI draft, reverted to the original, or edited) | `ai_feedback.user_final_choice` | 30 days | Feature improvement. |
| Daily counts of AI usage per worker | `daily_ai_usage` (aggregated) | Indefinite, as aggregate | Capacity planning. |

The platform does **not** record: audio recordings from voice dictation (only the transcript text), keystrokes, mouse movements, screen captures, geolocation, or biometric identifiers.

## 4. Purpose limitation — what the worker-level AI logs are NOT used for

The works council and individual workers are informed that `ai_usage_log` data is used **only** for:
1. Cost attribution to the partner.
2. Rate-limit enforcement (preventing accidental high-volume calls).
3. Troubleshooting individual AI failures when the worker reports an issue.
4. Aggregate trend analysis (after the 30-day window, only aggregated counts remain).

The data is **not** used for:
1. Individual performance evaluation, ranking, or grading.
2. Disciplinary decisions, except where a specific worker complaint is being investigated and the legal escalation under CCT 81 has been triggered.
3. Allocation of work or shifts.
4. Determination of bonuses, promotions, or terminations.

Crossing this line shifts the deployment into the EU AI Act's "high-risk" regime (Annex III §4(b)) and requires the full Art. 9–15 obligations plus a fundamental-rights impact assessment under Art. 27. The partner must escalate to legal before any such use.

## 5. Worker rights

A worker subject to this processing has the right to:
- **Access** the AI-usage log entries about them (Art. 15 GDPR).
- **Rectify** errors (Art. 16) — limited applicability given the data is operational telemetry.
- **Erase** rows in `ai_usage_log` once the legal-basis ground falls away (Art. 17). Aggregate `daily_ai_usage` rows are retained.
- **Restrict** processing (Art. 18) during a dispute.
- **Object** (Art. 21) — the worker can request that their account stop using AI features without sanction. The partner admin can disable AI per-user via membership scope (operational confirmation: today this is a partner-level toggle; per-user opt-out is a UI gap — see G3 in `AI_ACT_AUDIT.md`).
- **Lodge a complaint** with the Autorité de protection des données (APD / GBA).

A worker DPO contact must be named by the partner.

## 6. Monitoring under CCT 81

CCT 81 applies because the system records data about the worker's use of an electronic tool. The CCT 81 four-step framework:

| Step | Status |
|---|---|
| Legitimate purpose declared | Yes — see §3 and §4. |
| Collective information to the CE / CPPT | This document, presented to the CE / CPPT. |
| Individual information to each worker | Once-per-session in-app banner (engineering change pending — G3 in `AI_ACT_AUDIT.md`). |
| Individualisation only after collective anomaly | The partner agrees not to drill into individual AI-usage rows except in an investigation pre-cleared by HR + DPO. |

## 7. Consultation process — checklist for the partner

Before enabling any AI feature in production:

- [ ] Present this document to the CE (if ≥ 100 employees) and / or CPPT (if ≥ 50 employees).
- [ ] Allow the statutory consultation period (default 15 days, longer if agreed). The CE has the right to comment; the decision remains with the employer.
- [ ] Minute the meeting and record any commitments made (e.g. opt-out mechanism, deferred features).
- [ ] Update the internal work-regulations annex to reference this processing.
- [ ] Update the privacy notice handed to workers on hiring + the privacy policy on the platform.
- [ ] Notify the DPO; have them sign off on the lawful-basis assessment.
- [ ] If the deployer plans to use `ai_usage_log` for anything in §4's exclusion list, **stop** and escalate to legal — the deployment becomes high-risk under the AI Act and requires Art. 27 FRIA.
- [ ] Keep this document and the meeting minutes for at least 5 years (administrative-sanction limitation period).

## 8. Versioning

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-05-12 | Initial template covering the six AI actions in `server/services/ai/types.ts`. |

Re-issue and re-consult whenever a new `AiAction` is added, the provider region changes, or the purpose-limitation list in §4 changes.
