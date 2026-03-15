# User Guide: Tessera Platform

Welcome to Tessera. This guide explains the different roles and how to use the neuro-inclusive features of the platform.

---

## 1. Roles & Responsibilities

The platform is designed around 5 distinct roles, isolated by the membership model.

1.  **Platform Operator**: Global administrator. Manages Partners (Tenants) and cross-platform memberships.
2.  **Partner Admin**: Managed specific partner settings, AI persona rules, and canned responses.
3.  **Manager**: Views high-level AI insights and operational dashboards for their specific partner.
4.  **Support Specialist**: Resolution specialist. Handles tickets and uses AI tools to communicate with agents.
5.  **Agent**: Creates tickets and communicates with support on behalf of customers.

---

## 2. Using the Support Workspace

The **Support Specialist** workspace is designed for maximum focus and efficiency.

### Live Queue
- Tickets are automatically sorted by wait time.
- Join a ticket to start a real-time conversation.
- Use **Canned Responses** (shortcuts) for common procedures.

### Zen Mode (Focus)
- Toggle **Zen Mode** to remove all UI clutter.
- Immersive glassmorphic design reduces cognitive load.
- Ambient backgrounds create a calming workspace for deep resolution.

### Asymmetric AI
- Your messages are automatically improved for clarity and structure.
- Internal procedures are detected and formatted into [STEPS].
- Actionable scripts for agents are generated via [CUSTOMER_SCRIPT].

---

## 3. Neuro-Inclusive Features (Solaris)

Tessera is built to be accessible to everyone, with a focus on neuro-diversity.

### Dyslexic Mode
- Switch to the **Lexend** font family, specifically designed to reduce reading errors.
- Increased line height and letter spacing for better scanability.

### Bionic Reading
- Highlighting fixation points (the first few letters of words).
- Helps the eye skip through text faster, reducing the effort needed to process long conversations.

### High Contrast & Dark Mode
- Adaptive themes to suit different visual sensitivities and environments.

---

## 4. Agent Lite (Mobile PWA)

Field agents can use the **Agent Lite** view — a mobile-optimized, installable PWA designed for quick ticket creation and chat on the go.

### Accessing Agent Lite
- Navigate to `/?lite=1` to switch to the mobile view.
- On mobile devices, agents are automatically prompted to switch to Lite mode.
- Install as a PWA via the browser's "Add to Home Screen" for a native app experience.

### Features
- **Ticket list**: View all your active tickets at a glance.
- **Quick ticket creation**: Streamlined form with department selection and description.
- **Chat**: Full real-time chat powered by the same Socket.io backend.
- **Offline support**: Service worker caches static assets and API responses for offline access.

---

## 5. Business Hours Configuration (Admin)

Partner Admins can configure when their support desk is available to agents.

### Setting Business Hours
1. Navigate to the **Admin View** and open the **Business Hours** settings panel.
2. Set the **Start** and **End** times (24h format, e.g. `09:00` – `17:00`).
3. Select the **Timezone** for your partner (defaults to `Europe/Brussels`).
4. Click **Save** to apply.

### How It Works
- When outside business hours, agents cannot create new tickets.
- The check runs server-side — the UI displays a notice based on a real-time socket event (`businessHours:status`).
- If no partner-specific hours are configured, the platform falls back to global defaults (`07:30` – `22:30` Brussels time).

---

## 6. Multi-Tenant Switching

If you are a member of multiple projects (e.g., both Telecom and Healthcare), use the **Partner Switcher** in the top navigation to jump between workspaces. Your status (Available/Break) is tracked per partner.
