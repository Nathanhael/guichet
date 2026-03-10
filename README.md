# M&P Support

Local prototype of a live chat web app for telecom customer support (iKanbi M&P Support). Agents can create support tickets and chat with experts in real-time, with automatic translation between Dutch, French, and English via a local LLM (Ollama).

## Documentation & Design

For a detailed look at the system architecture, tech stack, and usage:
- **[ARCHITECTURE.md](./ARCHITECTURE.md)** -- System design, real-time flows, and AI pipeline.
- **[TECH_STACK.md](./TECH_STACK.md)** -- Dependencies, database schema, and authentication details.
- **[USER_GUIDE.md](./USER_GUIDE.md)** -- Guide for demo personas and cognitive features.
- **[CONTRIBUTING.md](./CONTRIBUTING.md)** -- Aesthetic (Solaris) and coding standards.

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite 5 + Tailwind CSS 3 + Framer Motion |
| Language | TypeScript |
| State | Zustand |
| Realtime | Socket.io |
| Backend | Node 20 (ESM), Express.js |
| Security | Helmet, express-rate-limit, file-type |
| Database | SQLite via better-sqlite3 |
| Auth | JWT (jsonwebtoken) + bcrypt |
| Validation | express-validator + CSV escaping |
| Logging | pino (+ pino-pretty in dev) |
| Translation | Ollama REST API (graceful fallback) |
| Charts | Recharts (admin dashboard) |
| Icons | lucide-react |
| Upload | Multer (max 5 MB -- PNG/JPG/WEBP, magic byte verified) |
| Timezone | date-fns + date-fns-tz (Europe/Brussels) |
| i18n | Custom i18n (NL, FR, EN) + Language Switcher |
| Accessibility | **Neuro-Inclusive**: Dyslexic Mode (Lexend), Bionic Reading |
| Testing | Vitest + supertest + @testing-library/react |
| DevOps | Docker Compose, Concurrently |

## Project Structure

```
mp-support/
├── client/                              # React frontend
│   ├── src/
│   │   ├── App.jsx                     # Main entry, role-based routing
│   │   ├── config.js                   # Frontend constants (socket URL, limits)
│   │   ├── i18n.js                     # UI translations (EN, FR, NL)
│   │   ├── views/
│   │   │   ├── LoginView.jsx           # User selection + login
│   │   │   ├── AgentView.jsx           # Ticket creation + chat
│   │   │   ├── ExpertView.jsx          # Queue + multi-chat
│   │   │   └── AdminView.jsx           # Modular dashboard orchestrator
│   │   ├── components/
│   │   │   ├── ChatWindow.jsx          # Main chat interface (search, canned responses)
│   │   │   ├── CannedResponsePicker.jsx # Quick-insert menu for experts
│   │   │   ├── MessageBubble.jsx       # Message with translation + delivery status
│   │   │   ├── TicketList.jsx          # Queue list
│   │   │   ├── TicketPreview.jsx       # Ticket preview
│   │   │   ├── BusinessHoursGuard.jsx  # Hours enforcement
│   │   │   ├── RatingModal.jsx         # Post-chat satisfaction rating
│   │   │   ├── FeedbackModal.jsx       # User feedback form
│   │   │   ├── ErrorBoundary.jsx       # React error boundary
│   │   │   ├── DarkModeToggle.jsx
│   │   │   └── admin/                  # Specialized dashboard modules
│   │   │       ├── TicketOperations.jsx
│   │   │       ├── Stats/              # KPI cards, queue health, trends, AI summaries
│   │   │       ├── Performance/        # Leaderboards, peak hours
│   │   │       ├── Archive/            # History & chat preview drawer
│   │   │       ├── Feedback/           # CSAT & feedback management
│   │   │       ├── Labels/             # Tag management
│   │   │       └── shared/             # Common UI (StatCard, Panel, Icons, etc.)
│   │   ├── store/
│   │   │   └── useStore.js             # Zustand state management
│   │   ├── hooks/
│   │   │   └── useSocket.js            # Socket.io connection + events + reconnection
│   │   └── test/
│   │       └── setup.js                # Test configuration
│   ├── vite.config.js
│   ├── tailwind.config.js
│   └── package.json
├── server/                              # Express + Socket.io backend
│   ├── index.js                        # Server entry point
│   ├── app.js                          # Express app, Socket.io, stats, export, GDPR purge
│   ├── config.js                       # Centralized configuration (env vars + defaults)
│   ├── db.js                           # SQLite wrapper export
│   ├── db/
│   │   ├── sqlite.js                   # SQLite initialization & query helpers
│   │   ├── schema.sql                  # Database schema (11 tables, indexed)
│   │   ├── seed.js                     # Demo data seeding
│   │   ├── migrate.js                  # JSON -> SQLite migration
│   │   └── apply_schema_updates.js     # Schema evolution script
│   ├── middleware/
│   │   ├── auth.js                     # JWT authentication + RBAC
│   │   └── validator.js                # Input validation middleware
│   ├── routes/
│   │   ├── auth.js                     # Register & login endpoints
│   │   ├── tickets.js                  # Ticket listing + filters
│   │   ├── messages.js                 # Message history
│   │   ├── uploads.js                  # File upload (magic byte validated)
│   │   ├── feedback.js                 # Feedback submission
│   │   ├── labels.js                   # Ticket labels
│   │   └── canned_responses.js         # Canned response management
│   ├── services/
│   │   ├── translate.js                # Ollama translation + cache (graceful fallback)
│   │   └── llm.js                      # Ollama LLM sentiment analysis
│   ├── utils/
│   │   └── logger.js                   # Pino structured logging
│   ├── __tests__/                      # Backend test suites
│   │   ├── api.test.js
│   │   ├── auth.test.js
│   │   └── stats.test.js
│   ├── uploads/                        # Screenshot storage
│   ├── Dockerfile
│   └── package.json
├── .env.example                         # Environment variable template
├── docker-compose.yml
└── package.json                         # Root (concurrently)
```

## Installation & Setup

### Prerequisites

- Node.js 20+
- [Ollama](https://ollama.com/) installed and running

### Step 1 -- Set up Ollama

```bash
# Start Ollama (Terminal 1)
ollama serve

# Download model (one-time)
ollama pull gemmatranslate4b
```

### Step 2 -- Configure environment

Copy `.env.example` to `.env` and adjust values if needed (defaults work for local development).

```bash
cp .env.example .env
```

### Step 3 -- Install dependencies

```bash
# From the root directory
npm install           # installs concurrently
npm run install:all   # installs client + server
```

### Step 4 -- Start everything

```bash
# All at once (Terminal 2)
npm run dev
```

Or separately:

```bash
cd server && npm run dev   # port 3001
cd client && npm run dev   # port 5173
```

Or with Docker:

```bash
docker-compose up
```

### Step 5 -- Run Tests (Optional)

The project includes Vitest suites for both backend and frontend.

```bash
# Run backend tests
docker-compose exec server npm test

# Run frontend tests
docker-compose exec client npm test
```

### Step 6 -- Open in browser

```
http://localhost:5173
```

Select a demo user to log in.

## Configuration

All settings are configurable via environment variables. See `.env.example` for the full list.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | Server port |
| `CORS_ORIGIN` | `http://localhost:5173` | Allowed CORS origin |
| `OLLAMA_HOST` | `http://host.docker.internal:11434` | Ollama API endpoint |
| `JWT_SECRET` | `super-secret-key-replace-in-prod` | JWT signing secret |
| `JWT_EXPIRY` | `24h` | JWT token lifetime |
| `DB_PATH` | `./database.sqlite` | SQLite database path |
| `GDPR_RETENTION_DAYS` | `30` | Days before individual data is purged |
| `LOG_LEVEL` | `info` | Pino log level |
| `BUSINESS_HOURS_START` | `07:30` | Chat availability start (Europe/Brussels) |
| `BUSINESS_HOURS_END` | `22:30` | Chat availability end (Europe/Brussels) |

## Roles & Features

### Agent

- Create tickets with department (DSC / FOT) and case reference (CDBID or Dare Ref)
- Upload screenshots (up to 5 MB) or paste from clipboard (Ctrl+V)
- Chat with assigned expert in real-time
- Messages auto-translated to expert's language
- Toggle translation visibility on received messages (show original vs translated)
- Message reactions (6 emoji types)
- Typing indicators
- Unread message count badge
- Message delivery indicators (sent / delivered / read)
- Rate expert (1-5 stars + comment) after closing a ticket
- Submit feedback and suggestions

### Expert

- View queue of waiting tickets with department filter (All / DSC / FOT)
- Join tickets and manage up to 4 chats simultaneously
- Multiple chat layouts: tabs, vertical split, or 2x2 grid
- Ticket preview before joining (read-only message view)
- **Persistent Sessions** -- Rejoin active chats automatically after page refreshes
- See translated messages from agents
- **Whisper mode** -- expert-to-expert hidden messages (not visible to agents)
- **Canned responses** -- Quick-insert predefined replies via `/` shortcut
- **In-chat search** -- Find messages within a conversation
- Set availability status (available, break, lunch, meeting)
- Add labels to tickets for categorization (create, assign, remove)
- **Label Uniqueness** -- Database prevents case-variant duplicate labels (e.g., "Billing" vs "billing")
- **Safe Deletion** -- Cascading deletes allow removing labels even if they are assigned to tickets
- Audio notification chime for new unhandled tickets (toggle on/off, persisted)
- Add closing notes when resolving a ticket
- Archive tab with search and department filter (paginated, 25 per load)
- Close tickets
- Participants list on each ticket with real-time status

### Admin

- **Statistics dashboard** (Dynamic filtering by date range & department):
  - **Global Filter Bar** -- Real-time recalculation of all metrics and charts
  - **Preset Date Ranges** -- Quick filters: Today, 7D, 14D, 30D
  - **KPI Cards with Trend Arrows** -- 6 key metrics (Total Tickets, Response Time, Avg Duration, Satisfaction, Abandoned, SLA Health) with previous-period comparison indicators (green = improvement, red = regression)
  - **Smart Trend Grouping** -- Daily points (<=30 days), weekly aggregation (31-90 days), or monthly aggregation (>90 days), with dynamic chart title
  - **Satisfaction by Department** -- DSC vs FOT rating breakdown with dept-colored cards
  - **Peak Hours** -- Hourly distribution bar chart
  - **Department Distribution** -- Visual breakdown of ticket volume by department
  - **Staffing Demand** -- Insights into expert coverage needs
  - **Expert & Agent Performance** -- Scrollable side-by-side bar charts with total + today breakdown
  - **Queue health** -- Monitor oldest waiting time and SLA breaches (>3 min)
  - **AI Support Perspective** -- Local LLM integration providing automated sentiment analysis, top 3 recurring issues, and qualitative summaries for any selected period
  - **Topic Summary** -- Qualitative overview showing the most used labels per department
- **Real-time Synchronization** -- Monitor open tickets and see participant changes immediately
- Join tickets as observer (full read + chat access)
- Search archived tickets (by agent, expert, date range, reference, department, or labels)
- Export filtered archived tickets to CSV (with proper escaping)
- **Review user feedback**, mark as treated, or hide dismissed entries
- **Manage and curate ticket labels** (custom text and colors)
- **Manage canned responses** (predefined text shortcuts for experts)

## Business Hours

Chat is available daily during configured hours (default **07:30-22:30**, Europe/Brussels).
Enforced both server-side (Socket.io middleware) and client-side.

## Neuro-Inclusive Design

The application features a dedicated "Cognitive & Neuro-Inclusive Cockpit" accessible from the header:

- **Dyslexic Mode**: Uses the **Lexend** font family, which was specifically designed to reduce visual stress and improve reading performance for dyslexic readers. It also increases line height and character spacing.
- **Bionic Reading**: Implements fixation points by bolding the first few letters of each word. This guides the eye through the text, making reading more efficient and reducing cognitive load.
- **Language-Specific Bionic Reading**: Adjusts fixation points based on the selected language (EN, NL, FR) for optimal brain processing.
- **Calm UI**: High-contrast dark mode support and balanced color palettes to minimize anxiety and visual overstimulation.

## Languages & Translation

Agents and experts each have their own language (NL, FR, EN). A **Language Switcher** in the header allows users to change their preferred interface language at any time. Messages are automatically translated via Ollama when sender and receiver languages differ. Translations are cached in the `translations_cache` table keyed by `{fromLang}:{toLang}:{text}` to avoid repeated LLM calls. When Ollama is unavailable, the original message is shown with a "(translation unavailable)" note.

Same language = no Ollama call.

## Demo Users

| Name | Role | Language | Department |
|---|---|---|---|
| Alice Agent | Agent | EN | DSC |
| Bob Agent | Agent | NL | FOT |
| Charlie Agent | Agent | NL | DSC |
| David Agent | Agent | FR | FOT |
| Eva Agent | Agent | EN | DSC |
| Frank Agent | Agent | NL | FOT |
| Grace Agent | Agent | FR | DSC |
| Harry Agent | Agent | EN | FOT |
| Ivy Agent | Agent | NL | DSC |
| Jack Agent | Agent | FR | FOT |
| Expert Zoe | Expert | FR | -- |
| Expert Yann | Expert | EN | -- |
| Expert Xander | Expert | NL | -- |
| Dirk Admin | Admin | NL | -- |

## API Endpoints

### Authentication

| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/register` | Register a new user (`{ id, name, role, password }`) |
| POST | `/api/auth/login` | Login, returns JWT token + user object |

### Resources

| Method | Path | Description |
|---|---|---|
| GET | `/api/config` | Frontend configuration (limits, hours) |
| GET | `/api/health` | Service health (DB + Ollama status) |
| GET | `/api/users` | All demo users |
| GET | `/api/tickets` | Tickets (filter: `agentId`, `status`, `dept`, `search`, `limit`, `offset`, `dateFrom`, `dateTo`) |
| GET | `/api/export` | Export tickets as CSV (same filters as `/api/tickets`) |
| GET | `/api/messages` | All messages (optional filter: `ticketId`) |
| GET | `/api/tickets/:id/messages` | Messages for a ticket |
| POST | `/api/uploads` | Upload screenshot (magic byte validated) |
| GET | `/api/stats` | Admin statistics (merges live + historical data, supports `dateFrom`, `dateTo`, `dept`) |
| GET | `/api/stats/summary` | LLM sentiment analysis + summary for selected period |
| GET | `/api/online/:userId` | Check user online status |
| GET | `/api/ratings` | All satisfaction ratings |
| GET | `/api/feedback` | Feedback entries |
| POST | `/api/feedback` | Submit feedback (`{ userId, userName, role, text }`) |
| PATCH | `/api/feedback/:id/treat` | Mark feedback as treated |
| GET | `/api/labels` | Available ticket labels |
| POST | `/api/labels` | Create a new label (`{ text, color }`) |
| DELETE | `/api/labels/:id` | Delete a label (cascades to ticket_labels) |
| GET | `/api/canned-responses` | Available canned responses |
| POST | `/api/canned-responses` | Create a canned response (`{ shortcut, text }`) |
| DELETE | `/api/canned-responses/:id` | Delete a canned response |
| GET | `/uploads/:filename` | Retrieve uploaded image |

## Socket.io Events

### Client -> Server

| Event | Description |
|---|---|
| `socket:identify` | Register user after login |
| `ticket:new` | Create new ticket |
| `expert:join` | Expert joins a ticket |
| `expert:leave` | Expert leaves a ticket |
| `message:send` | Send chat message (triggers translation) |
| `message:delivered` | Confirm message delivery |
| `message:read` | Mark messages as read |
| `ticket:close` | Close ticket (with optional closing notes) |
| `rating:submit` | Agent rates expert |
| `ticket:labels:update` | Expert tags ticket with labels |
| `status:set` | Expert changes availability |
| `typing:start` / `typing:stop` | Typing indicators |
| `reaction:toggle` | Add/remove emoji reaction |

### Server -> Client

| Event | Description |
|---|---|
| `ticket:created` | New ticket broadcast to experts |
| `ticket:created:self` | Confirmation back to agent |
| `expert:joined` | Expert joined notification + participants list |
| `expert:left` | Expert left notification + updated participants list |
| `ticket:history` | Load past messages on join (whispers filtered for agents) |
| `message:new` | New message + translation (whispers only to non-agent sockets) |
| `message:status` | Delivery/read status update |
| `ticket:closed` | Ticket closed notification (triggers rating modal for agent) |
| `ticket:updated` | Ticket field changes broadcast to all |
| `ticket:labels:updated` | Label changes broadcast to ticket room |
| `typing:update` | Typing indicator state change |
| `experts:online` | Updated online expert list with statuses |
| `agent:status` | Agent online/offline status per ticket |
| `reaction:updated` | Reaction changes |
| `rating:saved` | Rating confirmation to agent |
| `queue:position` | Queue position + wait time estimate for agents |
| `hours:closed` | Outside business hours rejection |

## GDPR Data Retention

Individual customer data (tickets, messages, ratings with names/CDBIDs) is automatically purged after **30 days**. Before deletion, data is aggregated into anonymized daily statistics (`daily_stats` table) that are retained for longer historical analysis.

| Data | Retention |
|---|---|
| Individual tickets, messages, ratings | 30 days |
| Anonymized daily aggregates (`daily_stats`) | Indefinite |
| Translation cache | Indefinite (already anonymized) |

The purge runs automatically on server startup and every 24 hours. The stats endpoint seamlessly merges live data (last 30 days) with historical aggregates for trend charts spanning the boundary.

## Constants & Limits

| Constant | Value |
|---|---|
| Business hours | 07:30-22:30 (Europe/Brussels, daily) |
| Departments | DSC (Billing & Sales), FOT (Technical) |
| Max open chats (expert) | 4 |
| Max file upload size | 5 MB |
| Archive page size | 25 tickets |
| Stats refresh interval | 30 seconds |
| Typing timeout | 2000 ms |
| Reaction emojis | 6 types |
| Expert statuses | available, break, lunch, meeting |
| Ticket statuses | open, active, closed |
| GDPR data retention | 30 days (individual data) |
| GDPR purge interval | Every 24 hours + on startup |
| JWT token expiry | 24 hours |
| SLA threshold | 3 minutes |
| Rate limit (global) | 100 requests/min |
| Rate limit (auth) | 5 requests/min |
| Rate limit (LLM) | 10 requests/min |
