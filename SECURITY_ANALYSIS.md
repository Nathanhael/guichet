# Security Hardening Reference

This document outlines the security measures implemented in M&P Support to protect the AI pipeline and ensure data privacy.

## Prompt Injection Protection

While the risk is low due to the authenticated nature of the system, we have implemented several measures to prevent users from manipulating the AI's output:

1.  **Prefix Filtering**: `guards.ts` scans for known injection patterns (e.g., "ignore previous instructions", "act as a DAN") and blocks messages instantly if found.
2.  **XML Delimiters**: In `translate.ts`, the user content is wrapped in `<message>` tags within the prompt. This provides a structural boundary that prevents "escaping" into the instruction zone.
3.  **Token Budgeting**: A maximum message length of 2000 characters prevents token-stuffing attacks.

## Data Privacy (PII)

The system automatically scans AI outputs to prevent the model from echoing sensitive data:

- **PII Guard**: The socket handler runs a regex-based scan on `processedText` before emitting it.
- **Blocked Patterns**: It detects IBANs, Credit Card numbers, and Belgian National Register Numbers (NRN).
- **Masking**: If PII is detected in the AI output, the message is replaced with: `[Bericht geblokkeerd wegens gevoelige gegevens]`.

## Infrastructure Security

- **Stateless AI Calls**: Each request to Ollama is independent. No conversation history is passed to the model, preventing state-leakage between different tickets.
- **Principle of Least Privilege**: The Ollama container has no network or filesystem access beyond its own API. It cannot interact with the PostgreSQL database.
- **Role-Based Access (RBAC)**: All socket events and API routes are guarded by JWT-based middleware, ensuring only authenticated Agents, Experts, and Admins can trigger the AI pipeline.

## GDPR Compliance

- **30-Day Retention**: Personally Identifiable Information (PII) is purged every 24 hours for any ticket older than 30 days.
- **Aggregated Stats**: Before purging, key metrics are stored in `daily_stats` to preserve business intelligence without storing user-linked data.
