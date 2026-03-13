# AGENT.md - AI Manual for M&P Support

This document serves as a high-level "Rules of Engagement" for any AI agent working on the M&P Support repository. It consolidates critical constraints and patterns that are not always obvious from code alone.

## 🚨 1. Execution Environment: Docker ONLY
- This project is **CONTAINERIZED**.
- **NEVER** run `npm`, `node`, or `npx` on the host machine. It will cause `node_modules` sync issues.
- **Commands must be run via Docker**:
  - `docker exec i-pxs-support-server-1 node [script]`
  - `docker exec i-pxs-support-server-1 npm test`
- Refer to `.cursorrules` and `CLAUDE.md` for specific command patterns.

## 🎨 2. Solaris Design System (Visual Excellence)
- **Do NOT use plain colors** (e.g., `bg-blue-500`).
- **Aesthetics**: Glassmorphism, subtle gradients, and reactive micro-animations are mandatory.
- **Themes**:
  - **Solaris Light**: Soft, high-contrast, premium whitespace.
  - **Liquid Dark**: Deep blues/purples with glass overlays.
- **Fonts**: Use `Lexend` for Dyslexic mode and `Outfit`/`Inter` for standard UI.

## 🇳🇱 3. Dutch-First Requirement
- **Hardcoding Rules**: If a string must be hardcoded (e.g., custom error guards), use **Dutch** as the primary language.
- **Fallback**: Always ensure that the `nl` translation key is the most robust and complete.

## 🧠 4. State Management (Zustand)
- **File**: `client/src/store/useStore.ts`
- **Pitfall**: The `messages` and `typingUsers` stores are keyed by `ticketId`. Avoid wiping them during partial updates.
- **Immutability**: Always use functional updates or shallow copies when modifying nested ticket properties.

## 🛡️ 5. Domain Knowledge & Constraints
- **Roles**: `agent` (creates tickets), `expert` (joins from queue), `admin` (full dashboard, labels, archive, feedback).
- **Business Hours**: Enforced in tRPC procedures and `client/src/components/BusinessHoursGuard.tsx`. Do not bypass these without explicit reason.
- **Neuro-Inclusive Features**: `Dyslexic Mode`, `Bionic Reading`, and `Zen Mode` (Focus Mode for Experts).
- **API**: Powered by **tRPC** for type-safety. Avoid adding new raw Express routes unless necessary (e.g., file uploads).
- **Translation**: Uses a local Ollama instance. If the LLM is down, the system **must** fallback gracefully to original text.
- **GDPR**: Retention is 30 days. PII is purged while aggregated stats are kept.

## 📂 6. Documentation Map
- **[ARCHITECTURE.md](./ARCHITECTURE.md)**: Logic flows and PostgreSQL schema.
- **[TECH_STACK.md](./TECH_STACK.md)**: Dependency list and versions.
- **[CONTRIBUTING.md](./CONTRIBUTING.md)**: Coding and CSS standards.
- **[CLAUDE.md](./CLAUDE.md)**: Tool-specific instructions for Claude.
