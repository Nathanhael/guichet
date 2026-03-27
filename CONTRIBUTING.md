# Contributing Guidelines: Tessera

To maintain the brutalist design system and high-performance real-time core of this project, please follow these guidelines.

> [!TIP]
> **AI Assistants**: Please refer to **[CLAUDE.md](./CLAUDE.md)** and **[GEMINI.md](./GEMINI.md)** for specific "Rules of Engagement" regarding Docker usage and design standards.

## Brutalist Design System

The app follows a Raw/Exposed Brutalist design. All new components must use CSS custom property design tokens defined in `client/src/index.css`. See `docs/BRUTALIST_DESIGN_SPEC.md` for the full spec.

### Brutalist Design Standard

The app uses a token-based raw/exposed Brutalist design system. All new components must adhere to these rules:

### 1. Colors and Tokens
- Use **ONLY** CSS custom property tokens defined in `index.css`.
- Use the Zinc-based scale for surfaces and distinct Blue, Purple, Red, Green for accents.
- Never use brand colors, inline gradients, or hardcoded hex codes.

### 2. Minimal Motion
- All non-essential animations and transitions are stripped.
- Only a 150ms `fade-in` animation is permitted for modals/panels.
- UI must prioritize functional immediacy and respect `prefers-reduced-motion`.

### 3. Typography & Accessibility
- **Fonts**: Use the `Inter` stack for primary UI, `JetBrains Mono` for UI chrome, and `Lexend` for dyslexic mode.
- **Fixed Widths**: Avoid jarring layout shifts; use `min-w` and `max-w` strictly.
- **Bionic Reading**: Text-heavy components should utilize the `<BionicText />` wrapper if enabled.
- **Modes**: Support Dark Mode and Light Mode natively via CSS tokens.

### 4. Component Patterns
- Use design token classes from `index.css` for surfaces, borders, and text colors.
- Buttons: inverted colors, font-black, uppercase, tracked-widest.
- Inputs: solid border, no shadows.

## Coding Standards

### State Management (Zustand)
- All shared UI state belongs in `store/useStore.ts`.
- Use descriptive setters (e.g., `setDyslexicMode`).

### Real-Time Events
- Socket events should be registered in `hooks/useSocket.ts`.
- Always implement a clean teardown in `useEffect` for listeners.

### TypeScript & Types
- 100% TypeScript. No `any`.
- Zod schemas on backend, TypeScript interfaces in `client/src/types/index.ts`.

## Tooling

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
