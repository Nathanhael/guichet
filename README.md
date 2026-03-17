# Tessera (Clean Slate)

Tessera is a high-performance, real-time multi-tenant customer support platform. This version has been stripped of all "bloat" features to provide a distraction-free, high-contrast monochrome chat experience. 

**Note**: Advanced AI and branding features are currently deactivated and will be added back one by one in future iterations.

## 🌟 Core Features (Active)

- **Real-Time Scaling**: Powered by Socket.io with Redis horizontal scaling, presence tracking, typing indicators, and read receipts.
- **Strict Monochrome Standard**: A "scorched earth" visual overhaul. Zero animations, zero motions, zero glassmorphism. Just high-contrast black and white for maximum performance and readability.
- **End-to-End Type Safety**: Built with tRPC, Drizzle ORM, and Zod.
- **Unified Multi-Tenancy**: Standardized UI across all partners to ensure a consistent, professional workspace.
- **Platform Management**: Global oversight for Platform Operators to manage the entire ecosystem.

## 🛠️ Tech Stack

- **Frontend**: React 18, Vite 5, Tailwind CSS 3, Zustand (State).
- **Backend**: Node.js 20 (ESM), Express, tRPC (Type-safe API), Socket.io (Real-time).
- **Database**: 
  - **PostgreSQL 16**: Primary relational storage.
  - **Redis 7**: Presence tracking and Socket.io horizontal scaling.
  - **Drizzle ORM**: TypeScript-first schema and migration management.
- **Observability**: Prometheus (Metrics), Grafana (Visualization), Pino (Structured logging).
- **Runtime**: Docker & Docker Compose.

## 🚀 Quick Start

1. **Environment Setup**:
   ```bash
   cp .env.example .env
   ```

2. **Docker Development**:
   ```bash
   docker-compose up
   ```

3. **Install Dependencies (Host-only)**:
   ```bash
   npm run install:all
   ```

## 🔒 Default Users (Demo)

| Role | User | ID |
| :--- | :--- | :--- |
| **Platform Admin** | Platform Admin | `platform_admin` |
| **Partner Admin** | Admin Dirk | `admin_dirk` |
| **Agent** | Agent Jan | `agent_jan` |
| **Support** | Expert Piet | `expert_piet` |

*Password for all users: `password123`*

## 🚨 Project Mandates

- **STRICT B&W**: No colors, gradients, or shadows. Use solid black and white only.
- **NO MOTION**: No animations, transitions, or special effects. The UI must be perfectly static.
- **DOCKER ONLY**: Always execute commands inside containers.
- **LOCALIZATION**: Use the `useT` hook for all UI strings.

## 🧪 Testing

```bash
docker compose exec server npm test
docker compose exec client npm test
```
