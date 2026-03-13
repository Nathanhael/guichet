# Implementation Plan: Zen Mode & Advanced Stats

## Phase 1: Data Hardening (Database & Backend)

### 1.1 DB Schema Updates
- [ ] Add `sentiment` (real) and `canned_response_id` (text) to `messages` table in `server/db/schema.ts`.
- [ ] Add `reopened` (boolean) and `reopen_count` (integer) to `tickets` table.
- [ ] Add `p95_response_ms` (integer) to `daily_stats` table.
- [ ] Create and run migration: `docker compose exec server npx drizzle-kit push:pg`.

### 1.2 Stats Service logic
- [ ] Update `server/services/stats.ts`: Implement a percentile helper to calculate p95 for response times.
- [ ] Add logic to calculate re-open rates (count of `reopened` tickets vs total).
- [ ] Add logic to aggregate sentiment scores from the `messages` table.
- [ ] Update `computeLiveDayStats` to include these new fields.

### 1.3 tRPC Router updates
- [ ] Update `server/trpc/routers/stats.ts`: Add `p95ResponseMinutes`, `reopenRate`, `sentimentScore`, and `cannedResponseUsage` to the `getGlobalStats` response.

---

## Phase 2: Zen Mode UX (Expert Experience)

### 2.1 UI Foundation
- [ ] Add `.zen-glass` and `.zen-dim` classes to `client/src/index.css`.
- [ ] Add `animate-gradient-slow` keyframe for ambient backgrounds.

### 2.2 ExpertView Refinement
- [ ] Create an `AmbientBackground.tsx` component using `framer-motion` for Zen Mode.
- [ ] Update `ExpertView.tsx` to conditionally render `AmbientBackground` based on `focusMode`.
- [ ] Refactor the ticket chat header to a "Zen-Slim" version when `focusMode` is active.

### 2.3 Store logic
- [ ] Add `zenSettings` to `StoreState` in `client/src/store/useStore.ts`.
- [ ] Implement `autoBionic` logic: toggling `focusMode` also toggles `bionicMode` if the setting is enabled.

---

## Phase 3: Admin Dashboard (Advanced Analytics)

### 3.1 New Charts
- [ ] Update `AdminStats.tsx`: Add a Recharts `LineChart` for p95 response time trends.
- [ ] Add a `PieChart` or `BarChart` for Sentiment Distribution per department.
- [ ] Add a `CorrelationTable` to show Canned Response usage vs Average Rating.

### 3.2 Live Performance cockpit
- [ ] Add "SLA at Risk" (p95 outliers) to the top metrics bar in `AdminStats.tsx`.

---

## Phase 4: AI Sentiment Pipeline

### 4.1 Background Scoring
- [ ] Update `server/services/llm.ts`: Add `analyzeSentiment(text: string)` using Ollama.
- [ ] Update `message.send` procedure in `server/trpc/routers/message.ts` to trigger sentiment analysis after message storage (fire and forget).

---

## Phase 5: Verification & Launch

### 5.1 Manual Verification
- [ ] Verify Zen Mode visual transitions and notification shielding.
- [ ] Verify new stats appear on the Admin Dashboard with correct values.
- [ ] Verify sentiment scores are being populated in the DB via logs.

### 5.2 Test Coverage
- [ ] Add a unit test for the p95 calculation in `server/services/stats.ts`.
- [ ] Add a component test for `AmbientBackground.tsx`.
