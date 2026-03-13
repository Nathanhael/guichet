# System Architecture: M&P Support

This document provides a deep dive into the system design, data flows, and modular components of the M&P Support application. For dependencies and technical stack details, see [TECH_STACK.md](./TECH_STACK.md).

## High-Level Overview

The application follows a real-time, event-driven architecture designed for high availability and low latency in customer support scenarios.

```mermaid
graph TD
    subgraph Frontend
        V[Vite/React] --> S[Zustand Store]
        V --> SC[Socket.io-client]
    end

    subgraph Backend
        EX[Express.js] --> DB[(PostgreSQL/pg)]
        EX --> SI[Socket.io Server]
        SI --> GS[Guards Service]
        GS --> TR[Translation Service]
        TR --> OL[Ollama LLM]
        SI <--> RD[(Redis)]
    end

    SC <--> SI
    V --> EX
```

## Real-Time Engine (Socket.io)

Real-time interactions are the core of the support experience. The server handles room management, broadcast logic, and background processing.

### Horizontal Scaling (Redis Adapter)
To support multi-instance deployments, the Socket.io server uses the `@socket.io/redis-adapter`. This ensures that events emitted on one instance (e.g., a new message) are broadcast to clients connected to all other instances via a shared **Redis** pub/sub backplane.

### Event Flow: Ticket Creation to Resolution

```mermaid
sequenceDiagram
    participant A as Agent
    participant S as Server
    participant E as Expert

    A->>S: ticket:new (Dept, Ref)
    A-->>E: ticket:created (Broadcast)
    E->>S: expert:join (TicketId)
    S-->>A: expert:joined (Ticket Participants)
    Note over A,E: Real-time Chat Active
    A->>S: message:send (Text)
    S->>S: Message Guards (Safety/Quality)
    S->>S: AI Translation Cache/API
    S-->>E: message:new (Translated)
    E->>S: message:send (Whisper/Normal)
    S-->>A: message:new (Original)
    E->>S: ticket:close (Notes)
    S-->>A: ticket:closed (Trigger Rating)
```

## AI & Translation Pipeline

To handle multi-language support (EN, NL, FR) without heavy API costs, the system uses a localized AI strategy.

1. **Translation Service**:
   - Checks `translations_cache` first.
   - Fallback to local **Ollama** REST API (Gemma Model).
   - Graceful degradation to original text if AI is unreachable.

2. **Sentiment & Summarization**:
   - The Admin Dashboard triggers background summarization of ticket batches to identify recurring issues.

## Modular Dashboard Architecture

The **Admin View**, **Manager View**, and **Expert View** use a highly modular "cockpit" approach.

- **Orchestration**: Layouts are managed by role-specific views (`AdminView.tsx`, `ManagerView.tsx`, `ExpertView.tsx`).
- **Plugins**: Features like `StatsOverview`, `PerformanceTrends`, and `Labels` are independent components that subscribe to the global store.
- **Cognitive Tools**: Accessibility features (Dyslexic font, Bionic reading highlighting) are applied globally via a root wrapper observing the store.

## Data Lifecycle & Compliance (GDPR)

The system manages a hybrid data model to balance historical analysis with privacy compliance.

1. **Live Data (Last 30 Days)**: All tickets, messages, and ratings are stored with full detail.
2. **Purge Cycle**: Every 24 hours, the server identifies "expired" data.
3. **Anonymized Aggregation**: Before deletion, key metrics (volumes, response times, ratings) are summarized into the `daily_stats` table.
4. **Permanent Storage**: `daily_stats` are retained indefinitely for long-term trend analysis.

## Build & Optimization Strategy

The frontend build pipeline (Vite) is configured for optimal production performance:

1. **Lazy Loading**: Route-level code splitting ensures that code for "Admin" or "Expert" views is only downloaded when the user logs in with those roles.
2. **Vendor Separation**: Heavy libraries like Recharts and Framer Motion are moved to separate chunks. This allows the browser to cache these stable libraries while only re-downloading the app logic when it changes.
3. **i18n Localization**: Labels and UI text are managed via a centralized `i18n.ts` file, ensuring zero-latency switching between languages.

## Server Module Structure

After refactoring, the server follows a clean modular architecture:

| Module | File | Responsibility |
|---|---|---|
| App Setup | `app.ts` | Express middleware, route mounting, health checks |
| Socket Handlers | `socket/handlers.ts` | All real-time event handling |
| Stats Routes | `routes/stats.ts` | KPI dashboard & LLM summary endpoints |
| Stats Service | `services/stats.ts` | `computeLiveDayStats()` computation |
| GDPR Service | `services/gdpr.ts` | Daily purge cycle with aggregation |
| Business Hours | `services/businessHours.ts` | Hours check, queue positions, agent status |
| Presence | `services/presence.ts` | Online user tracking |
| Translation | `services/translate.ts` | AI improve + translate pipeline |
| Guards | `services/guards.ts` | Message safety (regex + AI topic filter) |
| LLM | `services/llm.ts` | Sentiment analysis & conversation summaries |

## Security & Reliability

- **RBAC**: All API routes require JWT authentication. Admin-only endpoints (feedback management, ratings) enforce additional role checks. Socket events are guarded via presence identification.
- **Magic Byte Validation**: Image uploads are verified via content headers to prevent spoofing.
- **Connection Resilience**: Automatic socket re-identification on network jitter.
