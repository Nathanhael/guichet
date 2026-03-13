# Technology Stack & Architecture

Detailed technical reference for M&P Support. For a general overview, features, and API docs, see [README.md](./README.md).

## Dependencies

### Backend (server/package.json)

| Package | Version | Purpose |
|---|---|---|
| express | ^4.22.1 | Web server host |
| @trpc/server | ^11.12.0 | Type-safe API framework |
| zod | ^4.3.6 | Schema validation |
| socket.io | ^4.7.4 | Real-time communication |
| pg | ^8.20.0 | PostgreSQL database driver |
| drizzle-orm | ^0.45.1 | TypeScript ORM |
| redis | ^4.7.1 | Redis client for scaling |
| @socket.io/redis-adapter | ^8.3.0 | Redis adapter for Socket.io |
| jsonwebtoken | ^9.0.2 | JWT authentication |
| bcrypt | ^6.0.0 | Password hashing |
| cors | ^2.8.5 | CORS middleware |
| express-validator | ^7.2.1 | Input validation |
| express-rate-limit | ^8.3.1 | Request throttling |
| helmet | ^8.1.0 | HTTP security headers |
| multer | ^1.4.5-lts.1 | File upload handling |
| file-type | ^21.3.1 | Magic byte verification |
| uuid | ^9.0.1 | Unique ID generation |
| date-fns-tz | ^3.1.3 | Timezone handling |
| pino | ^9.6.0 | Structured logging |
| pino-pretty | ^13.0.0 | Pretty-printed logs (dev) |
| vitest | ^4.0.18 | Test runner (dev) |
| supertest | ^7.2.2 | HTTP assertion library (dev) |

### Frontend (client/package.json)

|Package | Version | Purpose |
|---|---|---|
| react | ^18.2.0 | UI framework |
| @trpc/client | ^11.12.0 | tRPC client |
| @trpc/react-query | ^11.12.0 | tRPC React integration |
| @tanstack/react-query | ^5.90.21 | Data fetching & caching |
| tailwindcss | ^3.4.1 | Utility-first CSS |
| typescript | ^5.9.3 | Type-safe development |
| framer-motion | ^12.35.2 | Physics-based animations |
| zustand | ^4.5.2 | State management |
| socket.io-client | ^4.7.4 | Socket.io client |
| recharts | ^2.12.7 | Data visualization |
| lucide-react | ^0.577.0 | SVG icons |
| date-fns | ^3.3.1 | Date manipulation |
| date-fns-tz | ^3.1.3 | Timezone support |
| vite | ^5.1.4 | Frontend bundler |
| @vitejs/plugin-react | ^4.2.1 | React plugin for Vite |
| vitest | ^1.3.1 | Unit test runner (dev) |
| @testing-library/react | ^14.2.1 | Component testing (dev) |
| jsdom | ^24.0.0 | DOM emulation (dev) |

## Build & Performance

To optimize loading times and reduce the initial bundle size, the following strategies are implemented:

- **Route-Based Code Splitting**: View-level components (`AgentView`, `ExpertView`, `AdminView`) are loaded via `React.lazy` and `Suspense`.
- **Manual Chunking**: Large dependencies are separated into dedicated vendor chunks via `vite.config.ts`:
  - `vendor-charts`: `recharts` and `d3`.
  - `vendor-ui-icons`: `lucide-react`.
  - `vendor-ui-anim`: `framer-motion`.
- **Result**: Initial JS payload reduced by ~60%, ensuring faster interaction transitions.

## Database Schema

PostgreSQL via Drizzle ORM. Schema defined in `server/db/schema.ts`.

### Tables

```sql
users              (id, name, role, dept, lang, password)
tickets            (id, dept, agentId, agentName, agentLang, cdbId, dareRef, status, 
                    expertId, expertName, expertLang, expertJoinedAt, createdAt, 
                    closedAt, closingNotes, closedBy, participants, summary)
messages           (id, ticketId, senderId, senderName, text, translatedText, 
                    mediaUrl, whisper, system, createdAt, deliveredAt, readAt, 
                    reactions, senderRole, senderLang, originalText, improvedText, 
                    processedText, translationSkipped, fallback, timestamp)
ratings            (id, ticketId, agentId, expertId, rating, comment, createdAt)
app_feedback       (id, userId, text, treated, createdAt)
labels             (id, name, color)
ticket_labels      (ticketId, labelId)          -- composite PK, ON DELETE CASCADE
daily_stats        (date, total, closed, abandoned, avgResponseMs, avgDurationMs,
                    avgRating, ratingCount, slaResolved, slaCompliant, 
                    deptCounts, ratingsByDept, hourly)
translations_cache (key, value, fromLang, toLang, createdAt)
llm_summaries      (period, sentiment, questions, summary, updatedAt)
canned_responses   (id, shortcut, text)
```

**JSON columns**: `participants`, `reactions`, `deptCounts`, `ratingsByDept`, `hourly`, `questions` are stored as JSON strings and parsed at query time.

### Indexes

```sql
idx_tickets_agentId     ON tickets(agentId)
idx_tickets_status      ON tickets(status)
idx_tickets_dept        ON tickets(dept)
idx_tickets_createdAt   ON tickets(createdAt)
idx_messages_ticketId   ON messages(ticketId)
```

### Migration & Seeding

- `server/sqlite-to-pg.ts` -- Migration script from SQLite to PostgreSQL
- `server/scripts/migrate_users_json.ts` -- Imports users from `db.json` to PostgreSQL

## Authentication Flow

```
Client                          Server
  |                               |
  |-- POST /api/auth/login ------>|  Validate credentials
  |    { id, password }           |  bcrypt.compare(password, hash)
  |                               |  Sign JWT { userId, role }
  |<---- 200 { token, user } ----|
  |                               |
  |-- GET /api/tickets ---------->|  middleware/auth.js:
  |    Authorization: Bearer xxx  |    1. Extract token from header
  |                               |    2. jwt.verify(token, secret)
  |                               |    3. Attach req.user = { userId, role }
  |                               |  middleware/auth.js authorize(['admin']):
  |                               |    4. Check req.user.role in allowed roles
  |<---- 200 [...tickets] -------|
```

- Passwords hashed with `bcrypt` (auto salt rounds)
- JWT tokens expire after 24h (configurable via `JWT_EXPIRY`)
- Role-based access: `authorize(['agent', 'expert', 'admin'])` middleware guards endpoints

## System Architecture

For a detailed breakdown of the system design, real-time flows, and modular architecture, see **[ARCHITECTURE.md](./ARCHITECTURE.md)**.

## Testing

| Suite | Location | Stack | Coverage |
|---|---|---|---|
| Auth middleware | `server/__tests__/auth.test.ts` | vitest | JWT validation, RBAC |
| tRPC Routers | `server/__tests__/trpc.test.ts` | vitest | Ownership, RBAC, Data |
| Guards | `server/__tests__/guards.test.ts` | vitest | All 7 guards + integration |
| Statistics | `server/__tests__/stats.test.ts` | vitest | computeLiveDayStats |
| Translation | `server/__tests__/translate.test.ts` | vitest | Improve, translate, fallback |

## DevOps & Security

### Container Security
- **Non-root Runtime**: Containers for both `server` and `client` execute as the `node` user (UID 1000).
- **Distroless Pattern**: Minimal Alpine-based images used to reduce attack surface.

### Service Orchestration
- **Docker Healthchecks**: 
  - `db`: Uses `pg_isready` to signal availability.
  - `redis`: Uses `redis-cli ping`.
  - `server`: Self-monitors via `/api/health`.
- **Graceful Shutdown**: Node.js listener handles OS signals to ensure zero data loss during restarts.

## Deployment (Docker)

### Development
```yaml
# docker-compose.yml
services:
  db:       # PostgreSQL 16 (port 5432)
  redis:    # Redis 7-alpine (port 6379) for Socket.io adapter
  server:   # Node 20 dev server (port 3001)
  client:   # Vite dev server (port 5173)
```

### Production
```yaml
# docker-compose.prod.yml
services:
  db:       # PostgreSQL 16 with healthcheck
  redis:    # Redis 7-alpine for scale
  server:   # Multi-stage build, non-root user
  client:   # Multi-stage build with nginx (port 80)
```

### CI/CD
GitHub Actions pipeline (`.github/workflows/ci.yml`):
- TypeScript type checking (server + client)
- Server tests with PostgreSQL service container
- Client tests
- Production build verification

- Ollama runs on the host; Docker containers reach it via `host.docker.internal:11434`
- PostgreSQL runs in a dedicated container; configured via environment variables
- Database data is persisted via Docker volumes
- Uploads directory is shared between server container and static file serving
