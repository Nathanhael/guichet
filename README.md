# M&P Support

Local prototype of a real-time, multi-tenant live chat application. Featuring project-agnostic "White-Label" architecture, AI-powered insights, asynchronous sentiment analysis, and a neuro-inclusive Solaris design.

## 🚀 Quick Start

1.  **Prerequisites**: Install [Docker](https://www.docker.com/) and [Ollama](https://ollama.com/).
2.  **Ollama Setup**:
    ```bash
    ollama serve
    ollama pull gemmatranslate4b
    ```
3.  **Launch**:
    ```bash
    docker-compose up
    ```
4.  **Access**: Open `http://localhost:5173` and select a demo user.

---

## 📚 Documentation Library

Explore our structured documentation for deeper insights:

### 🛠️ Technical & Architecture
- **[docs/TECHNICAL.md](./docs/TECHNICAL.md)** -- Multi-tenant system design, database schema, and scalability logic.
- **[CONTRIBUTING.md](./CONTRIBUTING.md)** -- Solaris design standards and coding conventions.

### 🧠 AI & Intelligence
- **[docs/AI_PIPELINE.md](./docs/AI_PIPELINE.md)** -- Message processing, safety guards, and tenant-aware AI Hub analytics.

### 👥 User Guides
- **[docs/USER_GUIDE.md](./docs/USER_GUIDE.md)** -- Role-based walkthroughs (Agent, Support, Admin, Platform Operator).

---

## 🏗️ Core Technology

| Layer | Technology |
|---|---|
| **Frontend** | React 18, Vite 5, Tailwind CSS 3, Framer Motion, Zustand |
| **Backend** | Node 20 (ESM), Express.js, Socket.io, **tRPC** |
| **Database** | PostgreSQL + **Drizzle ORM**, **Redis** (Socket scaling & Presence) |
| **AI/ML** | local Ollama (Gemma), Tenant-Aware Sentiment Scoring |
| **DevOps** | Docker Compose, Healthchecks, Non-root containers |

---

## 🛡️ Mandates for AI Assistants
- **Docker Only**: Never run `npm` on the host. Use `docker compose exec`.
- **Solaris UI**: Use glassmorphism and gradients defined in `index.css`.
- **Type Safety**: Maintain 100% TypeScript coverage; avoid `any`.
- **AI Guidance**: See **[CLAUDE.md](./CLAUDE.md)** and **[GEMINI.md](./GEMINI.md)** for developer rules.
