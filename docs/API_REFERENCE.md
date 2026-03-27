# API Reference (v1)

This document lists the versioned REST and tRPC endpoints for the Tessera platform.

---

## 🚀 Namespace: `/api/v1`

All endpoints are prefixed with `/api/v1/`.

### 1. Authentication

**Auth transport**: All authenticated endpoints use **HttpOnly `SameSite=Lax` cookies** (`tessera_token`). JWT is set automatically on login/SSO and sent by the browser — no `Authorization` header needed. A companion `session_expires` cookie (non-HttpOnly) carries the Unix timestamp for client-side expiry detection.

`POST /api/v1/auth/login`
- **Body**: `{ "id": "user_id", "password": "..." }`
- **Response**: `{ "user": {...}, "memberships": [...], "activePartnerId": "..." }`
- **Cookie**: Sets `tessera_token` (HttpOnly) + `session_expires`
- **Note**: Legacy/Demo login via internal User ID.

`POST /api/v1/auth/login-local`
- **Body**: `{ "email": "...", "password": "...", "rememberMe": boolean }`
- **Response**: Same as `/login`.
- **Cookie**: Sets `tessera_token` (HttpOnly) + `session_expires`
- **Note**: Recommended login method for local users. Supports case-insensitive email.

`POST /api/v1/auth/forgot-password`
- **Body**: `{ "email": "..." }`
- **Response**: `{ "success": true, "message": "..." }`
- **Note**: Triggers a secure password reset email. Enumeration protected.

`POST /api/v1/auth/reset-password`
- **Body**: `{ "token": "...", "password": "..." }`
- **Response**: `{ "success": true, "message": "..." }`
- **Note**: Validates 1-hour token and updates password. Enforces password strength policy.

`POST /api/v1/auth/switch-partner`
- **Auth**: Required (HttpOnly cookie)
- **Body**: `{ "membershipId": "..." }`
- **Response**: `{ "activePartnerId": "...", "manifest": {...} }`
- **Cookie**: Sets new `tessera_token` scoped to the selected partner.

### 1b. SSO Authentication

`GET /api/v1/auth/sso/login`
- **Query Params**: `partnerId`
- **Response**: Redirects to Azure Entra ID login.

`GET /api/v1/auth/sso/callback`
- **Note**: Callback from Azure. Redirects to client with SSO payload in URL hash fragment.

### 2. Configuration
`GET /api/v1/config`
- **Query Params**: `partnerId` (optional)
- **Response**: Dynamic partner-aware configuration including business hours, upload limits, and allowed types.

### 3. Uploads
`POST /api/v1/uploads`
- **Auth**: Required (HttpOnly cookie)
- **Body**: `multipart/form-data` (file)
- **Response**: `{ "url": "/uploads/..." }`
- **Validation**: Magic-byte check via `file-type`.

### 4. Ticket Export (CSV)
`GET /api/v1/tickets/export`
- **Auth**: Required (HttpOnly cookie or token query param)
- **Query Params**: `dept`, `search`, `dateFrom`, `dateTo`
- **Response**: `text/csv` stream.

---

## 📡 tRPC Interface: `/api/v1/trpc`

The majority of application logic is handled via tRPC procedures.

### MFA Router (authenticated access)
- `mfa.getStatus`: Check if MFA is enabled for current user.
- `mfa.beginSetup`: Generate TOTP secret and QR URI.
- `mfa.enable`: Enable MFA with TOTP verification code. Returns 8 recovery codes.
- `mfa.disable`: Disable MFA (requires valid TOTP code).
- `mfa.regenerateRecoveryCodes`: Generate new recovery codes (requires TOTP verification).

### Canned Response Router (support/admin access)
- `cannedResponse.list`: List canned responses for current partner.
- `cannedResponse.create`: Create a new canned response (admin).
- `cannedResponse.update`: Update a canned response (admin).
- `cannedResponse.delete`: Delete a canned response (admin).

### Message Router (authenticated access)
- `message.list`: List messages for a ticket.
- `message.search`: Full-text search across message content.

### User Router (authenticated access)
- `user.changePassword`: Change own password with strength validation and history check.
- `user.getNotificationPrefs`: Get notification email preferences.
- `user.updateNotificationPrefs`: Update notification email opt-out settings.

### Platform Router (platform_operator access)
- `platform.getMailConfig`: Retrieves current global mail settings.
- `platform.updateMailConfig`: Updates SMTP/API provider credentials.
- `platform.sendTestEmail`: Triggers a verification email to a specified address.
- `platform.resendInvite`: Regenerates temp password and resends welcome email.
- `platform.deactivatePartner`: Sets partner status to inactive and kills sessions.
- `platform.getAuditLog`: Fetches paginated system and administrative audit events (cursor-based).
- `platform.exportAuditLog`: Generates a complete JSON dataset of filtered logs for CSV conversion.
- `platform.getSystemHealth`: Returns real-time Postgres/Redis metrics.
- `platform.disableUserMfa`: Force-disable MFA for a user (sends notification email).
- `platform.unlockUser`: Unlock a locked-out user account.
- `platform.getArchivedAuditLog`: Query WORM audit archive with cursor pagination.
- `platform.getArchivedTickets`: Query archived tickets with cursor pagination.
- `platform.verifyAuditChain`: Verify SHA-256 hash chain integrity.
- `platform.runArchive`: Manually trigger audit + ticket archival.

### Platform Security Router (platform_operator access)
- `platformSecurity.getStatus`: Check step-up TOTP status.
- `platformSecurity.beginSetup`: Generate platform TOTP secret for step-up setup.
- `platformSecurity.enable`: Enable platform step-up with TOTP verification.
- `platformSecurity.verify`: Verify step-up TOTP code (unlocks platform tabs for 15 min).

---

## 🔌 Socket.io Real-Time Interface

### 1. Messaging
- `message:send` / `message:new`: Standard chat messaging.
- `message:edit` / `message:edited`: Edit an existing message (own messages only, admins can edit any).
- `message:delete` / `message:deleted`: Soft-delete a message.
- `message:read`: Mark messages as read.
- `typing:start` / `typing:stop` / `typing:update`: Live input indicators.

### 2. Tickets
- `ticket:new` / `ticket:created`: Create a new support ticket.
- `ticket:close` / `ticket:closed`: Close a ticket.
- `ticket:reopen` / `ticket:reopened`: Reopen a closed ticket.
- `ticket:transfer` / `ticket:transferred`: Transfer a ticket to another support agent.
- `ticket:labels:update` / `ticket:labels:updated`: Update ticket labels.

### 3. Canned Responses
- `canned:list`: List canned responses for the current partner.
- `canned:create` / `canned:update` / `canned:delete`: CRUD operations (admin only).

### 4. Connection & Presence
- `socket:identify`: Maps socket to user identity and partner context.
- `support:join` / `support:joined`: Support specialist joins a ticket.
- `support:leave` / `support:left`: Support specialist leaves a ticket.
- `presence:update` / `presence:changed`: User presence status changes.

### 5. Kill Switches
- `partner:deactivated`: Broadcast to all partner members when a company is disabled.
- `user:deactivated`: Targeted broadcast to a specific User ID room, forcing immediate disconnection and session termination.
- `auth:expired`: Emitted when a socket's JWT has expired — client auto-reconnects (cookies sent automatically).

---

## 🏥 Health & Metrics

### Health Check
`GET /api/v1/health`
- **Response**: `{ "status": "ok", "database": "connected" }`

### Prometheus Metrics
`GET /metrics`
- **Response**: Standard Prometheus exposition format.
