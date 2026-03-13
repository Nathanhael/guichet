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
- **Real-Time**: Redis Socket.io Adapter (horizontal scaling), tRPC (end-to-end type safety).

---

## 🚨 Critical Mandates

1.  **DOCKER ONLY**: This project is fully containerized. **NEVER** run `npm`, `node`, or `npx` commands on your host machine. This will corrupt `node_modules` sync.
    - **Correct**: `docker compose exec server npm test`
    - **Incorrect**: `npm test`
2.  **Solaris Design Standards**: Do not use plain Tailwind colors (e.g., `bg-blue-500`). Use the custom glassmorphism utilities (`.glass-card`, `.glass-panel`) and gradients defined in `client/src/index.css`.
3.  **Localization-First**: Prefer using the `useT` hook and `client/src/i18n.ts` for all UI strings. The `ExpertView` and `AdminView` are fully localized. If a string *must* be hardcoded (e.g., system messages), use **Dutch**.
4.  **Graceful AI Fallback**: Always ensure the system remains functional if the Ollama service is offline.
5.  **State Management**: `client/src/store/useStore.ts` is the single source of truth. Always use functional updates for nested ticket/message objects.
6.  **tRPC & Drizzle Preference**: New data-fetching logic should use **tRPC procedures** instead of raw Express routes. Database interactions must use **Drizzle ORM**; avoid raw `pool.query()` calls (see `docs/superpowers/specs/`).

---

## Building and Running

### Prerequisites
- Docker & Docker Compose
- [Ollama](https://ollama.com/) (running on the host machine at port 11434)
- **Redis**: Required for Socket.io horizontal scaling (included in Docker Compose).

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
- **Role-Based Access**: Roles are `agent`, `expert`, and `admin`. Gate endpoints using `middleware/auth.ts`.
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

# context-mode — MANDATORY routing rules

You have context-mode MCP tools available. These rules are NOT optional — they protect your context window from flooding. A single unrouted command can dump 56 KB into context and waste the entire session.

## BLOCKED commands — do NOT attempt these

### curl / wget — BLOCKED
Any shell command containing `curl` or `wget` will be intercepted and blocked. Do NOT retry.
Instead use:
- `mcp__context-mode__ctx_fetch_and_index(url, source)` to fetch and index web pages
- `mcp__context-mode__ctx_execute(language: "javascript", code: "const r = await fetch(...)")` to run HTTP calls in sandbox

### Inline HTTP — BLOCKED
Any shell command containing `fetch('http`, `requests.get(`, `requests.post(`, `http.get(`, or `http.request(` will be intercepted and blocked. Do NOT retry with shell.
Instead use:
- `mcp__context-mode__ctx_execute(language, code)` to run HTTP calls in sandbox — only stdout enters context

### WebFetch / web browsing — BLOCKED
Direct web fetching is blocked. Use the sandbox equivalent.
Instead use:
- `mcp__context-mode__ctx_fetch_and_index(url, source)` then `mcp__context-mode__ctx_search(queries)` to query the indexed content

## REDIRECTED tools — use sandbox equivalents

### Shell (>20 lines output)
Shell is ONLY for: `git`, `mkdir`, `rm`, `mv`, `cd`, `ls`, `npm install`, `pip install`, and other short-output commands.
For everything else, use:
- `mcp__context-mode__ctx_batch_execute(commands, queries)` — run multiple commands + search in ONE call
- `mcp__context-mode__ctx_execute(language: "shell", code: "...")` — run in sandbox, only stdout enters context

### read_file (for analysis)
If you are reading a file to **edit** it → read_file is correct (edit needs content in context).
If you are reading to **analyze, explore, or summarize** → use `mcp__context-mode__ctx_execute_file(path, language, code)` instead. Only your printed summary enters context.

### grep / search (large results)
Search results can flood context. Use `mcp__context-mode__ctx_execute(language: "shell", code: "grep ...")` to run searches in sandbox. Only your printed summary enters context.

## Tool selection hierarchy

1. **GATHER**: `mcp__context-mode__ctx_batch_execute(commands, queries)` — Primary tool. Runs all commands, auto-indexes output, returns search results. ONE call replaces 30+ individual calls.
2. **FOLLOW-UP**: `mcp__context-mode__ctx_search(queries: ["q1", "q2", ...])` — Query indexed content. Pass ALL questions as array in ONE call.
3. **PROCESSING**: `mcp__context-mode__ctx_execute(language, code)` | `mcp__context-mode__ctx_execute_file(path, language, code)` — Sandbox execution. Only stdout enters context.
4. **WEB**: `mcp__context-mode__ctx_fetch_and_index(url, source)` then `mcp__context-mode__ctx_search(queries)` — Fetch, chunk, index, query. Raw HTML never enters context.
5. **INDEX**: `mcp__context-mode__ctx_index(content, source)` — Store content in FTS5 knowledge base for later search.

## Output constraints

- Keep responses under 500 words.
- Write artifacts (code, configs, PRDs) to FILES — never return them as inline text. Return only: file path + 1-line description.
- When indexing content, use descriptive source labels so others can `search(source: "label")` later.

## ctx commands

| Command | Action |
|---------|--------|
| `ctx stats` | Call the `stats` MCP tool and display the full output verbatim |
| `ctx doctor` | Call the `doctor` MCP tool, run the returned shell command, display as checklist |
| `ctx upgrade` | Call the `upgrade` MCP tool, run the returned shell command, display as checklist |
