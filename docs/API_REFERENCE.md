# API Reference (v1)

This document lists the versioned REST and tRPC endpoints for the Tessera platform.

---

## 🚀 Namespace: `/api/v1`

All endpoints are prefixed with `/api/v1/`.

### 1. Authentication
`POST /api/v1/auth/login`
- **Body**: `{ "id": "user_id", "password": "..." }`
- **Response**: `{ "token": "...", "user": {...}, "memberships": [...], "activePartnerId": "..." }`
- **Note**: The endpoint filters out memberships for inactive partners. If all memberships belong to inactive partners, the login succeeds but restricts functionality.

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

### Partner Router (admin access)
- `partner.listMembers`: Returns paginated memberships and user data for the current partner.
- `partner.addMemberByEmail`: Adds an existing user to the partner with specified roles and departments.
- `partner.inviteExternalUser`: Creates a new user with a temporary password and adds them to the partner.
- `partner.removeMember`: Removes a user's membership (prevents self-removal and last-membership removal).
- `partner.updateMember`: Updates department assignments for a specific member.

### Platform Router (platform_operator access)
- `platform.deactivatePartner`: Sets partner status to inactive, auto-closes tickets, and broadcasts deactivation event.
- `platform.reactivatePartner`: Sets partner status back to active.
- `platform.getAuditLog`: Fetches paginated system and administrative audit events.
- `platform.getSystemHealth`: Returns real-time Postgres/Redis connection status and GDPR purge history.

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

### 4. Partner Events
- `partner:deactivated`: Broadcast to all clients connected to a deactivated partner, forcing them to disconnect active chat sessions gracefully.

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
