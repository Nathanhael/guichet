## Tessera v2.0.0 — Brutalist Redesign

Complete UI overhaul with a CSS custom property design system, self-hosted fonts, and HttpOnly cookie security.

### Design System
- CSS custom property tokens for light/dark mode (`index.css`)
- Self-hosted JetBrains Mono + Inter fonts (zero CDN dependencies)
- 15 utility classes: `btn-primary`, `btn-secondary`, `btn-danger`, `input-field`, `surface-card`, `surface-panel`, `bubble-sent`, `bubble-received`, `bubble-whisper`, `badge`, `mono-label`, `mono-id`, `mono-timestamp`, `section-header`
- WCAG 2.1 AA focus-visible states on all interactive elements
- `prefers-reduced-motion` support for animations and transitions

### Security
- **HttpOnly cookie auth** — JWT via `HttpOnly SameSite=Lax Secure` cookies, eliminates XSS token theft
- **PostgreSQL audit_log immutability triggers** — prevents UPDATE/DELETE at database level
- Companion `session_expires` cookie for client-side expiry detection

### All Views Restyled
- LoginView, App shell, PlatformView, AdminView, SupportView, AgentView
- ConfirmDialog, Toast, ErrorBoundary, ConnectionStatus, SlaIndicator

### Quality
- 236 tests passing (167 server + 69 client)
- TypeScript clean (both server and client)
- Code review: all critical and important findings resolved

**Full changelog:** [CHANGELOG.md](https://github.com/Nathanhael/tessera/blob/main/CHANGELOG.md)
