# Product Roadmap & Future Enhancements

This document tracks planned features and strategic architectural shifts for the M&P Support platform.

---

## 🚀 Phase 6: The Intelligent Workspace (Pending)
*Goal: Transforming the Support Specialist's experience with proactive AI assistance.*

### 1. AI-Powered Smart Drafts (Support Copilot)
- **Feature**: "Smart Suggest" button in the chat input.
- **Implementation**: Context-aware response generation using Ollama based on the last 5-10 messages.
- **Benefit**: Reduced resolution time and improved communication consistency.

### 2. Customer 360 Sidebar (Identity Intelligence)
- **Feature**: Collapsible context panel in SupportView.
- **Integration**: Pull mock CRM data (Active services, Account status) and historical ticket sentiment.
- **Benefit**: Immediate context without requiring manual search or questioning.

### 3. Real-Time "Topic Heat" Alerts
- **Feature**: Queue-level incident detection.
- **Logic**: Automated clustering of incoming tickets to detect trending issues (potential outages).
- **Benefit**: Proactive instead of reactive incident management.

---

## ☁️ Phase 7: Azure Native Transition
*Goal: Moving from local Docker to a robust cloud infrastructure.*

- **Auth**: Microsoft Entra ID (Azure AD) SSO integration for employees.
- **Storage**: Azure Blob Storage adapter for media and log attachments.
- **Compute**: Refactoring server services to be stateless for Azure App Service horizontal scaling.
- **AI**: Adapter support for Azure OpenAI (GPT-4o) as a production alternative to Ollama.

---

## 🛠️ Phase 8: Platform Observability & Hardening
*Goal: Enterprise-grade stability and monitoring.*

- **Metrics**: Prometheus/Grafana dashboard for Socket.io traffic and AI latency.
- **E2E Testing**: Playwright suite for critical multi-tenant flows.
- **API Versioning**: Implementing `/v1/` routes for the tRPC and REST endpoints to support legacy partners.
- **Mobile PWA**: Specialized "Agent Lite" view for field technicians.
