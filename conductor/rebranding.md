# Plan: Tessera Rebranding, Themes & Model-Agnostic AI

**Objective**: Standardize "Expert" terminology to "Support" across the entire stack, implement a flexible theme system for multi-tenancy, and allow per-partner AI model configuration.

## 1. Database & Infrastructure
- [x] Create migration script `server/scripts/migrate_rebranding.sql`:
    - Rename `expert_id` to `support_id` (if not already done in schema.ts).
    - Rename `expert_name` to `support_name`.
    - Rename `expert_lang` to `support_lang`.
    - Rename `expert_joined_at` to `support_joined_at`.
    - Add `theme_config` (JSONB) to `partners`.
    - Add `ollama_model` (TEXT) to `partners`.
    - `UPDATE memberships SET role = 'support' WHERE role = 'expert';`
- [x] Update `server/db/schema.ts` to include `themeConfig` and `ollamaModel` in `partners`.

## 2. Backend Systematic Rename
- [x] **Types**: Update `UserRole` in `server/types/index.ts` to include `'support'`.
- [x] **Socket**: Rename events in `server/socket/handlers.ts`:
    - `expert:join` -> `support:join`
    - `expert:leave` -> `support:leave`
    - `expert:joined` -> `support:joined`
    - `expert:left` -> `support:left`
- [x] **Services**: Update `server/services/presence.ts` (`OnlineExpert` -> `OnlineSupport`, etc).
- [x] **Routers**: Update tRPC procedures in `stats.ts`, `rating.ts`, etc.

## 3. Model-Agnostic AI
- [x] Refactor `server/services/translate.ts`:
    - Fetch `ollamaModel` from `partners`.
    - Use `partner.ollamaModel || config.OLLAMA_MODEL` in `callOllama`.
    - (DONE) Ensure `processMessage` always calls `improve`.

## 4. Frontend Rebranding
- [x] **Types**: Update `client/src/types/index.ts`.
- [x] **Store**: 
    - `ticketSlice`: `expertOpenTickets` -> `supportOpenTickets`, `setAgentOnline` -> `setParticipantOnline` (generic).
    - `messageSlice`: `onlineExperts` -> `onlineSupportUsers`.
- [x] **Hooks**: Update `useSocket.ts` listeners for renamed events.

## 5. Themes System
- [x] Define `ThemeConfig` interface in `types/index.ts`.
- [x] Implement `ThemeService` or hook to inject CSS variables:
    ```css
    --glass-blur: 16px;
    --glass-opacity: 0.1;
    ```
- [x] Update `PartnerManifest` to include `themeConfig`.

## 6. UI Refinement
- [x] Search and replace "Expert" -> "Support" in `i18n.ts`.
- [x] Rename components: `AdminAIStats.tsx` text, `SupportView.tsx` headers.
- [x] Update `PlatformView` to allow editing the new partner fields.
