# AI Intelligence Hub & Message Pipeline

This document describes the AI-driven features of M&P Support, including the message processing pipeline, safety guards, and strategic intelligence tools.

---

## 1. Message Processing Pipeline

Every chat message goes through a tiered processing sequence before reaching the recipient.

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
| 7 | Topic Filter | Content | Block via Ollama (Telecom check) |

### Stage 2: Improvement & Translation
Messages that pass all guards are enhanced for clarity and translated if necessary.
- **Improvement**: Fixes typos and clarifies technical issues (Agent) or simplifies procedures (Expert).
- **Translation**: Detects language differences and performs high-fidelity transfer using Ollama (`gemmatranslate4b`).
- **Caching**: Results are stored in `translations_cache` to ensure instant responses for common phrases.

### Stage 3: Sentiment Analysis
Every non-whisper message is asynchronously scored for sentiment (-1.0 to +1.0) via Ollama. These scores drive the real-time "vibe" charts in the AI Intelligence Hub.

---

## 2. AI Intelligence Hub (Admin)

The AI Intelligence Hub provides qualitative, strategic insights derived from real-time data.

### Key Capabilities
- **Sentiment Trends**: Historical tracking of the emotional "vibe" of interactions.
- **Resolution Quality**: Tracking re-open rates to identify recurring friction points.
- **Topic Clustering**: AI-grouped recurring issues per department using most-used labels.
- **Automated Summaries**: LLM-generated qualitative overviews of daily/weekly performance.
- **Predictive Staffing**: (Beta) Forecasting expert coverage needs based on volume and sentiment velocity.

---

## 3. Security & Safety Hardening

### Prompt Injection Protection
- **XML Delimiters**: User content is wrapped in `<message>` tags within prompts to prevent instruction escaping.
- **Prefix Filtering**: Immediate rejection of known prompt injection patterns.

### Data Privacy & PII
- **PII Guard**: Post-AI regex scan for IBANs, Credit Cards, and National Register Numbers.
- **Masking**: Malicious or sensitive AI echoes are replaced with: `[Bericht geblokkeerd wegens gevoelige gegevens]`.
- **Stateless Execution**: Each Ollama call is independent; no history is shared between users or tickets.

---

## 4. Technical Integration

- **LLM Interface**: Local Ollama REST API.
- **Backend Service**: `server/services/translate.ts`, `server/services/llm.ts`, `server/services/guards.ts`.
- **Database**: `translations_cache`, `llm_summaries`, and sentiment columns in `messages`/`daily_stats`.
