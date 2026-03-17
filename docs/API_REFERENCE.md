# API Reference (v1)

This document lists the versioned REST and tRPC endpoints for the Tessera platform.

---

## 🚀 Namespace: `/api/v1`

All endpoints are prefixed with `/api/v1/`.

### 1. Authentication
`POST /api/v1/auth/login`
- **Body**: `{ "id": "user_id", "password": "..." }`
- **Response**: `{ "token": "...", "user": {...}, "memberships": [...], "activePartnerId": "..." }`

### 2. Configuration
`GET /api/v1/config`
- **Query Params**: `partnerId` (optional)
- **Response**: Dynamic partner-aware configuration including business hours, upload limits, and allowed types.

### 3. Uploads
`POST /api/v1/uploads`
- **Auth**: Required (Bearer Token)
- **Body**: `multipart/form-data` (file)
- **Response**: `{ "url": "/uploads/..." }`
- **Validation**: Magic-byte check via `file-type`.

### 4. Ticket Export (CSV)
`GET /api/v1/tickets/export`
- **Auth**: Required (Token via query param or header)
- **Query Params**: `dept`, `search`, `dateFrom`, `dateTo`, `token`
- **Response**: `text/csv` stream.

---

## 📡 tRPC Interface: `/api/v1/trpc`

The majority of application logic is handled via tRPC procedures. **Note**: All message-related results are normalized via `messageMapper` to ensure frontend compatibility.

---

## 🔌 Socket.io Real-Time Interface

Real-time communication is scoped to `ticket:{id}` and `partner:{id}` rooms.

### 1. Messaging
- `message:send`: Client sends a message.
- `message:new`: Server broadcasts message to the ticket room.
- `message:delivered`: Server confirms database persistence.
- `message:read`: Client notifies receipt of message.

### 2. Typing Indicators
- `typing:start`: Client indicates active input.
- `typing:stop`: Client indicates input inactivity.

### 3. Connection & Presence
- `support:join`: Specialist claims a ticket.
- `support:left`: Specialist disconnects from a ticket.
- `queue:position`: Real-time update for waiting agents.

---

## 🏥 Health & Metrics

### Health Check
`GET /api/v1/health`
- **Response**: `{ "status": "ok", "database": "connected", "llm": "connected" }`
- **Use Case**: Deployment ready-checks.

### Prometheus Metrics
`GET /metrics`
- **Auth**: None for localhost; `x-metrics-token` header required for external callers if `METRICS_TOKEN` is configured.
- **Response**: Standard Prometheus exposition format.
- **Note**: This endpoint is **not** versioned as it is for infrastructure monitoring.
