# User Guide: Tessera Platform (Clean Slate)

Welcome to Tessera. This guide explains the core chat functionality, dynamic organizational structure, and the strict monochrome interface.

---

## 1. Roles & Responsibilities

1.  **Platform Operator**: Global administrator. Manages the Partner ecosystem, infrastructure configuration, global user lifecycle, and system audits.
2.  **Partner Admin**: Manages organization-specific settings and team members (invite internal/external users, assign departments).
3.  **Support Specialist**: Handles incoming tickets and communicates with agents within their assigned departments.
4.  **Agent**: Creates tickets and communicates with support.

---

## 2. Authentication & Recovery

### Standard Login
- Access the platform via `http://localhost:3001` (or your production URL).
- Use your email address and password for local access.
- For corporate accounts, use the **"Sign in with Microsoft"** button.

### Password Recovery
- If you forget your local password, click **"Forgot password?"** on the login screen.
- Enter your registered email to receive a secure reset link.
- Reset links are valid for **1 hour** and can only be used once.

### Multi-Factor Authentication (MFA)
- Click the **shield icon** (bottom-right of any screen) to open the Security Modal.
- Under **Two-Factor Authentication**, click **"Set up"** to begin TOTP enrollment.
- Scan the QR code with your authenticator app (Google Authenticator, Authy, etc.).
- Enter the 6-digit code to confirm and enable MFA.
- **Save your recovery codes** — 8 one-time codes are shown. Store them securely.
- When MFA is enabled, login will prompt for a TOTP code after entering your password.
- You can also log in with a recovery code if you lose access to your authenticator app.

### Password Change
- Open the Security Modal via the shield icon.
- Enter your current password and a new password meeting the strength requirements:
  - Minimum 10 characters
  - At least 1 uppercase, 1 lowercase, 1 digit, and 1 special character
  - Cannot be one of your last 5 passwords
  - Cannot contain your email prefix or name
- All other sessions are automatically signed out after a password change.

### Account Lockout
- After **5 failed login attempts**, your account is temporarily locked for **15 minutes**.
- You will receive an email notification when your account is locked.
- Platform operators can manually unlock your account if needed.

### Notification Preferences
- Open the Security Modal and scroll to **Notifications**.
- Toggle email notifications on/off for: account lockout alerts, MFA changes, and password changes.
- All notifications are enabled by default (opt-out model).

---

## 3. Platform Administration (Global Control)

Platform Operators use the **PlatformView** to manage the entire ecosystem:

### Partners Tab
- Manage Active vs Inactive tenants. Inactive partners block logins and gracefully close open sessions.

### Users Tab
- **Onboarding Status**: Track users as **Linked (SSO)**, **Active (Local)**, or **Pending Invite**.
- **Activity Monitoring**: The **Last Active** column shows the precise time of each user's last interaction.
- **Resend Invite**: For pending users, use this button to regenerate a temporary password and resend the welcome email.
- **Global Search & Management**: Edit profiles, manage cross-tenant access, or perform global deletions.

### Health Tab
- **Live Metrics**: Real-time monitoring of Postgres active connections and Redis memory usage.
- **GDPR Monitoring**: View the last-run time and success status of the automated data purge.

### Config Tab
- **Mail Infrastructure**: Manage the global email provider (SMTP, Resend, or SendGrid).
- **Sender Details**: Configure the global "From" address and display name for all system emails.
- **Verification**: Use the **"Send Test"** button to confirm your mail settings are working correctly.

### Security Tab
- **MFA Management**: View MFA status badges per user (green shield = enabled, grey = not enabled).
- **Disable MFA**: Force-disable MFA for a locked-out user (sends email notification).
- **Unlock Account**: Manually unlock a user whose account was locked due to failed login attempts.
- **Revoke Sessions**: Force sign-out all active sessions for a user.

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
- **Team Tab**: Manage users specific to the partner. Invite existing platform users or invite new external users.
- **Departments Tab**: Create and update the names and descriptions of support departments.
- **Canned Responses Tab**: Create, edit, and delete response templates for support agents. Each response has a title, body, optional shortcut key, and optional category.

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

---

## 6. Accessibility & Performance

### High-Performance Core
- Strictly black and white with zero animations for maximum responsiveness.

### Specialized Typography
- **Dyslexic Mode**: Switches to the **Lexend** font family to improve readability.
- **Bionic Reading**: Highlights fixation points to help process text faster.

### Theme Inversion
- Toggle **Dark Mode** to invert the B&W palette for low-light environments.
