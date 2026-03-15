# Contributing Guidelines: Tessera

To maintain the high-fidelity aesthetic and real-time performance of this prototype, please follow these guidelines.

> [!TIP]
> **AI Assistants**: Please refer to **[CLAUDE.md](./CLAUDE.md)** and **[GEMINI.md](./GEMINI.md)** for specific "Rules of Engagement" regarding Docker usage and design standards.

## Solaris Design System

The app uses a custom "Solaris" theme. All new components must adhere to these visual rules:

### Glassmorphism
- Use `.glass-card` for primary containers.
- Use `.glass-panel` for sidebars and headers.
- Always include `backdrop-blur` where appropriate.

### Color & Gradients
- Brand colors are dynamic and defined via CSS variables in `index.css`:
    - **Primary**: `var(--brand-primary)`
    - **Secondary**: `var(--brand-secondary)`
- Use `bg-gradient-to-br` for background surfaces using these variables.
- Never use hardcoded Tailwind colors (e.g. `bg-blue-500`).

### Neuro-Inclusivity
- **Fonts**: Use the `Lexend` stack for accessibility.
- **Fixed Widths**: Avoid jarring layout shifts; use `min-w` and `max-w` strictly.
- **Bionic Reading**: Any text-heavy component should utilize the `<BionicText />` wrapper.
- **High Contrast Mode**: Components must respond to the `high-contrast-mode` class by switching to a simplified, high-visibility color palette (typically pure black and white).

### Zen Mode Utilities
- **.zen-glass**: Higher blur (40px) and saturation for deep focus environments.
- **.zen-dim**: Applied to background elements to de-prioritize non-focused content.
- **AmbientBackground.tsx**: Standard component for the slow-pulsing background gradients used in Zen mode and AI insights.

### Identity-Integrated Chat
- **Bubble Alignment**: Identity is indicated primarily by alignment (right for the current user, left for others).
- **Bubble Tails**: Use `.bubble-tail-mine` and `.bubble-tail-other` for visual hierarchy (only on the first message of a group).
- **Sequential Grouping**: Messages from the same user within 2 minutes should be grouped visually (hide avatars and names for subsequent messages).
- **Structured AI Content**: Components should handle `[STEPS]` and `[CUSTOMER_SCRIPT]` tags by rendering them in specialized layout containers (e.g. emerald copy-box for scripts).
- **Avatars**: Use the `UserAvatar` component. Show avatars for others at the start of a message group. Omit for own messages.

## Coding Standards

### State Management (Zustand)
- All shared UI state (modes, language, notifications) belongs in `useStore.ts`.
- Use descriptive setters (e.g., `setDyslexicMode` instead of `toggleMode`).

### Real-Time Events
- Socket events should be registered in `useSocket.ts`.
- Always implement a clean teardown in `useEffect` for listeners.

### TypeScript & Types
- This project is 100% TypeScript for application logic and configuration.
- **Avoid `any`**: Document your interfaces in specialized `.d.ts` or at the top of the file.
- Use the `useT` hook for all UI strings.

## 🛠️ Tooling

### Database Management (Drizzle)
- Use **Drizzle ORM** for all database interactions.
- To push schema changes to the database: `cd server && npx drizzle-kit push:pg`.
- To explore the database visually: `cd server && npx drizzle-kit studio`.

### AI & LLM (Ollama)
- Local translation and sentiment analysis require **Ollama** running on your host.
- The server connects via `http://host.docker.internal:11434`.
- Ensure you have the `gemmatranslate4b` model pulled: `ollama pull gemmatranslate4b`.

## E2E Testing

The project uses Playwright (Chrome + Edge) for end-to-end testing. Tests live in `e2e/` and cover:
- **Auth flows**: Login for each role lands on the correct view.
- **Ticket lifecycle**: Agent creates ticket, support joins and resolves.
- **Live chat**: Real-time bidirectional message exchange via Socket.io.
- **Admin dashboard**: Tab navigation and stats rendering.
- **Multi-tenant isolation**: Partner B cannot see Partner A's tickets.

### Running E2E Tests
```bash
# Against the Docker stack (must be running)
npm run test:e2e

# Against the mock server (fast, no Docker needed)
cd e2e && npm run mock:start   # Terminal 1
npm run test:e2e:mock          # Terminal 2

# Interactive Playwright UI
cd e2e && npm run test:ui
```

### Writing E2E Tests
- Use the auth fixture (`e2e/fixtures/auth.fixture.ts`) for single-context tests.
- For multi-user tests (e.g., agent + support), use separate `browser.newContext()` with the `loginInContext` helper pattern.
- Test constants and user credentials are in `e2e/lib/constants.ts`.
- Global setup seeds test data into PostgreSQL; teardown cleans it.

## Commands Reference

- **Install**: `npm run install:all`
- **Dev**: `npm run dev` (Concurrent client/server)
- **Dev Container**: `docker-compose up` for development. **Production**: `docker-compose -f docker-compose.prod.yml up --build`
- **E2E Tests**: `npm run test:e2e` (Docker) or `npm run test:e2e:mock` (mock server)
- **Unit Tests**: `cd server && npm test` / `cd client && npm test`
