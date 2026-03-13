# GEMINI.md - Project Context & Instructions

This file serves as the primary instructional context for Gemini CLI when working in the **i-pxs-support** repository.

## Project Overview
**M&P Support** is a high-fidelity prototype of a real-time customer support chat application. It facilitates communication between **Agents** (who create tickets) and **Experts** (who resolve them), with **Admins** and **Managers** overseeing operations.

### Key Features
- **Real-Time Communication**: Powered by Socket.io for low-latency chat and status updates.
- **AI-Powered Translation**: Automatic translation between Dutch (primary), French, and English using a local **Ollama** LLM (Gemma model).
- **Neuro-Inclusive Design (Solaris)**: Features like Dyslexic Mode (Lexend font) and Bionic Reading to support diverse cognitive needs.
- **Solaris Design System**: A "glassmorphic" aesthetic with vibrant gradients and reactive animations.
- **GDPR Compliance**: Automatic 30-day data retention policy with anonymized historical aggregation.
- **Business Hours**: Enforced availability (07:30–22:30 Europe/Brussels).

### Tech Stack
- **Frontend**: React 18, Vite 5, Tailwind CSS 3, Framer Motion, Zustand (State), Socket.io-client.
- **Backend**: Node.js 20 (ESM), Express.js, Socket.io, PostgreSQL (pg + Drizzle ORM).
- **AI**: Ollama REST API (running `gemmatranslate4b`).
- **DevOps**: Docker & Docker Compose (preferred runtime).
- **Planned**: Redis Socket.io Adapter (horizontal scaling), tRPC (end-to-end type safety).

---

## 🚨 Critical Mandates

1.  **DOCKER ONLY**: This project is fully containerized. **NEVER** run `npm`, `node`, or `npx` commands on your host machine. This will corrupt `node_modules` sync.
    - **Correct**: `docker compose exec server npm test`
    - **Incorrect**: `npm test`
2.  **Solaris Design Standards**: Do not use plain Tailwind colors (e.g., `bg-blue-500`). Use the custom glassmorphism utilities (`.glass-card`, `.glass-panel`) and gradients defined in `client/src/index.css`.
3.  **Dutch-First Hardcoding**: If a string *must* be hardcoded (e.g., system messages), use **Dutch**. However, prefer using the `useT` hook and `client/src/i18n.ts` for UI strings.
4.  **Graceful AI Fallback**: Always ensure the system remains functional if the Ollama service is offline.
5.  **State Management**: `client/src/store/useStore.ts` is the single source of truth. Always use functional updates for nested ticket/message objects.
6.  **tRPC & Drizzle Preference**: New data-fetching logic should use **tRPC procedures** instead of raw Express routes. Database interactions must use **Drizzle ORM**; avoid raw `pool.query()` calls (see `docs/superpowers/specs/`).

---

## Building and Running

### Prerequisites
- Docker & Docker Compose
- [Ollama](https://ollama.com/) (running on the host machine at port 11434)
- **Redis**: Required once the Redis adapter is implemented (see `docs/superpowers/specs/`).

### Commands
| Task | Command |
| :--- | :--- |
| **Start Development** | `docker compose up` |
| **Install Dependencies** | `npm run install:all` (Host-only for IDE sync, then restart Docker) |
| **Run Backend Tests** | `docker compose exec server npm test` |
| **Run Frontend Tests** | `docker compose exec client npm test` |
| **View Server Logs** | `docker logs -f i-pxs-support-server-1` |
| **Database Studio** | `cd server && npx drizzle-kit studio` (Runs locally) |

---

## Development Conventions

### Architecture & Patterns
- **Role-Based Access**: Roles are `agent`, `expert`, `manager`, and `admin`. Gate endpoints using `middleware/auth.ts`.
- **Socket Rooms**: Tickets use rooms named `ticket:{ticketId}`.
- **Message Pipeline**: Every message goes through a sequence of **Guards** (safety/quality) → **Improvement** (AI) → **Translation** (AI).
- **Data Retention**: The `gdpr.ts` service purges PII every 24 hours for records older than 30 days.

### Coding Style
- **TypeScript**: 100% type safety. Avoid `any`. Canonical types are in `client/src/types/index.ts`.
- **Components**: Use functional components with hooks. Prefer modular "cockpit" components in `client/src/components/admin/`.
- **Logging**: Use **Pino** for structured logging on the backend (`server/utils/logger.ts`).
- **Time**: Always use `Europe/Brussels` timezone for business hours and statistics.

### File Structure
- `client/src/views/`: Primary role-based entry points.
- `client/src/store/`: Zustand state definitions.
- `server/routes/`: Express API endpoints.
- `server/services/`: Core business logic (Translation, LLM, Stats, GDPR).
- `server/db/schema.ts`: Drizzle ORM schema definitions.

---

## Documentation References
- **[ARCHITECTURE.md](./ARCHITECTURE.md)**: System design and real-time flows.
- **[TECH_STACK.md](./TECH_STACK.md)**: Comprehensive dependency and schema list.
- **[CONTRIBUTING.md](./CONTRIBUTING.md)**: Detailed Solaris UI rules.
- **[CLAUDE.md](./CLAUDE.md)**: Tool-specific instructions for AI assistants.
