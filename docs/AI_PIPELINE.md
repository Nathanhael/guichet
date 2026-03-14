# AI Intelligence Hub & Message Pipeline

This document describes the AI-driven features of Murmur, including the tenant-aware message processing pipeline, safety guards, and strategic intelligence tools.

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

### Stage 2: Asymmetric Improvement & Translation
The improvement logic is **Role-Based** and **Asymmetric**. The system applies different strategies depending on whether an Agent or a Support Specialist is sending the message.

| Sender | Strategy | Goal | Output |
|---|---|---|---|
| **Agent** | *Clarification* | Turn vague issues into technical precision. | Professional technical summary. |
| **Support** | *Actionable* | Turn technical jargon into operational steps. | **Structured Response** (Steps + Customer Script). |

- **Improvement**: Fetches the partner's specific `agent_prompt_strategy` or `support_prompt_strategy` from the database.
- **Actionable AI**: If enabled, the AI splits support replies into:
    - `[SUMMARY]`: High-level overview.
    - `[STEPS]`: Internal procedure for the agent.
    - `[CUSTOMER_SCRIPT]`: Simple, empathetic text for the customer.
- **Translation**: High-fidelity transfer using Ollama (`gemmatranslate4b`), preserving all special tags.
- **Standard Tier**: If `ai_enabled` is false, this stage is bypassed.

### Stage 3: Sentiment Analysis
Every non-whisper message is asynchronously scored for sentiment (-1.0 to +1.0). These scores drive the real-time "vibe" charts in the AI Intelligence Hub.

### Stage 4: Visual Intelligence (Premium Bubbles)
The UI provides immediate feedback on AI processing:
- **Sentiment Glow**: Bubbles feature a subtle outer glow based on sentiment (Red for frustration, Green for satisfaction).
- **AI Sparkle (✨)**: Messages improved or translated by AI feature a "Sparkle" icon. Hovering/clicking reveals the original text instantly.
- **Structured Rendering**: For Support messages, the UI renders `[STEPS]` and `[CUSTOMER_SCRIPT]` in distinct, beautiful boxes with a **"Copy to Clipboard"** button.

### Stage 5: Automatic Conversation Summarization
When a ticket is closed, if `ai_enabled` is true:
- The system triggers a background task to summarize the entire conversation.
- The summary focuses on the technical problem and the final resolution.
- Results are stored in the `summary` column of the `tickets` table and are visible in the **Archive** and **AI Intelligence Hub**.

---

## 2. AI Intelligence Hub (Admin & Manager)

The AI Intelligence Hub provides qualitative, strategic insights derived from real-time data.

### Key Capabilities
- **AI Persona Editor**: Dedicated configuration tab for Partner Admins to manage their industry rules and prompt strategies.
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
