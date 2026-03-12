# AI Translation & Improvement Reference

M&P Support utilizes a sequential AI pipeline to ensure that communication between Agents and Experts is clear, professional, and understood regardless of language barriers.

## Processing Pipeline

Every message that passes the [Message Guards](./GUARDS_FEATURE.md) enters the processing pipeline:

1.  **Improvement (Sentiment & Style)**: 
    *   **Agent to Expert**: Fixes typos, completes sentences, and clarifies the technical problem.
    *   **Expert to Agent**: Simplifies technical jargon and structures long paragraphs into numbered, actionable steps.
2.  **Translation**: 
    *   Detects if the recipient's preferred language differs from the sender's.
    *   Performs high-fidelity translation using the local Ollama instance.
    *   Skips this step if both parties use the same language.

---

## User Experience Design

The system is designed to be invisible and non-confrontational:

- **Sender View**: The sender always sees their **own original message**. They are never corrected or told their grammar was poor.
- **Recipient View**: The recipient sees the **improved and translated** version.
- **Peek Feature**: A toggle in `MessageBubble.tsx` allows the recipient to peek at the `originalText` if they want to see precisely what the other party typed.
- **Fallback**: If the AI service is offline, the system falls back to displaying the original text on both sides, with a subtle warning: *"Verwerking tijdelijk niet beschikbaar"*.

---

## Technical Architecture

### Database Schema
Messages are stored in the `messages` table with several specialized columns to support this flow:
- `originalText`: The raw input from the sender.
- `improvedText`: The internal intermediate result after the improvement prompt.
- `processedText`: The final version (improved + translated) shown to the recipient.
- `translationSkipped`: Flag for same-language conversations.
- `fallback`: Flag indicating AI service failure.

### Prompts
Three distinct optimized prompts are used:
1.  **Agent Improvement**: Focuses on acting as a "Technical Scribe" to clarify issue reports.
2.  **Expert Improvement**: Focuses on acting as a "Communication Bridge" to simplify procedures.
3.  **Translation**: Focuses on high-fidelity linguistic transfer while preserving technical terms (Modem, ONT, CDBID, etc.).

### Integration Details
- **Backend Service**: `server/services/translate.ts`.
- **LLM Interface**: Local Ollama REST API (`translategemma:4b`).
- **Caching**: Results are cached in the `translations_cache` table to ensure near-instant responses for repeated or common phrases.
