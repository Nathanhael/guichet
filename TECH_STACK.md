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

| Package | Version | Purpose |
|---|---|---|
| react | ^18.2.0 | UI framework |
| react-dom | ^18.2.0 | DOM rendering |
| tailwindcss | ^3.4.1 | Utility-first CSS |
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

## Architecture

### Server Layers

```
index.js                    Entry point, starts HTTP server
  └── app.js                Express app + Socket.io setup
        ├── config.js       Centralized env-based config
        ├── middleware/
        │   ├── auth.js     JWT verify + RBAC
        │   └── validator.js  express-validator wrapper
        ├── routes/         REST endpoints (auth, tickets, messages, labels, canned_responses, etc.)
        ├── services/
        │   ├── translate.js  Ollama translation + content-string cache
        │   └── llm.js       Ollama sentiment analysis + caching
        ├── db/
        │   ├── sqlite.js   DB init, query/get/run/transaction helpers
        │   ├── schema.sql  Table definitions + indexes
        │   └── seed.js     Demo data population
        └── utils/
            └── logger.js   Pino logger instance
```

### Socket.io Middleware Pipeline

1. **Business hours check** -- Rejects connections outside configured hours
2. **User identification** -- `socket:identify` registers userId, role, name on the socket
3. **Room management** -- Users join ticket-specific rooms on `expert:join`
4. **Translation** -- Messages auto-translated via Ollama before broadcast
5. **Whisper filtering** -- Whisper messages only sent to non-agent sockets in the room
6. **Delivery tracking** -- `message:delivered` / `message:read` events update timestamps and broadcast status

### Modular Admin Dashboard

The Admin View is a component-based architecture:

- **Orchestrator**: `AdminView.jsx` handles tab routing and global filter state
- **Feature Modules**:
  - `Stats/` -- KPI cards (StatsOverview), queue health (QueueHealth), online experts (OnlineExperts), trend charts (PerformanceTrends), satisfaction breakdown (SatisfactionByDept), department distribution (DeptDistribution), staffing demand (StaffingDemand), hour spotlight (HourSpotlight), day summary (DaySummary), AI perspective (LLMSummary)
  - `Performance/` -- Expert/agent leaderboards, peak hours
  - `Archive/` -- Searchable history with chat preview drawer
  - `Feedback/` -- Feedback management and CSAT breakdown
  - `Labels/` -- Tag management
- **Shared Library**: `StatCard`, `Panel`, `Stars`, `Icons`, `ChartTooltip`
- **Ticket Operations**: `TicketOperations.jsx` for direct ticket management

### Advanced UX & Real-time Features

- **Connection Management**: Socket.io auto-reconnect with exponential backoff (1s-5s), connection status tracked in Zustand (`connected`/`reconnecting`/`disconnected`), auto re-identification on reconnect
- **Message Receipts**: `deliveredAt` and `readAt` timestamps trigger real-time `message:status` socket events, with WhatsApp-style checkmark indicators in `MessageBubble`
- **Queue Position**: `queue:position` events broadcast live wait time estimates to agents based on queue size and average resolution time
- **In-chat Search**: Client-side message filtering with `<mark>` tag highlighting in message bubbles
- **Canned Responses**: `/` shortcut opens a quick-insert menu for experts, fetching from the `canned_responses` table
- **Closing Notes**: Experts can add resolution notes when closing a ticket, stored in `tickets.closingNotes`
- **Audio Notifications**: Chime for new tickets (expert) and new messages, with toggle controls

### Data Flow

1. **Unidirectional State** -- Zustand store -> React components
2. **Real-time Sync** -- Socket.io events update the store, which triggers re-renders
3. **Optimistic Updates** -- UI reflects changes immediately (e.g., feedback treatment)
4. **Stats Merging** -- The `/api/stats` endpoint merges live data (last 30 days) with pre-aggregated `daily_stats` for seamless historical charts

### Translation & Caching Strategy

1. Message arrives via `message:send` socket event
2. If sender and receiver languages differ, call Ollama REST API (10s timeout)
3. Translation result is cached in `translations_cache` table keyed by content string `${fromLang}:${toLang}:${text}`
4. Subsequent identical translations are served from cache (no LLM call)
5. Same-language messages skip translation entirely
6. On Ollama failure, original text is shown with "(translation unavailable)" indicator

### GDPR Purge Cycle

Runs on startup + every 24 hours:

1. Find tickets older than `GDPR_RETENTION_DAYS`
2. Aggregate their metrics into `daily_stats` rows (one per day)
3. Delete individual tickets, messages, and ratings
4. `daily_stats` rows are anonymized and retained indefinitely

### Error Handling & Security

- **Rate Limiting**: `express-rate-limit` guards `/api` (100/min), `/api/auth` (5/min), and `/api/stats/summary` (10/min)
- **Security Headers**: `helmet` enforces Content-Security-Policy, X-Content-Type-Options, etc.
- **Upload Validation**: `file-type` checks magic bytes on image uploads (not just MIME type)
- **Input Validation**: `express-validator` rejects malformed input at the route level with 400 responses
- **CSV Escaping**: Export function escapes formula-injection characters (`=`, `+`, `-`, `@`)
- **Backend Logging**: Express error middleware logs via pino and returns structured JSON errors
- **Frontend Fallbacks**: `ErrorBoundary.jsx` catches render errors. Socket disconnects show status indicators until restored
- **LLM Graceful Degradation**: Ollama translations timeout after 10s and fall back gracefully

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
