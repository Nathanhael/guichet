# GEMINI.md - Project Context & Instructions (Clean Slate)

This file serves as the primary instructional context for Gemini CLI. The project is currently in a "Clean Slate" phase, prioritizing core chat functionality and a strict monochrome aesthetic.

## Project Overview
**Tessera** is a real-time, multi-tenant customer support platform. All complex features (AI Pipeline, Topic Heat, Solaris Design System) have been **deactivated** to focus on a lightweight, high-performance chat core.

### Active Features
- **Real-Time Communication**: Core chat functionality via Socket.io.
- **Multi-Tenant Architecture**: Standardized data isolation via Partners and Memberships.
- **B&W Minimalist Standard**: A strictly monochrome, static UI designed for maximum readability.
- **Platform Oversight**: Global dashboard for Platform Operators.

### Deactivated (Future Backlog)
- AI-Powered Insights & Translation
- Intelligent Incident Detection (Topic Heat)
- Solaris Design System (Glassmorphism & Gradients)
- Agent Lite PWA
- GDPR Automated Purge

### Tech Stack
- **Frontend**: React 18, Vite 5, Tailwind CSS 3, Zustand (State).
- **Backend**: Node.js 20 (ESM), Express.js, Socket.io, PostgreSQL (pg + Drizzle ORM).
- **Real-Time**: Redis Socket.io Adapter & Distributed Presence.

---

## 🚨 Critical Mandates

1.  **STRICT B&W**: The theme is strictly black and white. **NEVER** introduce colors, gradients, or shadows. Use solid backgrounds and sharp borders only.
2.  **ZERO MOTION**: All animations, transitions, and Framer Motion logic have been stripped. The UI must remain perfectly static.
3.  **DOCKER ONLY**: Never run npm/node commands on the host machine.
4.  **Localization-First**: Use the `useT` hook for all UI strings.
5.  **Simplified State**: `client/src/store/useStore.ts` remains the source of truth.

---

## Building and Running

| Task | Command |
| :--- | :--- |
| **Start Development** | `docker compose up` |
| **Run Backend Tests** | `docker compose exec server npm test` |
| **Run Frontend Tests** | `docker compose exec client npm test` |
| **Database Studio** | `cd server && npx drizzle-kit studio` (Runs locally) |

---

## Development Conventions

- **Role-Based Access**: `agent`, `support`, `admin`, and `platform_operator`.
- **Standardized UI**: No partner-specific theming. All organizations share the same B&W standard.
- **File Structure**: Core views are in `client/src/views/`. Standard components in `client/src/components/`.
