# User Guide: Tessera Platform (Clean Slate)

Welcome to Tessera. This guide explains the core chat functionality, dynamic organizational structure, and the strict monochrome interface.

---

## 1. Roles & Responsibilities

1.  **Platform Operator**: Global administrator. Manages the Partner ecosystem (activation/deactivation), invites global users, and monitors System Health and Audit Logs.
2.  **Partner Admin**: Manages organization-specific settings and team members (invite internal/external users, assign departments).
3.  **Support Specialist**: Handles incoming tickets and communicates with agents within their assigned departments.
4.  **Agent**: Creates tickets and communicates with support.

---

## 2. Using the Support Workspace

### Live Queue
- Tickets appear in the sidebar and are sorted by wait time.
- **Dynamic Filtering**: Use the scrollable department bar to filter by your specific team. Chips only show your assigned departments (generalists see all).
- Join a ticket to start a real-time conversation.

### Static Monochrome Interface
- The UI is strictly black and white to ensure maximum performance and zero distractions.
- All animations have been removed for an immediate, responsive feel.

---

## 3. Platform Administration (Global Users)

Platform Operators use the **PlatformView** to manage the ecosystem:
- **Partners Tab**: Manage Active vs Inactive partners. Inactive partners block logins and gracefully close open sessions.
- **Users Tab**: View which partners each user belongs to and manage global invites.
- **System Tab**: Monitor Postgres connections, Redis memory, and scheduled GDPR purges.
- **Audit Log**: Review timestamped administrative and system actions across all partners.

---

## 4. Partner Administration

Partner Admins use the **AdminView** to manage their local workspace:
- **Team Tab**: Manage users specific to the partner. Invite existing platform users or invite new external users with temporary passwords.
- **Departments Tab**: Create and update the names and descriptions of support departments.

---

## 5. Accessibility Features

### Dyslexic Mode
- Switch to the **Lexend** font family, specifically designed to reduce reading errors.

### Bionic Reading
- Highlights fixation points to help process text faster.

### High Contrast
- Toggle **Dark Mode** to invert the B&W palette.