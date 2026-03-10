# User Guide: Interacting with the Prototype

This guide helps you explore the neuro-inclusive and real-time features of the i-pxs-support prototype.

## Demo Persona Login

When you open the app at `http://localhost:5173`, select one of the following personas:

- **Alice Agent (EN)**: Best for testing DSC department ticket creation and receiving translations.
- **Bob Agent (NL)**: Best for testing FOT department tickets in Dutch.
- **Expert Zoe (FR)**: A multi-tasking expert. Open her in a separate tab to handle incoming tickets.
- **Dirk Admin (NL)**: Monitor the entire system and manage labels.

## The Cognitive Cockpit

Every view features a **Cognitive & Neuro-Inclusive Cockpit** in the header. Use these toggles to adapt the UI to your needs:

1. **Dyslexic Mode (🔤)**: Switches the font to **Lexend** and optimizes spacing.
2. **Bionic Reading (👁️)**: Highlights word fixation points to improve reading focus.
3. **Language Switcher (🌐)**: Instantly switch between English, Dutch, and French.
4. **Dark Mode (🌗)**: Toggle between Solaris Dark and High-Contrast Light modes.

## Real-Time Scenarios to Try

### Scenario 1: Multi-Language Chat
1. Log in as **Alice Agent** (English).
2. Create a ticket.
3. In a new tab/window, log in as **Expert Zoe** (French).
4. Join the ticket as Zoe.
5. Send a message as Zoe in French; Alice will see it auto-translated to English.

### Scenario 2: Expert Multi-Tasking
1. Log in as **Expert Zoe**.
2. Have multiple Agents (Alice, Bob, David) create tickets.
3. As Zoe, join all tickets.
4. Use the layout toggle (next to your status) to switch between **Tabs**, **Split Vertical**, or **2x2 Grid** views.

### Scenario 3: Admin Monitoring
1. Log in as **Dirk Admin**.
2. View real-time KPIs and trend charts.
3. Use the **Date Range** and **Department** filters to narrow down statistics.
4. Open the **Archive** tab to search and export past conversations to CSV.

## Troubleshooting

- **Socket Disconnected?** Check the indicator next to the logout button. The app will auto-reconnect.
- **Translation Unvailable?** Ensure **Ollama** is running on your host machine with the `gemmatranslate4b` model pulled.
