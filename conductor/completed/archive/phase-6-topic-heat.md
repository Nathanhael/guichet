# Phase 6: Real-Time Topic Heat Alerts (Intelligent Incident Detection)

**Goal:** Implement a real-time background worker that analyzes incoming support tickets using LLM clustering to detect emerging incidents or "Topic Heat" before they escalate.

**Approach:** Intelligent clustering (Approach B) - analyzing the raw text of recent tickets to identify novel or unlabeled issues, rather than relying solely on predefined labels.

## 1. Scope & Impact

*   **Database**: Add `topic_alerts` table to persist detected incidents and their lifecycle state.
*   **Backend Services**: Create `server/services/topicHeat.ts` for the LLM analysis logic and background worker.
*   **API/Real-time**: Add tRPC endpoints to fetch/manage alerts and Socket.io broadcasts to notify admins in real-time.
*   **Frontend**: Add a "Heat Alerts" section to the `AdminView` and real-time toast notifications for managers/admins.

## 2. Proposed Solution

### 2.1 Database Schema (`server/db/schema.ts`)
Add a new table to track detected alerts:

```ts
export const topicAlerts = pgTable('topic_alerts', {
  id: text('id').primaryKey(),
  partnerId: text('partner_id').notNull().references(() => partners.id),
  dept: text('dept').notNull(),
  topic: text('topic').notNull(),
  summary: text('summary').notNull(),
  severity: text('severity').default('medium'), // 'low', 'medium', 'high'
  ticketCount: integer('ticket_count').notNull(),
  status: text('status').default('active'), // 'active', 'acknowledged', 'resolved'
  createdAt: timestamp('created_at', { mode: 'string' }).notNull(),
  resolvedAt: timestamp('resolved_at', { mode: 'string' }),
});
```

### 2.2 Core Logic (`server/services/topicHeat.ts`)
The worker will run on a rolling window (e.g., every 10 minutes) with the following logic:

1.  **Data Gathering**: Fetch tickets created in the last 15 minutes, grouped by `partner_id` and `dept`.
2.  **Threshold Check**: If a `partner_id`/`dept` combination has fewer than 3 new tickets, skip analysis.
3.  **LLM Clustering**: For groups exceeding the threshold, extract the first message of each ticket and send them to the LLM.
4.  **Prompt**:
    ```
    Analyze these recent support queries. Do they represent a single, concentrated incident or outage?
    Return JSON: { "isIncident": boolean, "topic": "Short name", "summary": "1 sentence explanation", "severity": "medium|high" }
    ```
5.  **Alert Generation**: If `isIncident` is true, create a record in `topic_alerts`.
6.  **Broadcast**: Emit a `topic:alert` event to the `partner:{partnerId}` socket room.

### 2.3 Background Worker (`server/app.ts`)
Initialize the background job on server start:

```ts
import { runTopicHeatCheck } from './services/topicHeat.js';

// Run every 10 minutes
setInterval(() => {
  runTopicHeatCheck().catch(err => logger.error({ err }, 'Topic heat check failed'));
}, 10 * 60 * 1000);
```

### 2.4 tRPC Router (`server/trpc/routers/alerts.ts`)
Create a new router for managing the lifecycle of alerts:

*   `list`: Fetch active alerts for a partner.
*   `acknowledge`: Change status to 'acknowledged'.
*   `resolve`: Change status to 'resolved'.

### 2.5 Frontend Integration
*   **State**: Add an `alerts` array to the `ticketSlice` in Zustand.
*   **Socket Listener**: Listen for `topic:alert` and show a high-visibility toast notification to users with `admin` or `manager` roles.
*   **Admin UI**: Create an `AdminAlerts.tsx` component in the `AdminView` to display current heat clusters, affected departments, and allow admins to acknowledge or resolve them.

## 3. Implementation Steps

- [x] **Step 1:** Add `topicAlerts` to `server/db/schema.ts` and generate/apply Drizzle migration.
- [x] **Step 2:** Implement `server/services/topicHeat.ts` with the LLM prompt and JSON parsing logic.
- [x] **Step 3:** Implement `server/trpc/routers/alerts.ts` and register it in `server/trpc/router.ts`.
- [x] **Step 4:** Integrate the background worker loop in `server/app.ts`.
- [x] **Step 5:** Create `client/src/components/admin/AdminAlerts.tsx`.
- [x] **Step 6:** Update `client/src/views/AdminView.tsx` to include the new Alerts tab.
- [x] **Step 7:** Add Socket.io listeners in the client to trigger toast notifications on new alerts.

## 4. Verification

*   **Mock Data**: Write a script to inject 5 similar tickets into the database to trigger the threshold.
*   **Worker Execution**: Verify the worker picks up the tickets, successfully parses the LLM JSON response, and inserts a row into `topic_alerts`.
*   **Real-time Broadcast**: Confirm that connected admin clients receive the `topic:alert` socket event and display a toast notification.
