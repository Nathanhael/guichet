# Technology Stack & Architecture

Detailed technical reference for M&P Support. For a general overview, features, and API docs, see [README.md](./README.md).

## Dependencies

### Backend (server/package.json)

| Package | Version | Purpose |
|---|---|---|
| express | ^4.18.3 | REST API framework |
| socket.io | ^4.7.4 | Real-time communication |
| better-sqlite3 | ^11.5.0 | SQLite database driver |
| jsonwebtoken | ^9.0.2 | JWT authentication |
| bcrypt | ^5.1.1 | Password hashing |
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
| vitest | ^1.3.1 | Test runner (dev) |
| supertest | ^6.3.4 | HTTP assertion library (dev) |

### Frontend (client/package.json)

|Package | Version | Purpose |
|---|---|---|
| react | ^18.2.0 | UI framework |
| react-dom | ^18.2.0 | DOM rendering |
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

## Database Schema

SQLite with WAL mode for concurrency. Schema defined in `server/db/schema.sql`.

### Tables

```sql
users              (id, name, role, dept, lang, password)
tickets            (id, dept, agentId, expertId, status, createdAt, closedAt,
                    closingNotes, closedBy, expertJoinedAt, participants)
messages           (id, ticketId, senderId, text, translatedText, mediaUrl,
                    whisper, system, createdAt, deliveredAt, readAt, reactions)
ratings            (id, ticketId, agentId, expertId, rating, comment, createdAt)
app_feedback       (id, userId, text, treated, createdAt)
labels             (id, name, color)
ticket_labels      (ticketId, labelId)          -- composite PK, ON DELETE CASCADE
daily_stats        (date, total, closed, abandoned, avgResponseMs, avgDurationMs,
                    avgRating, slaResolved, slaCompliant, deptCounts, ratingsByDept, hourly)
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

- `server/db/migrate.js` -- One-time migration from legacy `db.json` to SQLite
- `server/db/seed.js` -- Populates demo users (10 agents, 3 experts, 1 admin)
- `server/db/apply_schema_updates.js` -- Applies schema evolution (new columns, indexes)

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
| API integration | `server/__tests__/api.test.js` | vitest + supertest | Ticket, message, feedback, label CRUD |
| Auth flow | `server/__tests__/auth.test.js` | vitest + supertest | Register, login, JWT validation, RBAC |
| Statistics | `server/__tests__/stats.test.js` | vitest + supertest | Stats endpoint, date filtering, dept filtering |
| UI components | `client/src/components/admin/shared/__tests__/` | vitest + @testing-library/react | StatCard rendering |

## Deployment (Docker)

```yaml
# docker-compose.yml
services:
  server:   # Node 20 + Express + SQLite (port 3001)
  client:   # Vite dev server (port 5173, proxies /api to server)
```

- Ollama runs on the host; Docker containers reach it via `host.docker.internal:11434`
- SQLite database file is persisted via Docker volume or bind mount
- Uploads directory is shared between server container and static file serving
