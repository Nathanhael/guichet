# Message Guards Reference

Message Guards are the first line of defense in the M&P Support chat system. They run on every message **before** it reaches the improvement or translation pipeline. If a guard blocks a message, it is never seen by the recipient, and the sender receives an immediate error notice.

## Guard Pipeline Overview

Guards are executed in a tiered approach, starting with "cheap" local checks (regex/length) and ending with an "expensive" AI-based semantic check.

| Layer | Guard | Type | Action |
|---|---|---|---|
| 1 | Minimum message length | Quality | Block (< 3 chars) |
| 2 | Maximum message length | Safety | Block (> 2000 chars) |
| 3 | ALL CAPS | Quality | Modify (Auto-convert to normal case) |
| 4 | Repetition Detection | Quality | Block (3x identical messages) |
| 5 | Swearing / Offensive language | Content | Block (Regex-based list) |
| 6 | Threats / Aggressive language | Safety | Block (Pattern matching) |
| 7 | Discriminatory language | Safety | Block (Pattern matching) |
| 8 | Prompt Injection Detection | Security | Block (Known prefix matching) |
| 9 | Telecom Topic Filter | Content | Block (Ollama-based semantic check) |

---

## Behavior Reference

### AI Topic Filtering (Ollama)
The final guard asks the local Ollama model (Gemma) if the message is related to telecom support. 
- **Graceful Fallback**: If Ollama is unreachable, this guard "fails open," allowing the message through to ensure service availability.
- **Short Message Bypass**: Common short confirmations (e.g., "OK", "Ja", "Merci") bypass this check to skip unnecessary LLM latency.

### User Feedback (Sender Side ONLY)
When a message is blocked, only the sender sees the warning. The following error codes are emitted via Socket.io:

| Code | Message shown to sender |
|------|------------------------|
| `TOO_SHORT` | Uw bericht is te kort. Gelieve meer details te geven. |
| `TOO_LONG` | Uw bericht is te lang (max. 2000 tekens). |
| `ALL_CAPS` | Uw bericht is omgezet naar normale tekstopmaak. |
| `REPETITION` | U heeft hetzelfde bericht meerdere keren verstuurd. Gelieve uw vraag te herformuleren. |
| `OFFENSIVE_LANGUAGE` | Uw bericht bevat ongepaste taal en werd niet verstuurd. Gelieve professioneel te communiceren. |
| `THREATENING_LANGUAGE` | Uw bericht bevat bedreigende taal en werd niet verstuurd. Dit gedrag wordt geregistreerd. |
| `DISCRIMINATORY_LANGUAGE` | Uw bericht bevat discriminerende taal en werd niet verstuurd. Dit gedrag wordt geregistreerd. |
| `INJECTION_ATTEMPT` | Uw bericht bevat inhoud die niet verwerkt kan worden. Gelieve uw vraag anders te formuleren. |
| `OFF_TOPIC` | Uw bericht lijkt niet gerelateerd te zijn aan telecom-ondersteuning. Gelieve enkel vragen te stellen over internet, TV, telefonie, facturatie of technische problemen. |

---

## Technical Details

- **Backend logic**: Located in `server/services/guards.ts`.
- **Integration**: Called within the `message:send` handler in `server/app.js`.
- **Frontend notice**: Handled in `client/src/components/ChatWindow.jsx` via the `message:blocked` socket event.
