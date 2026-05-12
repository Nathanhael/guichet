# User Guide: Guichet Platform

Welcome to Guichet. This guide explains the core chat functionality, dynamic organizational structure, and the soft-product interface.

---

## 1. Roles & Responsibilities

1.  **Platform Operator**: Global administrator. Manages the Partner ecosystem, infrastructure configuration, and system audits.
2.  **Partner Admin**: Manages organization-specific settings (departments, business hours, labels, canned responses, AI). Team membership flows in from Azure groups — admins do not invite users from inside Guichet.
3.  **Support Specialist**: Handles incoming tickets and communicates with agents within their assigned departments.
4.  **Agent**: Creates tickets and communicates with support.

---

## 2. Authentication

### Standard Login
- Access the platform via `http://localhost:3001` (or your production URL).
- Click **"Sign in with Microsoft"** and complete the Azure OIDC flow.
- No local passwords. MFA is enforced at the Azure tenant level, not by Guichet.

### Lost Access
- If you cannot log in, contact your platform operator. They will verify your Azure account is provisioned and that your partner membership is active.
- If SSO itself is down, platform operators can use the break-glass CLI (`docs/BREAK_GLASS_RUNBOOK.md`) to mint a short-lived JWT for emergency administration.

---

### Platform Administration (Global Control)

Platform Operators use the **PlatformView** to manage the entire ecosystem.

**Access Note**: Platform operators sign in through the same Azure SSO button as everyone else — the `is_platform_operator` flag on their user row unlocks PlatformView after login. Emergency access uses the break-glass CLI; see `docs/BREAK_GLASS_RUNBOOK.md`.

### Partners Tab

- Manage Active vs Inactive tenants. Inactive partners block logins and gracefully close open sessions.

### Users Tab
- **Onboarding Status**: Track users as **Linked (SSO)** (an Azure OID is stamped on the user) or **Pending** (provisioned but not yet signed in).
- **Activity Monitoring**: The **Last Active** column shows the precise time of each user's last interaction.
- **Revoke Sessions**: Force sign-out all active sessions (and refresh tokens) for a user.
- **Global Search**: Search users across every tenant from one place. User identity itself is managed in Azure — Guichet shows the SSO-resolved view; create/edit/delete happens in Entra.

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

Partner Admins use the **AdminView** to manage their local workspace. The default tab list:

- **Dashboard Tab**: Multi-zone partner dashboard — Scorecard (KPIs), Staffing fit (heatmap of agent coverage vs ticket volume), Trends (time-series charts), Department + Staff breakdowns (sortable tables). Onboarding mode runs first if the partner has no traffic yet.
- **Team Tab**: Read-only roster of partner members, sourced from Azure group mappings. Membership add/remove/role-change happens in Azure.
- **Departments Tab**: Create and update the names and descriptions of support departments. Configure per-department first-response SLA (toggle + threshold minutes + warn%).
- **Tickets Tab**: Browse and manage all partner tickets.
- **Archive Tab**: Browse closed-ticket archive entries, with message-count summaries and the partner-scoped audit log.
- **Business Hours Tab**: Configure operating hours per day. Outside hours, agents see a "business hours" guard and queue position.
- **Labels Tab**: Create colored labels for ticket categorization.
- **Canned Responses Tab**: Create, edit, and delete response templates for support agents. Each response has a title, body, optional shortcut key, and optional category. With AI translation enabled, canned responses auto-translate to nl/en/fr.
- **Feedback Tab**: Review in-app user feedback submitted via the feedback modal.

Tabs that have shipped at the backend level but are currently disabled in the AdminView UI (`DISABLED_FEATURES` in `client/src/constants.ts`): **Knowledge Base**, **Webhooks**. The legacy **Alerts** (topic-clustering) and **Stats** tabs were removed entirely — analytics moved into the Dashboard tab.

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
- **Ticket Transfer**: Click the transfer button to hand a ticket back to another **department queue** (with an optional whisper note for context). Tickets are not assigned to specific agents — the next available member of the target department picks them up.
- **Customer Info Panel**: View customer details, reference fields, and past ticket history in the right sidebar.
- **CSAT Ratings**: When a ticket is closed, customers are auto-prompted to rate their support experience. Support admins can view per-agent satisfaction scores with date filtering in the Satisfaction view.

### Keyboard Shortcuts

Support Specialists can use high-traffic shortcuts to speed up ticket handling. The **Ctrl+K** nav badge in the top-right doubles as a button to open the command palette, which serves as a live cheat sheet for all bindings.

> Authoritative source: `client/src/hooks/useKeyboardShortcuts.ts`. The Command Palette doubles as a live cheat sheet — open it for the canonical, always-fresh list.

- **Navigation**:
  - `Ctrl+K` or `?` — Open Command Palette
  - `Alt+ArrowUp` / `Alt+ArrowDown` — Previous / Next chat tab
  - `Alt+1..9` — Jump directly to chat tab N (Ctrl+1..9 deliberately left to the browser)
  - `Ctrl+B` — Toggle Queue Sidebar
  - `Ctrl+F` — Open message search within the active ticket
  - `Esc` — Exit focus mode (when active)
  - `Ctrl+Shift+F` — Toggle focus mode
- **Actions**:
  - `Ctrl+Enter` — Close current ticket (opens confirmation)
  - `Alt+T` — Transfer ticket to another department
  - `Alt+W` — Close current chat tab
  - `Ctrl+/` — Toggle whisper mode (internal-only messages)
  - `Alt+L` — Open label picker (Ctrl+L deliberately left to the browser address bar)
  - `Alt+J` — Open canned response picker (Ctrl+J deliberately left to browser downloads)
  - `Alt+M` — Toggle mic dictation
  - `Ctrl+Shift+C` — Toggle the AI tools side panel
  - `Ctrl+.` — Open status picker (Online / Away)
  - `/` (when not typing) — Focus the message input

---

### AI Features

AI features are controlled per partner by platform admins (Edit Partner → AI Features toggles). When enabled:

- **Message Improvement**: Click the ✨ sparkle button next to the message input to have AI rewrite your message for clarity. The original text is preserved — click "Revert" to undo. Agents get clarity-focused rewrites; support gets actionable step-by-step rewrites.
- **Translation**: Click the translate button on any message bubble to translate it to your preferred language (nl/en/fr). The translation appears below the original text. Translations are cached server-side.
- **Voice Dictation**: Press **Alt+M** (or click the mic icon) to dictate a reply. Audio is sent to Azure OpenAI's transcription endpoint and inserted into the compose area as text.
- **Canned Response Translation**: With AI on, canned responses auto-translate to nl / en / fr; staff pick from the picker in their preferred language.

### Collision Detection

When multiple support staff open the same ticket, a banner appears: "👀 Sarah is also viewing this ticket". This prevents duplicate or conflicting responses. The banner updates as viewers join or leave.

---

## 6. Accessibility & Performance

### Soft Product Interface
- Indigo accent on calm neutrals (light + dark themes), purposeful motion only — animations respect `prefers-reduced-motion`. Dense layouts; no decorative chrome. Full spec at `docs/SOFT_PRODUCT_DESIGN_SPEC.md`.

### Specialized Typography
- **Dyslexic Mode**: Switches the body font to **Lexend** and relaxes line-height to improve readability.
- **Bionic Reading**: Highlights fixation points to help process text faster.

### Theme & Accessibility Modes
- **Dark Mode**: Full token swap — both themes are first-class.
- **Monochrome Mode**: Collapses the indigo accent to ink; hierarchy carries via border + shadow + weight (useful for color-vision differences).
