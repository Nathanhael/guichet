# Tessera (Clean Slate)

Tessera is a high-performance, real-time multi-tenant customer support platform. This version has been stripped of all "bloat" features to provide a distraction-free, high-contrast monochrome chat experience. 

**Note**: Advanced AI and branding features are currently deactivated and will be added back one by one in future iterations.

## 🌟 Core Features (Active)

- **Real-Time Scaling**: Powered by Socket.io with Redis horizontal scaling, presence tracking, typing indicators, and read receipts.
- **Strict Monochrome Standard**: A "scorched earth" visual overhaul. Zero animations, zero motions, zero glassmorphism. Just high-contrast black and white for maximum performance and readability.
- **Adaptive Dynamic Departments**: Organization structure is 100% data-driven. Handles any number of departments via a horizontally scrollable chip-bar UI. Each user can be assigned to multiple departments for custom visibility.
- **Enterprise-Ready Schema**: Optimized with native PostgreSQL JSONB, Enums, and Soft-Delete capabilities. Includes full Audit Logging.
- **Platform Management**: Global oversight for Platform Operators to manage users, partner health, and active/inactive tenant states.
- **Partner Administration**: Partner Admins can directly manage their team, assigning existing users and inviting external users to their specific workspace.
- **Azure Identity Ready**: Schema prepped for OIDC/Entra ID integration.

## 🛠️ Tech Stack

- **Frontend**: React 19.2, Vite 8, Tailwind CSS 4, Zustand 5 (State).
- **Backend**: Node.js 24 (ESM), Express 5, tRPC 11 (Type-safe API), Socket.io 4.8 (Real-time).
- **Database**:
  - **PostgreSQL 18**: Primary relational storage with JSONB and Enums.
  - **Redis 8**: Presence tracking and Socket.io horizontal scaling.
  - **Drizzle ORM**: TypeScript-first schema management.
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

3. **Production Deployment**:
   ```bash
   docker compose -f docker-compose.prod.yml up
   ```

## 🔒 Default Users (Demo)

| Role | User | ID |
| :--- | :--- | :--- |
| **Platform Admin** | Platform Admin | `platform_admin` |

*Password: `password123`*

## 🚨 Project Mandates

- **STRICT B&W**: No colors, gradients, or shadows. Use solid black and white only.
- **NO MOTION**: No animations, transitions, or special effects. The UI must be perfectly static.
- **DYNAMIC DEPT**: Never hardcode department IDs. Read from the partner manifest.
- **DOCKER ONLY**: Always execute commands inside containers.

## 🧪 Testing

```bash
docker compose exec server npm test
docker compose exec client npm test
```
