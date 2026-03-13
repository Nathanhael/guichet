# User Guide: Interacting with the Prototype

This guide helps you explore the neuro-inclusive and real-time features of the i-pxs-support prototype.

## Demo Persona Login

When you open the app at `http://localhost:5173`, select one of the following personas:

- **Agent Jan (NL)**: Best for testing DSC department ticket creation in Dutch.
- **Agent Marie (FR)**: Best for testing FOT department tickets in French.
- **Agent Tom (EN)**: Best for testing DSC department tickets in English.
- **Expert Piet (NL)**: A multi-tasking expert in Dutch (DSC).
- **Expert Sophie (FR)**: A French-speaking FOT expert.
- **Expert Alex (EN)**: An English-speaking FOT expert.
- **Admin Dirk (NL)**: Monitor the entire system and manage labels.

## The Cognitive Cockpit

Every view features a **Cognitive & Neuro-Inclusive Cockpit** in the header. Use these toggles to adapt the UI to your needs:

1. **Dyslexic Mode (🔤)**: Switches the font to **Lexend** and optimizes spacing.
2. **Bionic Reading (👁️)**: Highlights word fixation points to improve reading focus.
3. **Zen Mode (⚡)**: (Expert only) An immersive "Flow State" environment with adaptive glassmorphism, slow-pulsing ambient gradients, and notification shielding.
4. **Language Switcher (🌐)**: Instantly switch between English, Dutch, and French.
5. **Dark Mode (🌗)**: Toggle between Solaris Dark and High-Contrast Light modes.

## Real-Time Scenarios to Try

### Scenario 1: Multi-Language Chat
1. Log in as **Agent Jan** (Dutch).
2. Create a ticket in the DSC department.
3. In a new tab/window, log in as **Expert Sophie** (French).
4. Join the ticket as Sophie.
5. Send a message as Sophie in French; Jan will see it auto-translated to Dutch.

### Scenario 2: Expert Multi-Tasking & Zen
1. Log in as **Expert Piet**.
2. Have multiple Agents (Jan, Marie, Tom) create tickets.
3. As Piet, join all tickets.
4. Use the layout toggle (next to your status) to switch between **Tabs**, **Split Vertical**, or **2x2 Grid** views.
5. Toggle **Zen Mode** in the header to experience the immersive focus environment.

### Scenario 3: Admin Operational Monitoring
1. Log in as **Admin Dirk**.
2. Open the **Operational Dashboard**.
3. View real-time KPIs like **p95 Response Time** and **SLA Health**.
4. Monitor **Staffing Demand** to see if expert coverage matches current volume.

### Scenario 4: AI Strategic Insights
1. As **Admin Dirk**, navigate to the **AI Intelligence Hub**.
2. Observe the **Global Sentiment Score** and **Historical Sentiment Trends**.
3. Review the **Resolution Quality (Re-open Rate)** to identify recurring friction.
4. Read the **AI Qualitative Summary** to understand the "why" behind the numbers.
5. Use **Topic Clustering** to see which subjects are currently driving sentiment.

### Scenario 4: Reactions & Whispers
1. As an **Expert**, click the permanently visible smiley face icon next to an Agent's message.
2. Select a "Thumbs Up" emoji from the **centered, horizontal picker** that appears below the icon.
3. Toggle **Whisper Mode** above the text input.
4. Send a message and notice it is highlighted in a distinct color, signifying agents cannot see it.

## Troubleshooting

- **Socket Disconnected?** Check the indicator next to the logout button. The app will auto-reconnect.
- **Translation Unavailable?** Ensure **Ollama** is running on your host machine with the `gemmatranslate4b` model pulled.
