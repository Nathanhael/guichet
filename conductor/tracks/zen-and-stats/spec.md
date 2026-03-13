# Specification: Zen Mode & Dashboard Stats (Insights Phase)

## Objective
Enhance the **Expert Flow** with an immersive Zen Mode and empower **Admins** with deeper, predictive statistics on the dashboard.

---

## 1. Zen Mode Enhancements (Expert Focus)

### Background
Experts currently have a basic "Focus Mode" that hides the sidebar. This phase will transform it into a true "Zen Mode" using the Solaris design system's glassmorphism and motion capabilities.

### Functional Requirements
- **Adaptive Glassmorphism**: When Zen Mode is active, the UI should transition to a high-contrast, high-blur glass effect.
- **Ambient Focus Environment**: Subtle, slow-moving gradients should appear in the background to provide a calming environment.
- **Focus Shielding**: All non-active ticket notifications should be muted (no dots, no badges) while Zen Mode is active.
- **Minimalist Header**: The chat header should collapse to a single line showing only the participant name and SLA status.
- **Bionic Auto-Mode**: Option to automatically enable Bionic Reading when entering Zen Mode.

### Design Elements (Solaris)
- **Background**: `animate-gradient-slow` (custom utility).
- **Blur**: `backdrop-blur-2xl`.
- **Contrast**: Deep brand-900 backgrounds with high-vibrancy borders.

---

## 2. Advanced Dashboard Statistics (Admin Insights)

### Background
The current dashboard provides basic volume and average time metrics. This phase adds higher-fidelity metrics for identifying outliers and qualitative trends.

### Functional Requirements
- **p95 Wait Time**: Track the 95th percentile of response times to identify "worst-case" performance, which is more actionable than averages.
- **Re-open Rate**: Track tickets that were closed but re-opened by an agent or automated system, indicating unresolved issues.
- **Real-Time Sentiment**: Aggregate sentiment scores from messages (calculated via Ollama) to show live "mood" trends per department.
- **Canned Response Correlation**: Identify which canned responses are most effective by correlating their use with high user ratings.
- **Wait Time Percentiles**: Display a distribution chart of wait times.

### Data Model Changes
- **Tickets**: `reopened: boolean`.
- **Messages**: `sentiment: real`, `canned_response_id: text`.
- **Daily Stats**: `p95_response_ms: integer`.

---

## 3. Technical Integration

### Backend (Node.js/tRPC)
- Update `server/db/schema.ts` with new columns.
- Update `server/services/stats.ts` to calculate p95 and re-open rates.
- Update `server/trpc/routers/stats.ts` to expose new metrics.
- Update `server/trpc/routers/message.ts` (send mutation) to trigger Ollama sentiment analysis in the background.

### Frontend (React/Zustand)
- Update `client/src/store/useStore.ts` to include a `zenSettings` object (e.g., `autoBionic`).
- Update `ExpertView.tsx` with ambient motion backgrounds.
- Update `AdminStats.tsx` with new charts (Recharts) for p95 and sentiment.
