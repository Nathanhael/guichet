# AI Intelligence Hub & Message Pipeline

This document describes the AI-driven features of M&P Support, including the tenant-aware message processing pipeline, safety guards, and strategic intelligence tools.

---

## 1. Message Processing Pipeline

Every chat message goes through a tiered processing sequence. The pipeline is **Tenant-Aware**; it checks the partner's `ai_enabled` flag and uses their specific `industry` and `ai_rules` manifest.

### Stage 1: Message Guards
Guards are the first line of defense, executing local and semantic filters.

| Layer | Guard | Type | Action |
|---|---|---|---|
| 1 | Length Check | Quality | Block if < 3 or > 2000 chars |
| 2 | ALL CAPS | Quality | Auto-convert to normal case |
| 3 | Repetition | Quality | Block if 3x identical |
| 4 | Offensive | Content | Block via regex list |
| 5 | Threats/Discrim. | Safety | Block via pattern matching |
| 6 | Injection | Security | Block known "jailbreak" patterns |
| 7 | Topic Filter | Content | Block via Ollama (Industry-check) |

### Stage 2: Improvement & Translation
If `ai_enabled` is true, messages are enhanced for clarity.
- **Improvement**: Fixes typos and clarifies technical issues based on the partner's industry rules.
- **Translation**: Detects language differences and performs high-fidelity transfer using Ollama (`gemmatranslate4b`).
- **Standard Tier**: If AI is disabled, this stage is bypassed for zero latency.

### Stage 3: Sentiment Analysis
Every non-whisper message is asynchronously scored for sentiment (-1.0 to +1.0) via Ollama. These scores drive the real-time "vibe" charts in the AI Intelligence Hub.

### Stage 4: Visual Intelligence (Premium Bubbles)
The UI provides immediate feedback on AI processing:
- **Sentiment Glow**: Bubbles feature a subtle outer glow based on sentiment (Red for frustration, Green for satisfaction).
- **AI Sparkle (✨)**: Messages improved or translated by AI feature a "Sparkle" icon. Hovering/clicking reveals the original text instantly.

---

## 2. AI Intelligence Hub (Admin & Manager)

The AI Intelligence Hub provides qualitative, strategic insights derived from real-time data.

### Key Capabilities
- **Sentiment Trends**: Historical tracking of the emotional "vibe" of interactions.
- **Resolution Quality**: Tracking re-open rates to identify recurring friction points.
- **Topic Clustering**: AI-grouped recurring issues per department.
- **Automated Summaries**: LLM-generated qualitative overviews of daily/weekly performance.
- **Predictive Staffing**: (Beta) Forecasting support coverage needs based on volume velocity.

---

## 3. Security & Safety Hardening

### Prompt Injection Protection
- **XML Delimiters**: User content is wrapped in `<message>` tags within prompts.
- **Tenant Context**: The partner's industry rules are injected as a system prefix to ground the model.

### Data Privacy & PII
- **PII Guard**: Post-AI regex scan for sensitive data (IBAN, Credit Cards).
- **Stateless Execution**: Each Ollama call is independent; no history is shared between users or tickets.

---

## 4. Technical Integration

- **LLM Interface**: Local Ollama REST API (`host.docker.internal:11434`).
- **Backend Service**: `server/services/translate.ts`, `server/services/llm.ts`, `server/services/guards.ts`.
- **Database**: `translations_cache`, `llm_summaries`, and sentiment columns in `messages`/`daily_stats`.
