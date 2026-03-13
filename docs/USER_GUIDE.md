# User Guide: Multi-Tenant Prototype

This guide helps you explore the neuro-inclusive and multi-tenant features of the M&P Support platform.

## Role-Based Access

The platform uses a 5-tier hierarchy to manage global and project-specific operations:

1.  **Platform Operator**: The system developer. Manages partners (tenants), global AI settings, and branding manifests.
2.  **Admin (Partner Admin)**: Manages a specific project. Access to labels, feedback, and all dashboards for their partner.
3.  **Manager (Team Lead)**: Operational lead. Monitors performance and AI Insights for their partner.
4.  **Support Specialist**: Resolution expert. Handles tickets and uses AI tools.
5.  **Agent**: Requester. Creates tickets and interacts with Support.

---

## Key Features

### 1. Transversal Support (Partner Switcher)
If you are assigned to multiple projects (e.g., Telecom and Healthcare), you will see a **Partner Switcher** in the top navigation bar. 
*   Click the dropdown to instantly swap contexts.
*   The UI will update its branding (colors) and terminology (labels) to match the selected project.

### 2. The Cognitive Cockpit
Every view features a neuro-inclusive header:
- **Dyslexic Mode (🔤)**: Lexend font and optimized spacing.
- **Bionic Reading (👁️)**: Fixation-point highlighting.
- **Zen Mode (⚡)**: (Support only) Immersive focus environment with adaptive glassmorphism and ambient backgrounds.

### 3. Dual Admin Dashboards
Admins and Managers can toggle between two specialized views:
- **Operational Dashboard**: Real-time KPIs (p95 Response, SLA Health, Staffing).
- **AI Intelligence Hub**: Qualitative analysis (Sentiment trends, Topic clustering, LLM summaries).

### 4. AI Persona & Strategy
Admins can fine-tune the AI for their specific project in the **AI Persona** tab:
- **Industry Context**: Define technical terms and domain-specific rules.
- **Asymmetric Strategies**: Define how the AI should improve Agent messages vs. how it should transform Support replies.
- **Actionable Toggles**: Enable "Actionable AI" to have the system automatically generate customer scripts and internal procedures.

---

## Scenarios to Try

### Scenario 1: Cross-Project Interaction
1. Log in as **Admin Dirk** (Platform Operator).
2. Use the **Partner Switcher** to navigate to the **Platform Cockpit**.
3. Create a new "Healthcare" partner with custom colors and labels (e.g., "Patient ID").
4. Switch back to the Healthcare workspace and notice the UI transformation.

### Scenario 2: Support Flow & Actionable AI
1. As an Admin, go to **AI Persona** and enable **Actionable AI**.
2. Log in as a **Support Specialist**.
3. Reply to a technical ticket with jargon (e.g., "Reset the DHCP lease on the node").
4. Notice how the AI transforms your message into **[STEPS]** for the agent and a **[CUSTOMER SCRIPT]** for the customer.
5. The Agent can now just click **"Copy"** on the emerald script box.

### Scenario 3: Focus & Zen
1. Log in as a **Support Specialist**.
2. Join multiple active tickets.
3. Toggle **Zen Mode** to experience the "Flow State" environment.
4. Notice how notifications for background tickets are visually shielded to minimize distraction.

---

## Troubleshooting

- **Redis Error?** Ensure the Redis container is running. Presence and Socket.io scaling depend on it.
- **AI Unavailable?** Check the **Platform Cockpit** to see if `ai_enabled` is toggled on for your partner. Ensure Ollama is running at `host.docker.internal:11434`.
