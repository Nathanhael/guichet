# Product Roadmap & Future Enhancements

This document tracks planned features and strategic architectural shifts for the Tessera platform.

---

## ✅ Phase 5: Rebranding & Quality Hardening (Completed)
*Goal: System-wide rename, Theme system, and model-agnostic AI.*
- **Systematic Rename**: "Expert" -> "Support" across the full stack.
- **Theme System**: Dynamic CSS variables and per-partner manifest injection.
- **Dynamic Palette Generation**: Runtime JS-based shade variants (`brand-50` to `brand-900`).
- **Mode Conflict Resolution**: Specificity cascade for Dark, Dyslexic, and High-Contrast modes.
- **Admin Theme Preview**: Live branding feedback in Platform Operator view.
- **Model-Agnostic AI**: Configurable Ollama models per tenant.
- **Quality Hardening**: Redis-backed repetition store, strict typing, and zero-error build.

## ✅ Phase 5.5: Insights & Immersion (Completed)
*Goal: Immersive Support experience and predictive Admin analytics.*
- **Zen Mode**: Glassmorphic focus UI, ambient motion backgrounds, and notification shielding.
- **Advanced Stats**: p95 response time trends, sentiment distribution, and canned response effectiveness.
- **Data Hardening**: Support for re-open rates and granular message sentiment attribution.

## ✅ Phase 5.6: Model-Agnostic AI (Completed)
*Goal: Decouple from Ollama to support enterprise-grade LLM providers.*
- **Unified Adapter System**: Support for Azure OpenAI (o4-mini), Google Gemini, and Anthropic.
- **OpenAI-Compatible Bridge**: Support for LocalAI, vLLM, LM Studio, and Groq.
- **Provider Factory**: Singleton-based provider management with dynamic environment switching.
- **Observability**: Prometheus instrumentation for latency and errors across all providers.

## ✅ Phase 8: Platform Observability & Hardening (Completed)
*Goal: Enterprise-grade stability and monitoring.*
- **Metrics**: Prometheus/Grafana dashboard for Socket.io traffic and AI latency.
- **E2E Testing**: Playwright suite for critical multi-tenant flows.
- **API Hardening**: Improved global error boundaries and status code consistency.
- **Mobile PWA**: Specialized "Agent Lite" view for field technicians.

## ✅ Security & Privacy Hardening (Completed)
*Goal: Remediate audit findings and protect the multi-tenant trust boundary.*
- **XSS Prevention**: Strict validation of media URLs in socket handlers and protocol whitelisting in UI.
- **AI Safety**: Sanitization and XML-delimited data isolation in LLM prompts to prevent injection.
- **Secret Management**: Mandatory JWT_SECRET configuration (removal of insecure defaults).
- **Access Control**: Protected `/metrics` endpoint with token-based authentication.

## 🚀 Phase 6: The Intelligent Workspace (In Progress)
*Goal: Transforming the Support Specialist's experience with proactive AI assistance.*

### 1. AI-Powered Smart Drafts (Support Copilot)
- **Feature**: "Smart Suggest" button in the chat input.
- **Implementation**: Context-aware response generation using Ollama based on the last 5-10 messages.
- **Benefit**: Reduced resolution time and improved communication consistency.

### 2. Customer 360 Sidebar (Identity Intelligence)
- **Feature**: Collapsible context panel in SupportView.
- **Integration**: Pull mock CRM data (Active services, Account status) and historical ticket sentiment.
- **Benefit**: Immediate context without requiring manual search or questioning.

### 3. ✅ Real-Time "Topic Heat" Alerts
- **Feature**: Queue-level incident detection.
- **Logic**: Intelligent LLM-based clustering of incoming ticket text to detect trending incidents.
- **Broadcast**: Real-time Socket.io alerts and dashboard notifications for admins/managers.

---

## ☁️ Phase 7: Azure Native Transition
*Goal: Moving from local Docker to a robust cloud infrastructure.*

- **Auth**: Microsoft Entra ID (Azure AD) SSO integration for employees.
- **Storage**: Azure Blob Storage adapter for media and log attachments.
- **Compute**: Refactoring server services to be stateless for Azure App Service horizontal scaling.
- **AI**: Adapter support for Azure OpenAI (GPT-4o) as a production alternative to Ollama.

