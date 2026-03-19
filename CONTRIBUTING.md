# Contributing Guidelines: Tessera (Clean Slate)

To maintain the strict B&W aesthetic and high-performance real-time core of this project, please follow these guidelines.

> [!TIP]
> **AI Assistants**: Please refer to **[CLAUDE.md](./CLAUDE.md)** and **[GEMINI.md](./GEMINI.md)** for specific "Rules of Engagement" regarding Docker usage and design standards.

## Strict B&W Minimalist Standard

The app follows a "scorched earth" visual overhaul. All new components must adhere to these rules:

### 1. No Color, No Gradients
- Use **ONLY** pure black (#000000) and pure white (#FFFFFF).
- No gray scales (except for specific UI elements like scrollbars or whisper messages, using Slate 300/800).
- Never use brand colors or gradients.

### 2. Zero Motion
- All animations and transitions are stripped.
- Do **NOT** use CSS transitions or `transition-all` classes.
- UI must be immediate and static.

### 3. Typography & Accessibility
- **Fonts**: Use the `Inter` stack for primary UI and `Lexend` for dyslexic mode.
- **Fixed Widths**: Avoid jarring layout shifts; use `min-w` and `max-w` strictly.
- **Bionic Reading**: Text-heavy components should utilize the `<BionicText />` wrapper if enabled.
- **Modes**: Support Dark Mode (Black background, White text) and Light Mode (White background, Black text).

### 4. Component Patterns
- **surface-card**: Solid border (1px black/white).
- **btn-primary**: Inverted colors, font-black, uppercase, tracked-widest.
- **input-field**: Solid border, no shadows.

## Coding Standards

### State Management (Zustand)
- All shared UI state belongs in `store/useStore.ts`.
- Use descriptive setters (e.g., `setDyslexicMode`).

### Real-Time Events
- Socket events should be registered in `hooks/useSocket.ts`.
- Always implement a clean teardown in `useEffect` for listeners.

### TypeScript & Types
- 100% TypeScript. No `any`.
- Maintain interfaces in `client/src/types/index.ts`.

## 🛠️ Tooling

### Database Management (Drizzle)
- Use **Drizzle ORM** for all database interactions.
- To push schema changes: `docker compose exec server npx drizzle-kit push`.
- To explore the database: `docker compose exec server npx drizzle-kit studio`.

### Runtime
- **DOCKER ONLY**: Never run npm/node commands on the host machine.
- Use `docker compose exec` for running scripts or tests.

## Commands Reference

- **Start Development**: `docker compose up`
- **Run Backend Tests**: `docker compose exec server npm test`
- **Run Frontend Tests**: `docker compose exec client npm test`
- **Database Push**: `docker compose exec server npx drizzle-kit push`
