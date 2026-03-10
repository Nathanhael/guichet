# Contributing Guidelines: i-pxs-support

To maintain the high-fidelity aesthetic and real-time performance of this prototype, please follow these guidelines.

> [!TIP]
> **AI Assistants**: Please refer to **[AGENT.md](./AGENT.md)** for specific "Rules of Engagement" regarding Docker usage and design standards.

## Solaris Design System

The app uses a custom "Solaris" theme. All new components must adhere to these visual rules:

### Glassmorphism
- Use `.glass-card` for primary containers.
- Use `.glass-panel` for sidebars and headers.
- Always include `backdrop-blur` where appropriate.

### Color & Gradients
- Primary theme colors are defined in `index.css`:
    - **Solaris Purple**: `rgba(168, 85, 247, 0.4)`
    - **Solaris Blue**: `rgba(59, 130, 246, 0.4)`
- Use `bg-gradient-to-br` for background surfaces.

### Neuro-Inclusivity
- **Fonts**: Use the `Lexend` stack for accessibility.
- **Fixed Widths**: Avoid jarring layout shifts; use `min-w` and `max-w` strictly.
- **Bionic Reading**: Any text-heavy component should utilize the `<BionicText />` wrapper.

## Coding Standards

### State Management (Zustand)
- All shared UI state (modes, language, notifications) belongs in `useChatStore.ts`.
- Use descriptive setters (e.g., `setDyslexicMode` instead of `toggleMode`).

### Real-Time Events
- Socket events should be registered in `useSocket.js`.
- Always implement a clean teardown in `useEffect` for listeners.

### TypeScript & Types
- This project is transitioning to TypeScript.
- **Avoid `any`**: Document your interfaces in specialized `.d.ts` or at the top of the file.
- Use the `useT` hook for all UI strings.

## Commands Reference

- **Install**: `npm run install:all`
- **Dev**: `npm run dev` (Concurrent client/server)
- **Container**: Use `docker-compose up` for the production environment simulation.
