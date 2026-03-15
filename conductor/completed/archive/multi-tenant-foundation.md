# Specification: Multi-Tenant Agnostic Foundation

## Objective
Transform the Tessera prototype from a telecom-specific application into a **multi-tenant platform** capable of serving different partners (projects) with unique branding, logic, and AI rules.

---

## 1. Role Definitions

### **Platform Operator** (New)
- **Identity**: The system owner / developer.
- **Scope**: Global.
- **Responsibility**: Manages the `partners` table, creates new projects, configures global AI settings, and monitors system-wide infrastructure.

### **Partner Admin** (Current "Admin")
- **Identity**: The manager of a specific project (e.g., Telecom Lead).
- **Scope**: Scoped to `partner_id`.
- **Responsibility**: Manages agents/experts within their project and views their specific AI Insights.

### **Expert / Agent**
- **Identity**: Operational staff.
- **Scope**: Scoped to `partner_id`.
- **Responsibility**: Handle tickets within their specific project.

---

## 2. The "Tenant Manifest" (Partner Config)

Every partner will have a configuration object stored in the database. This manifest drives the UI and AI logic.

### Manifest Schema
```typescript
interface PartnerManifest {
  id: string;           // 'telecom-01'
  name: string;         // 'iKanbi Telecom'
  industry: string;     // 'telecommunications'
  theme: {
    primaryColor: string;   // hex code
    secondaryColor: string; // hex code
    logoUrl?: string;
  };
  departments: {
    id: string;         // 'dsc'
    label: string;      // 'Billing & Sales'
  }[];
  metadataFields: {
    ref1Label: string;  // 'CDBID'
    ref2Label: string;  // 'Dare Reference'
  };
  aiRules: string;      // Industry-specific expert instructions
}
```

---

## 3. Technical Requirements

### 3.1 Database Schema (Multi-Tenancy)
- **New Table**: `partners` (stores the `PartnerManifest` above).
- **Update Tables**: Add `partner_id` (foreign key) to:
  - `users`
  - `tickets`
  - `labels`
  - `canned_responses`
  - `daily_stats`
  - `llm_summaries`
- **Genericize Columns**: Rename `cdb_id` → `ref_1` and `dare_ref` → `ref_2` in the `tickets` table.

### 3.2 Backend Logic (Scoping)
- **JWT**: Include `partner_id` in the auth token.
- **tRPC Middleware**: Update `protectedProcedure` to automatically inject `where(eq(table.partnerId, ctx.user.partnerId))` into all queries.
- **Socket.io**: Scope rooms by partner (e.g., `partner:{id}:ticket:{ticketId}`).

### 3.3 AI Pipeline (Generalization)
- **Prompt Injection**: Update `server/services/translate.ts` and `llm.ts` to fetch the partner's `aiRules` and `industry` from the manifest and prepend them to every LLM prompt.

### 3.4 Frontend (Dynamic UI)
- **Theme Engine**: Implement CSS variables driven by the `partner.theme` manifest.
- **Form Generation**: The "Create Ticket" form must use the `ref1Label` and `ref2Label` from the manifest instead of hardcoded telecom terms.
- **Department Filters**: Generate navigation tabs dynamically based on the `partner.departments` array.

---

## 4. Phased Implementation Plan

### **Phase 1: The Core Infrastructure (Migration)**
- [ ] Create `partners` table.
- [ ] Add `partner_id` to all anchor tables.
- [ ] Populate a default 'telecom' partner and link all existing data to it.
- [ ] Update Drizzle schema and genericize ticket columns.

### **Phase 2: Scoping & Auth**
- [ ] Update login logic to return `partner_id`.
- [ ] Enforce partner-level scoping in all tRPC routers.
- [ ] Update presence service to be partner-aware.

### **Phase 3: Dynamic UI & Theming**
- [ ] Create `usePartner()` hook to access the manifest globally in React.
- [ ] Refactor ticket lists and forms to use manifest labels.
- [ ] Implement the CSS variable theme system.

### **Phase 4: Platform Operator View**
- [ ] Create a new `PlatformView.tsx` specifically for the `platform_operator` role.
- [ ] Implement a CRUD interface for Partners and their Manifests.

### **Phase 5: Agnostic AI**
- [ ] Refactor improvement and translation prompts to be context-aware based on the manifest.
