# Tessera

Tessera is a high-fidelity, real-time multi-tenant customer support platform designed for seamless communication between Agents and Support Specialists.

## 🌟 Key Features

- **Multi-Tenant Architecture**: Complete data isolation with partner-specific branding and AI rules.
- **Asymmetric AI Pipeline**: Specialized AI strategies for `agent` vs `support` roles.
- **Real-Time Scaling**: Powered by Socket.io with Redis horizontal scaling and presence tracking.
- **Neuro-Inclusive Design (Solaris)**: Adaptive UI with glassmorphism, Dyslexic mode, and Bionic Reading.
- **Actionable AI**: Automated generation of customer scripts and internal procedures.
- **End-to-End Type Safety**: Built with tRPC, Drizzle ORM, and Zod.

## 🛠️ Tech Stack

- **Frontend**: React 18, Vite 5, Tailwind CSS 3, Framer Motion, Zustand.
- **Backend**: Node.js 20, Express, tRPC, Socket.io.
- **Database**: PostgreSQL (PostGIS ready), Drizzle ORM, Redis (Presence & Scaling).
- **AI**: Ollama REST API (Model-agnostic, per-partner configuration).
- **Runtime**: Docker & Docker Compose.

## 🚀 Quick Start

1. **Docker Development**:
   ```bash
   docker-compose up
   ```
   *The server will be available at http://localhost:3001 and the client at http://localhost:5173.*

2. **Environment**:
   Copy `.env.example` to `.env` and configure your PostgreSQL and Redis credentials.

3. **Install (Host-only for IDE sync)**:
   ```bash
   npm run install:all
   ```

## 🚨 Critical Mandates (for AI Agents)

- **DOCKER ONLY**: Always execute commands inside containers (`docker compose exec ...`).
- **SOLARIS UI**: Adhere to glassmorphism standards in `client/src/index.css`.
- **LOCALIZATION**: Use the `useT` hook for all UI strings.
- **TYPE SAFETY**: Maintain 100% TypeScript coverage in `client/src/types/index.ts`.

## 📖 Documentation

- **[TECHNICAL.md](./docs/TECHNICAL.md)**: Deep dive into the architecture and scaling.
- **[AI_PIPELINE.md](./docs/AI_PIPELINE.md)**: Details on the multi-stage AI transformation.
- **[USER_GUIDE.md](./docs/USER_GUIDE.md)**: Walkthrough of the 5 platform roles.
- **[CLAUDE.md](./CLAUDE.md)**: Specialized guidance for AI coding assistants.
