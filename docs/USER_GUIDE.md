# User Guide: Guichet Platform (Clean Slate)

Welcome to Guichet. This guide explains the core chat functionality, dynamic organizational structure, and the strict monochrome interface.

---

## 1. Roles & Responsibilities

1.  **Platform Operator**: Global administrator. Manages the Partner ecosystem, infrastructure configuration, global user lifecycle, and system audits.
2.  **Partner Admin**: Manages organization-specific settings and team members (invite internal/external users, assign departments).
3.  **Support Specialist**: Handles incoming tickets and communicates with agents within their assigned departments.
4.  **Agent**: Creates tickets and communicates with support.

---

## 2. Authentication

### Standard Login
- Access the platform via `http://localhost:3001` (or your production URL).
- Click **"Sign in with Microsoft"** and complete the Azure OIDC flow.
- Partner employees without a corporate tenant can be invited as Azure B2B guests and sign in with their home IdP (Microsoft, Google, or another federated provider).
- No local passwords. MFA is enforced at the Azure tenant level, not by Guichet.

### Lost Access
- If you cannot log in, contact your platform operator. They will verify your Azure account is provisioned and that your partner membership is active.
- If SSO itself is down, platform operators can use the break-glass CLI (`docs/BREAK_GLASS_RUNBOOK.md`) to mint a short-lived JWT for emergency administration.

### Notification Preferences
- Open the Settings popover (gear icon in the navbar) to toggle in-app notification categories.
- All notifications are enabled by default (opt-out model).

---

### Platform Administration (Global Control)

Platform Operators use the **PlatformView** to manage the entire ecosystem.

**Access Note**: Platform operators sign in through the same Azure SSO button as everyone else — the `is_platform_operator` flag on their user row unlocks PlatformView after login. Emergency access uses the break-glass CLI; see `docs/BREAK_GLASS_RUNBOOK.md`.

### Partners Tab

- Manage Active vs Inactive tenants. Inactive partners block logins and gracefully close open sessions.

### Users Tab
- **Onboarding Status**: Track users as **Linked (SSO)** (an Azure OID is stamped on the user) or **Pending** (invited but not yet signed in).
- **Activity Monitoring**: The **Last Active** column shows the precise time of each user's last interaction.
- **Revoke Sessions**: Force sign-out all active sessions (and refresh tokens) for a user.
- **Global Search & Management**: Edit profiles, manage cross-tenant access, or perform global deletions.

### Health Tab
- **Live Metrics**: Real-time monitoring of Postgres active connections and Redis memory usage.
- **GDPR Monitoring**: View the last-run time and success status of the automated data purge.

### Config Tab
- **System settings**: Global toggles and tuning parameters that apply to every partner.

### Audit Log
- **Traceability**: Track every administrative change with granular `from -> to` diffs.
- **Advanced Filtering**: Filter logs by Action, Partner, Actor, and Target ID. You can also specify a **From Date** and **To Date** to narrow down the audit window.
- **Enterprise Pagination**: Navigate through large datasets using cursor-based keyset pagination.
- **Compliance Export**: Download the filtered log (including date ranges) as a CSV for offline auditing.

### Archive Tab
- **Audit Archive**: Browse the tamper-evident WORM audit archive with SHA-256 hash chain.
- **Ticket Archive**: View archived closed tickets with message count summaries.
- **Chain Verification**: Verify the integrity of the audit hash chain.
- **Manual Archive**: Trigger an immediate archive run.

---

## 4. Partner Administration

Partner Admins use the **AdminView** to manage their local workspace:
- **Team Tab**: Manage users specific to the partner. Invite existing platform users or invite new external users — all invites are SSO-only; the user's first Microsoft sign-in links their Azure OID to the invited row. External (Azure B2B guest) admins show a `GUEST` badge next to their name — they have read access to every admin panel but are blocked from destructive mutations (webhook secrets, department edits, team-member add/remove/update). Have a full-rights admin perform those actions or promote the user internally if that's the intent.
- **Departments Tab**: Create and update the names and descriptions of support departments.
- **Tickets Tab**: Browse and manage all partner tickets.
- **Business Hours Tab**: Configure operating hours per day. Outside hours, agents see a "business hours" guard and queue position.
- **Labels Tab**: Create colored labels for ticket categorization.
- **Canned Responses Tab**: Create, edit, and delete response templates for support agents. Each response has a title, body, optional shortcut key, and optional category.
- **Knowledge Base Tab**: Create and manage help articles organized by category. Articles are available to support staff for reference.
- **Webhooks Tab**: Configure webhook endpoints that receive events (ticket created, closed, etc.) with HMAC signature verification. View delivery logs.
- **Alerts Tab**: Set up alert rules for SLA breaches and topic monitoring with configurable thresholds and recipients.
- **SLA Policies**: Configure per-department response and resolution time targets. Toggle business-hours-only mode to pause the SLA clock outside operating hours.
- **Stats Tab**: View partner analytics including ticket volumes, response times, SLA compliance, and sentiment trends (Recharts dashboards).
- **Feedback Tab**: Review in-app user feedback submitted via the feedback modal.

---

## 5. Support Workflows

Support Specialists use the **SupportView** to handle tickets:

### Queue & Search
- Tickets are organized by department in the left sidebar.
- Use the **search bar** to search across message content within your partner's tickets.
- Toggle between open/closed ticket views.

### Chat Features
- **Canned Responses**: Type `/` in the message input to open the response picker. Select a template to insert its body into the message field.
- **Message Edit**: Click the edit icon on your own messages to modify them. Edited messages show an "edited" indicator.
- **Message Delete**: Click the delete icon to soft-delete a message. Admins can delete any message.
- **Whisper Mode**: Toggle whisper mode to send internal-only messages visible only to support staff.
- **Ticket Transfer**: Click the transfer button to hand off a ticket to another online support agent.
- **Customer Info Panel**: View agent details, reference fields, and past ticket history in the right sidebar.
- **CSAT Ratings**: When a ticket is closed, agents are auto-prompted to rate their support experience. Support admins can view per-agent satisfaction scores with date filtering in the Stats dashboard.

### Keyboard Shortcuts

Support Specialists can use high-traffic shortcuts to speed up ticket handling. The **Ctrl+K** nav badge in the top-right doubles as a button to open the command palette, which serves as a live cheat sheet for all bindings.

- **Navigation**:
  - `Ctrl+K` or `?` — Open Command Palette
  - `Ctrl+ArrowDown` / `Ctrl+ArrowUp` — Next/Previous chat tab
  - `Ctrl+1..9` — Jump directly to chat tab N
  - `Alt+Left` / `Alt+Right` — Jump to next/previous unread chat tab
  - `Ctrl+B` — Toggle Queue Sidebar
  - `Ctrl+F` — Open message search within the active ticket
  - `Esc` — Exit focus mode (when active)
  - `Ctrl+Shift+F` — Toggle focus mode
- **Actions**:
  - `Ctrl+Enter` — Close current ticket (opens confirmation)
  - `Alt+T` — Transfer ticket to another agent
  - `Alt+W` — Close current chat tab
  - `Ctrl+/` — Toggle whisper mode (internal-only messages)
  - `Ctrl+L` or `Alt+L` — Open label picker
  - `Ctrl+J` or `Alt+J` — Open canned response picker
  - `Ctrl+Shift+A` — Toggle AI Copilot sidebar
  - `Ctrl+.` — Open status picker (Online/Away/Offline)
  - `/` (when not typing) — Focus the message input

---

### AI Features

AI features are controlled per partner by platform admins (Edit Partner → AI Features toggles). When enabled:

- **Message Improvement**: Click the ✨ sparkle button next to the message input to have AI rewrite your message for clarity. The original text is preserved — click "Revert" to undo. Agents get clarity-focused rewrites; support gets actionable step-by-step rewrites.
- **Chat Summarization**: Click **"Summarize"** in the chat header to generate a 2-3 sentence summary of the conversation. The summary card appears at the top of the chat. The **AI Copilot Sidebar** (right panel) provides quick context for support staff.
- **Translation**: Click the translate button on any message bubble to translate it to your preferred language (nl/en/fr). The translation appears below the original text.
- **Sentiment Indicators**: Colored dots on tickets in the queue sidebar reflect customer sentiment (red = frustrated, green = satisfied). Sentiment trends are visible in the Admin Stats dashboard.
- **Auto-Summarize on Close**: When a ticket is closed, AI automatically generates a summary stored in closing notes. This summary survives GDPR purges in the ticket archive.

### Collision Detection

When multiple support staff open the same ticket, a banner appears: "👀 Sarah is also viewing this ticket". This prevents duplicate or conflicting responses. The banner updates as viewers join or leave.

### SLA Indicators

Each ticket in the queue shows an SLA countdown timer:
- 🟢 **Green**: More than 50% of response/resolution time remaining
- 🟡 **Yellow**: Less than 50% remaining
- 🔴 **Red**: SLA breached

The chat header also shows the SLA timer for the active ticket.

---

## 6. Accessibility & Performance

### High-Performance Core
- Strictly black and white with zero animations for maximum responsiveness.

### Specialized Typography
- **Dyslexic Mode**: Switches to the **Lexend** font family to improve readability.
- **Bionic Reading**: Highlights fixation points to help process text faster.

### Theme Inversion
- Toggle **Dark Mode** to invert the B&W palette for low-light environments.
