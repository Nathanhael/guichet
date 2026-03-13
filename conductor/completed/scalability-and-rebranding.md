# Implementation Plan: Support Rebranding, AI Toggles, and Scalability

## 1. Professional Rebranding: "Expert" -> "Support"

To make the platform truly industry-agnostic, the term "Expert" will be replaced by the more standard "Support Specialist" or simply "Support".

### **Changes Required:**
- **Database**: Rename 'expert' role to 'support' in the `memberships` table.
- **Backend**: Update `roleProcedure` and logic checks from `role === 'expert'` to `role === 'support'`.
- **Frontend**: 
  - Update `UserRole` type in `client/src/types/index.ts`.
  - Update `i18n.ts` labels (e.g., `Expert` -> `Support`).
  - Update navigation labels and components (e.g., `ExpertView.tsx` -> `SupportView.tsx`).

---

## 2. Feature Toggles: Partner-Level AI Control

Implement a "Pay-as-you-go" logic where AI features (Translation, Improvement, Sentiment, Summaries) can be disabled per partner.

### **Changes Required:**
- **Database**: Add `ai_enabled` (boolean) to the `partners` table.
- **Backend**: 
  - Update `translate.ts` and `llm.ts` to check `partner.aiEnabled` before calling Ollama.
  - If disabled, return the original text instantly (zero cost/latency).
- **Frontend**:
  - Update `AdminAIStats.tsx` to show an "Upgrade" prompt if AI is disabled.
  - Update `ChatWindow.tsx` to hide AI-specific UI (like "Improved Text" badges) when disabled.
- **Platform Cockpit**: Add a checkbox in `PlatformView.tsx` to enable/disable AI for each tenant.

---

## 3. Scalability for 1000+ Employees

The current architecture is strong but needs specific "hardening" for enterprise scale.

### **Optimizations Required:**
- **Connection Management**:
  - **Socket.io Performance**: Ensure the Redis adapter is tuned. Implement "Sticky Sessions" in the load balancer (Nginx/Traefik).
  - **Presence Service**: Move online user tracking to a distributed cache (Redis) instead of in-memory maps to support multiple server instances.
- **Database Performance**:
  - **Indexing**: Add composite indices on `(partner_id, status)` and `(partner_id, created_at)` for fast dashboard loading.
  - **Connection Pooling**: Increase `pg` pool size and ensure `transaction` timeouts are strict.
- **Frontend Performance**:
  - **Virtualized Lists**: Implement `react-window` for the ticket queue if it exceeds 100+ active tickets per partner.
  - **Message Pagination**: Load only the last 50 messages of a chat initially, loading more on scroll (to prevent Zustand memory bloat).
- **AI Latency**:
  - Implement a queue (e.g., BullMQ) for background sentiment analysis so it doesn't block the main event loop if Ollama is slow.

---

## 4. Phased Execution

### **Phase 1: Rebranding & Feature Toggles**
- [ ] DB Migration: Add `ai_enabled` to `partners`.
- [ ] DB Migration: Update role 'expert' to 'support' in `memberships`.
- [ ] Code Refactor: Search and Replace 'expert' -> 'support' in logic and types.
- [ ] i18n Update: Update all UI strings.

### **Phase 2: Platform AI Control**
- [ ] Update `PlatformView` with AI toggle.
- [ ] Implement AI guard check in the translation service.

### **Phase 3: Scalability Hardening**
- [ ] Update `presence.ts` to use Redis.
- [ ] Optimize database indices for multi-tenant queries.
- [ ] Implement virtualization for the Support Queue.
