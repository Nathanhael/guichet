# API Reference (v1)

This document lists the versioned REST and tRPC endpoints for the Tessera platform.

---

## 🚀 Namespace: `/api/v1`

All endpoints are prefixed with `/api/v1/`.

### 1. Authentication
`POST /api/v1/auth/login`
- **Body**: `{ "id": "user_id", "password": "..." }`
- **Response**: `{ "token": "...", "user": {...}, "memberships": [...], "activePartnerId": "..." }`
- **Note**: Legacy/Demo login via internal User ID.

`POST /api/v1/auth/login-local`
- **Body**: `{ "email": "...", "password": "...", "rememberMe": boolean }`
- **Response**: Same as `/login`.
- **Note**: Recommended login method for local users. Supports case-insensitive email.

`POST /api/v1/auth/forgot-password`
- **Body**: `{ "email": "..." }`
- **Response**: `{ "success": true, "message": "..." }`
- **Note**: Triggers a secure password reset email. Enumeration protected.

`POST /api/v1/auth/reset-password`
- **Body**: `{ "token": "...", "password": "..." }`
- **Response**: `{ "success": true, "message": "..." }`
- **Note**: Validates 1-hour token and updates password.

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

The majority of application logic is handled via tRPC procedures.

### Platform Router (platform_operator access)
- `platform.getMailConfig`: Retrieves current global mail settings.
- `platform.updateMailConfig`: Updates SMTP/API provider credentials.
- `platform.sendTestEmail`: Triggers a verification email to a specified address.
- `platform.resendInvite`: Regenerates temp password and resends welcome email.
- `platform.deactivatePartner`: Sets partner status to inactive and kills sessions.
- `platform.getAuditLog`: Fetches paginated system and administrative audit events (Supports `dateFrom`, `dateTo`, and various context filters).
- `platform.exportAuditLog`: Generates a complete JSON dataset of filtered logs for CSV conversion.
- `platform.getSystemHealth`: Returns real-time Postgres/Redis metrics.

---

## 🔌 Socket.io Real-Time Interface

### 1. Messaging & Indicators
- `message:send` / `message:new`: Standard chat messaging.
- `typing:start` / `typing:update`: Live input indicators.

### 2. Connection & Presence
- `socket:identify`: Maps socket to user identity and partner context.
- `support:join` / `support:left`: specialist lifecycle on tickets.

### 3. Kill Switches
- `partner:deactivated`: Broadcast to all partner members when a company is disabled.
- `user:deactivated`: Targeted broadcast to a specific User ID room, forcing immediate disconnection and session termination.

---

## 🏥 Health & Metrics

### Health Check
`GET /api/v1/health`
- **Response**: `{ "status": "ok", "database": "connected" }`

### Prometheus Metrics
`GET /metrics`
- **Response**: Standard Prometheus exposition format.
