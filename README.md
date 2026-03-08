# i-pxs Support

Local prototype of a live chat web app where telecom agents can ask questions to experts.
Messages are automatically translated via Ollama (local LLM).

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite + Tailwind CSS |
| State | Zustand |
| Realtime | Socket.io |
| Backend | Express.js (Node 20) |
| Database | db.json (JSON file) |
| Translation | Ollama REST API (port 11434, model: gemma3:4b) |
| Upload | multer (max 5 MB, PNG/JPG/WEBP) |
| Timezone | date-fns-tz (Europe/Brussels) |

## Project Structure

```
i-pxs-support/
├── client/                  # React frontend
│   ├── src/
│   │   ├── views/           # LoginView, AgentView, ExpertView, ManagerView
│   │   ├── components/      # ChatWindow, TicketList, MessageBubble, BusinessHoursGuard
│   │   ├── store/           # Zustand store
│   │   └── hooks/           # useSocket
│   ├── vite.config.js
│   └── package.json
├── server/                  # Express + Socket.io backend
│   ├── routes/              # tickets, messages, uploads
│   ├── services/            # translate.js (Ollama)
│   ├── db.js                # JSON file helpers
│   ├── db.json              # data store
│   ├── uploads/             # uploaded screenshots
│   └── package.json
└── package.json             # root (concurrently)
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
ollama pull gemma3:4b
```

### Step 2 — Install dependencies

```bash
# From the root directory (i-pxs-support/)
npm install           # installs concurrently
npm run install:all   # installs client + server
```

### Step 3 — Start everything

```bash
# All at once via root (Terminal 2)
npm run dev
```

Or separately:

```bash
# Terminal 2 — Server (port 3001)
cd server && npm run dev

# Terminal 3 — Client (port 5173)
cd client && npm run dev
```

### Step 4 — Open in browser

```
http://localhost:5173
```

Click on a user to log in (simulated auth).

## Roles

| Role | Functionality |
|---|---|
| **Agent** | Create ticket (DSC/FOT), attach screenshot, chat with expert |
| **Expert** | View queue, join tickets, multiple chats simultaneously, close ticket |
| **Manager** | Statistics dashboard, monitor open tickets, search archive |

## Business Hours

Chat is available **Monday through Sunday, 07:30–22:30** (Europe/Brussels).
The check is enforced both on the server (Socket.io middleware) and in the frontend.

## Languages & Translation

Agents and experts can each have their own language (NL, FR, EN).
Messages are automatically translated via Ollama. Translations are cached in `db.json`
to avoid repeated Ollama calls.

Same language → no Ollama call.

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/users` | All demo users |
| GET | `/api/tickets` | Tickets (filter: `agentId`, `status`) |
| GET | `/api/tickets/:id/messages` | Messages for a ticket |
| POST | `/api/uploads` | Upload screenshot |
| GET | `/api/stats` | Manager statistics |
| GET | `/uploads/:filename` | Retrieve uploaded image |

## Socket.io Events

| Event | Direction | Description |
|---|---|---|
| `ticket:new` | client → server | Create new ticket |
| `ticket:created:self` | server → agent | Confirmation to agent |
| `ticket:created` | server → all | Ticket added to expert queue |
| `expert:join` | expert → server | Expert joins a ticket |
| `expert:joined` | server → room | Notification "Expert X joined the chat" |
| `ticket:history` | server → expert | Existing messages on join |
| `message:send` | client → server | Send a message |
| `message:new` | server → room | Message + translation |
| `ticket:close` | client → server | Close ticket |
| `ticket:closed` | server → room | Chat closed for both sides |
| `hours:closed` | server → client | Outside business hours |
