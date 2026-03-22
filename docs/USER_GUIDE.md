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

### Audit Log
- **Traceability**: Track every administrative change with granular `from -> to` diffs.
- **Advanced Filtering**: Filter logs by Action, Partner, Actor, and Target ID. You can also specify a **From Date** and **To Date** to narrow down the audit window.
- **Enterprise Pagination**: Navigate through large datasets using the sticky pagination bar at the bottom of the screen.
- **Compliance Export**: Download the filtered log (including date ranges) as a CSV for offline auditing.

---

## 4. Partner Administration

Partner Admins use the **AdminView** to manage their local workspace:
- **Team Tab**: Manage users specific to the partner. Invite existing platform users or invite new external users.
- **Departments Tab**: Create and update the names and descriptions of support departments.

---

## 5. Accessibility & Performance

### High-Performance Core
- Strictly black and white with zero animations for maximum responsiveness.

### Specialized Typography
- **Dyslexic Mode**: Switches to the **Lexend** font family to improve readability.
- **Bionic Reading**: Highlights fixation points to help process text faster.

### Theme Inversion
- Toggle **Dark Mode** to invert the B&W palette for low-light environments.
