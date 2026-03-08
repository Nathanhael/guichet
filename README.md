# i-pxs Support

Local prototype of a live chat web app for telecom customer support (iKanbi Expert Chat). Agents can create support tickets and chat with experts in real-time, with automatic translation between Dutch, French, and English via a local LLM (Ollama).

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite 5 + Tailwind CSS 3 |
| State | Zustand |
| Realtime | Socket.io |
| Backend | Express.js (Node 20, ES modules) |
| CORS | cors middleware |
| Database | db.json (JSON file persistence) |
| IDs | uuid |
| Translation | Ollama REST API (gemmatranslate4b model) |
| Charts | Recharts (manager dashboard) |
| Upload | Multer (max 5 MB — PNG/JPG/WEBP) |
| Timezone | date-fns + date-fns-tz (Europe/Brussels) |
| i18n | Custom i18n (NL, FR, EN) |
| DevOps | Docker Compose, Concurrently |

## Project Structure

```
i-pxs-support/
├── client/                          # React frontend
│   ├── src/
│   │   ├── App.jsx                 # Main entry, role-based routing
│   │   ├── i18n.js                 # UI translations (EN, FR, NL)
│   │   ├── views/
│   │   │   ├── LoginView.jsx       # User selection + demo login
│   │   │   ├── AgentView.jsx       # Ticket creation + chat
│   │   │   ├── ExpertView.jsx      # Queue + multi-chat
│   │   │   └── ManagerView.jsx     # Stats dashboard + archive
│   │   ├── components/
│   │   │   ├── ChatWindow.jsx      # Main chat interface
│   │   │   ├── MessageBubble.jsx   # Message with original + translation
│   │   │   ├── TicketList.jsx      # Queue list
│   │   │   ├── BusinessHoursGuard.jsx  # Hours enforcement
│   │   │   ├── RatingModal.jsx     # Post-chat satisfaction rating
│   │   │   ├── FeedbackModal.jsx   # User feedback form
│   │   │   └── DarkModeToggle.jsx
│   │   ├── store/
│   │   │   └── useStore.js         # Zustand state management
│   │   └── hooks/
│   │       └── useSocket.js        # Socket.io connection + events
│   ├── vite.config.js
│   ├── tailwind.config.js
│   └── package.json
├── server/                          # Express + Socket.io backend
│   ├── index.js                    # Server entry, Socket.io setup
│   ├── db.js                       # JSON file read/write helpers
│   ├── db.json                     # Data store
│   ├── routes/
│   │   ├── tickets.js              # Ticket listing + filters
│   │   ├── messages.js             # Message history
│   │   ├── uploads.js              # File upload handling
│   │   ├── feedback.js             # Feedback submission
│   │   └── labels.js               # Ticket labels
│   ├── services/
│   │   └── translate.js            # Ollama translation + MD5 cache
│   ├── uploads/                    # Screenshot storage
│   └── package.json
├── docker-compose.yml
└── package.json                     # Root (concurrently)
```

## Installation & Setup

### Prerequisites

- Node.js 20+
- [Ollama](https://ollama.com/) installed and running

### Step 1 — Set up Ollama

```bash
# Start Ollama (Terminal 1)
ollama serve

# Download model (one-time)
ollama pull gemmatranslate4b
```

### Step 2 — Install dependencies

```bash
# From the root directory
npm install           # installs concurrently
npm run install:all   # installs client + server
```

### Step 3 — Start everything

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

### Step 4 — Open in browser

```
http://localhost:5173
```

Click on a demo user to log in (simulated auth — no real authentication).

## Configuration

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | Server port |
| `VITE_API_TARGET` | `http://localhost:3001` | Backend URL for Vite proxy |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama API endpoint |

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
- Rate expert (1–5 stars + comment) after closing a ticket
- Submit feedback and suggestions

### Expert

- View queue of waiting tickets with department filter (All / DSC / FOT)
- Join tickets and manage up to 4 chats simultaneously
- Multiple chat layouts: tabs, vertical split, or 2x2 grid
- Ticket preview before joining (read-only message view)
- **Persistent Sessions** — Rejoin active chats automatically after page refreshes
- See translated messages from agents
- **Whisper mode** — expert-to-expert hidden messages (not visible to agents)
- Set availability status (available, break, lunch, meeting)
- Add labels to tickets for categorization (create, assign, remove)
- Audio notification chime for new unhandled tickets (toggle on/off, persisted)
- Archive tab with search and department filter (paginated, 25 per load)
- Close tickets
- Participants list on each ticket with real-time status

### Manager

- **Statistics dashboard** (Dynamic filtering by date range & department):
  - **Global Filter Bar** — Real-time recalculation of all metrics and charts
  - **KPI Cards** — Visual overview of 6 key metrics (Total Tickets, Response Time, Avg Duration, Satisfaction, Abandoned Count, Dept Health)
  - **Tickets Trend** — Line chart with DSC/FOT breakdown per day
  - **Peak Hours** — Hourly distribution bar chart
  - **Performance** — Expert task counts and peak active agent rankings
  - **Queue health** — Monitor oldest waiting time and SLA breaches (>10 min)
- **Real-time Synchronization** — Monitor open tickets and see participant changes immediately
- Join tickets as observer (full read + chat access)
- Search archived tickets (by agent, expert, date range, reference, department, or labels)
- Export filtered archived tickets to CSV
- Review user feedback, mark as treated, or hide dismissed entries
- Manage and curate ticket labels (custom text and colors)

## Business Hours

Chat is available **Monday through Sunday, 07:30–22:30** (Europe/Brussels).
Enforced both server-side (Socket.io middleware) and client-side.

## Languages & Translation

Agents and experts each have their own language (NL, FR, EN). Messages are automatically translated via Ollama when sender and receiver languages differ. Translations are cached using MD5 hashes in `db.json` to avoid repeated LLM calls.

Same language → no Ollama call.

## Demo Users

| Name | Role | Language | Department |
|---|---|---|---|
| Jan | Agent | NL | DSC |
| Marie | Agent | FR | FOT |
| Tom | Agent | EN | DSC |
| Piet | Expert | NL | — |
| Sophie | Expert | FR | — |
| Alex | Expert | EN | — |
| Dirk | Manager | NL | — |

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/users` | All demo users |
| GET | `/api/tickets` | Tickets (filter: `agentId`, `status`, `dept`, `search`, `limit`, `offset`, `dateFrom`, `dateTo`) |
| GET | `/api/export` | Export tickets as CSV (applies same filters as `/api/tickets`) |
| GET | `/api/messages` | All messages (optional filter: `ticketId`) |
| GET | `/api/tickets/:id/messages` | Messages for a ticket |
| POST | `/api/uploads` | Upload screenshot |
| GET | `/api/stats` | Manager statistics |
| GET | `/api/online/:userId` | Check user online status |
| GET | `/api/ratings` | All satisfaction ratings |
| GET | `/api/feedback` | Feedback entries |
| PATCH | `/api/feedback/:id/treat` | Mark feedback as treated |
| GET | `/api/labels` | Available ticket labels |
| POST | `/api/labels` | Create a new label (`{ text, color }`) |
| DELETE | `/api/labels/:id` | Delete a label |
| POST | `/api/feedback` | Submit feedback (`{ userId, userName, role, text }`) |
| GET | `/uploads/:filename` | Retrieve uploaded image |

## Socket.io Events

### Client → Server

| Event | Description |
|---|---|
| `socket:identify` | Register user after login |
| `ticket:new` | Create new ticket |
| `expert:join` | Expert joins a ticket |
| `message:send` | Send chat message (triggers translation) |
| `ticket:close` | Close ticket |
| `rating:submit` | Agent rates expert |
| `ticket:labels:update` | Expert tags ticket with labels |
| `status:set` | Expert changes availability |
| `typing:start` / `typing:stop` | Typing indicators |
| `reaction:toggle` | Add/remove emoji reaction |

### Server → Client

| Event | Description |
|---|---|
| `ticket:created` | New ticket broadcast to experts |
| `ticket:created:self` | Confirmation back to agent |
| `expert:joined` | Expert joined notification + participants list |
| `expert:left` | Expert left notification + updated participants list |
| `ticket:history` | Load past messages on join (whispers filtered for agents) |
| `message:new` | New message + translation (whispers only to non-agent sockets) |
| `ticket:closed` | Ticket closed notification (triggers rating modal for agent) |
| `ticket:updated` | Ticket field changes broadcast to all |
| `ticket:labels:updated` | Label changes broadcast to ticket room |
| `typing:update` | Typing indicator state change |
| `experts:online` | Updated online expert list with statuses |
| `agent:status` | Agent online/offline status per ticket |
| `reaction:updated` | Reaction changes |
| `rating:saved` | Rating confirmation to agent |
| `hours:closed` | Outside business hours rejection |

## Constants & Limits

| Constant | Value |
|---|---|
| Business hours | 07:30–22:30 (Europe/Brussels, daily) |
| Departments | DSC (Billing & Sales), FOT (Technical) |
| Max open chats (expert) | 4 |
| Max file upload size | 5 MB |
| Archive page size | 25 tickets |
| Stats refresh interval | 30 seconds |
| Typing timeout | 2000 ms |
| Reaction emojis | 6 types |
| Expert statuses | available, break, lunch, meeting |
| Ticket statuses | open, active, closed |
