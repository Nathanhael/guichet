# GEMINI.md - Project Context & Instructions

This file serves as the primary instructional context for Gemini CLI when working in the **tessera** repository.

## Project Overview
**Tessera** is a high-fidelity prototype of a real-time, multi-tenant customer support platform. It facilitates communication between **Agents** (who create tickets) and **Support Specialists** (who resolve them), with **Admins**, **Managers**, and **Platform Operators** overseeing operations.

### Key Features
- **Real-Time Communication**: Powered by Socket.io for low-latency chat and status updates.
- **Multi-Tenant Architecture**: Data isolation and project-agnostic "White-Label" logic via Partners and Memberships.
- **Asymmetric AI Pipeline**: Role-based improvement strategies (`agent` vs `support`).
- **Actionable AI**: Automatic generation of customer scripts and internal procedures.
- **AI-Powered Insights**: Tenant-aware translation, sentiment analysis, and qualitative summaries.
- **Dual Dashboard Orchestration**:
  - **Operational Dashboard**: Focuses on real-time KPIs, queue health, and staffing.
  - **AI Intelligence Hub**: Focuses on sentiment trends and topic clustering.
- **AI Persona**: Admin-facing configuration for industry-specific context and rules.
- **Neuro-Inclusive Design (Solaris)**: 
  - **Dyslexic Mode**: Lexend font support.
  - **Bionic Reading**: Fixation-point highlighting.
  - **Immersive Zen Mode**: Adaptive glassmorphism (`.zen-glass`) and ambient backgrounds.
- **Solaris Design System**: A "glassmorphic" aesthetic with dynamic brand variables (`--brand-primary`).
- **GDPR Compliance**: Automatic 30-day data retention policy with anonymized historical aggregation.
- **Enterprise Scaling**: **Redis-based** distributed presence and horizontal scaling support.

### Tech Stack
- **Frontend**: React 18, Vite 5, Tailwind CSS 3, Framer Motion, Zustand (State), Socket.io-client.
- **Backend**: Node.js 20 (ESM), Express.js, Socket.io, PostgreSQL (pg + Drizzle ORM).
- **AI**: Ollama REST API (running `gemmatranslate4b`).
- **DevOps**: Docker & Docker Compose (preferred runtime).
- **Real-Time**: Redis Socket.io Adapter (horizontal scaling), tRPC (end-to-end type safety).
- **API**: Versioned `/api/v1/` namespace for all REST and tRPC endpoints.

---

## 🚨 Critical Mandates

1.  **DOCKER ONLY**: This project is fully containerized. **NEVER** run `npm`, `node`, or `npx` commands on your host machine. This will corrupt `node_modules` sync.
    - **Correct**: `docker compose exec server npm test`
    - **Incorrect**: `npm test`
2.  **Solaris Design Standards**: Do not use plain Tailwind colors (e.g., `bg-blue-500`). Use the custom glassmorphism utilities (`.glass-card`, `.glass-panel`) and gradients defined in `client/src/index.css`.
3.  **Localization-First**: Prefer using the `useT` hook and `client/src/i18n.ts` for all UI strings.
4.  **Graceful AI Fallback**: Always ensure the system remains functional if the Ollama service is offline or if a partner has `ai_enabled: false`.
5.  **State Management**: `client/src/store/useStore.ts` is the single source of truth. Always use functional updates for nested ticket/message objects.
6.  **tRPC & Drizzle Preference**: New data-fetching logic should use **tRPC procedures** instead of raw Express routes. Database interactions must use **Drizzle ORM**.
7.  **SHELL PREFERENCE**: Always use `pwsh` (PowerShell 7+) for shell commands instead of the default `powershell.exe` to ensure compatibility with modern syntax.

---

## Building and Running

### Prerequisites
- Docker & Docker Compose
- [Ollama](https://ollama.com/) (running on the host machine at port 11434)
- **Redis**: Required for Socket.io horizontal scaling and presence tracking.

### Commands
| Task | Command |
| :--- | :--- |
| **Start Development** | `docker compose up` |
| **Install Dependencies** | `npm run install:all` (Host-only for IDE sync, then restart Docker) |
| **Run Backend Tests** | `docker compose exec server npm test` |
| **Run Frontend Tests** | `docker compose exec client npm test` |
| **View Server Logs** | `docker logs -f tessera-server-1` |
| **Database Studio** | `cd server && npx drizzle-kit studio` (Runs locally) |

---

## Development Conventions

### Architecture & Patterns
- **Role-Based Access**: Roles are `agent`, `support`, `manager`, `admin`, and `platform_operator`. Gate endpoints using `middleware/auth.ts`.
- **Multi-Tenancy**: All data must be scoped by `partner_id`.
- **Socket Rooms**: Tickets use rooms named `ticket:{ticketId}`. Broadcasts are scoped to `partner:{partnerId}`.
- **Message Pipeline**: Every message goes through a sequence of **Guards** (safety/quality) → **Improvement** (AI) → **Translation** (AI).
- **Data Retention**: The `gdpr.ts` service purges PII every 24 hours for records older than 30 days.

### Coding Style
- **TypeScript**: 100% type safety. Avoid `any`. Canonical types are in `client/src/types/index.ts`.
- **Components**: Use functional components with hooks. Prefer modular "cockpit" components in `client/src/components/admin/`.
- **Logging**: Use **Pino** for structured logging on the backend (`server/utils/logger.ts`).
- **Time**: Always use `Europe/Brussels` timezone for business hours and statistics.

### File Structure
- `client/src/views/`: Primary role-based entry points (`SupportView.tsx`, `PlatformView.tsx`).
- `client/src/store/`: Zustand state definitions.
- `server/routes/`: Express API endpoints.
- `server/services/`: Core business logic (Translation, LLM, Stats, GDPR, Presence).
- `server/db/schema.ts`: Drizzle ORM schema definitions.

---

## Documentation Library
- **[docs/TECHNICAL.md](./docs/TECHNICAL.md)**: Multi-tenant system design, schema, and scalability.
- **[docs/AI_PIPELINE.md](./docs/AI_PIPELINE.md)**: Tenant-aware AI processing and analytics.
- **[docs/USER_GUIDE.md](./docs/USER_GUIDE.md)**: User roles and neuro-inclusive walkthroughs.
- **[CONTRIBUTING.md](./CONTRIBUTING.md)**: Solaris UI standards.
- **[CLAUDE.md](./CLAUDE.md)**: Detailed guidance for AI coding assistants.

# context-mode — MANDATORY routing rules

You have context-mode MCP tools available. These rules are NOT optional.

| Command | Action |
|---------|--------|
| `ctx stats` | Call the `stats` MCP tool and display the full output verbatim |
| `ctx doctor` | Call the `doctor` MCP tool, run the returned shell command, display as checklist |
| `ctx upgrade` | Call the `upgrade` MCP tool, run the returned shell command, display as checklist |
