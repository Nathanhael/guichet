# Technical Documentation: Tessera

This document provides a comprehensive deep dive into the system design, tech stack, and multi-tenant architecture of the Tessera platform.

---

## 1. High-Level Architecture

The platform follows a real-time, event-driven, multi-tenant architecture designed for high availability and enterprise scalability.

```mermaid
graph TD
    subgraph Frontend
        V[Vite/React] --> S[Zustand Store]
        V --> SC[Socket.io-client]
        V --> TC[tRPC Client]
    end

    subgraph Backend
        EX[Express.js] --> DB[(PostgreSQL/Drizzle)]
        EX --> TR[tRPC Server]
        EX --> SI[Socket.io Server]
        TR --> DB
        SI --> GS[Guards Service]
        GS --> TRN[Translation Service]
        TRN --> OL[Ollama LLM]
        SI <--> RD[(Redis)]
        PS[Presence Service] <--> RD
    end

    SC <--> SI
    TC <--> TR
    V --> EX
```

### Core Technologies
| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite 5 + Tailwind CSS 3 + Framer Motion |
| Communication | **tRPC** (Type-safe API) + Socket.io |
| Scaling | **Redis** (Socket.io Adapter + Distributed Presence) |
| State | Zustand |
| Backend | Node 20 (ESM), Express.js |
| Database | PostgreSQL + **Drizzle ORM** |
| Auth | JWT (Multi-Tenant Memberships) |
| AI | Ollama REST API (Model-agnostic per partner) |

---

## 2. Multi-Tenant Architecture

The platform is designed to be industry-agnostic ("White-Label"). Logic and data are isolated via a Partner/Membership model.

### The Membership Model
Instead of a static role on a user, access is managed via the `memberships` table. A single user can belong to multiple partners (projects) with different roles in each.

| Entity | Description |
|---|---|
| **Partner** | A "Tenant" (e.g., Telecom, Healthcare). Defines branding, labels, and AI rules. |
| **Membership** | Links a User to a Partner with a specific `role` and `dept`. |
| **User** | Global identity (Name, Lang). |

### Tenant Manifest
Every partner has a JSON manifest that dynamically "hydrates" the UI:
- **Branding**: Primary/Secondary colors (`--brand-primary`).
- **Labels**: Domain-specific terms (e.g., "Patient ID" vs "CDBID").
- **Departments**: Dynamic navigation tabs.
- **AI Rules**: Custom system instructions for the LLM.
- **Theme**: Custom CSS variables (blur, opacity, radius).

---

## 3. Real-Time Engine & Scalability

### Horizontal Scaling (Redis)
The platform is designed for enterprise scale (1000+ employees):
1. **Socket.io Redis Adapter**: Syncs chat events across multiple server instances.
2. **Distributed Presence**: Online user status is stored in **Redis Hashes** rather than local memory. This allows any server instance to know who is online globally.
3. **Redis Utility**: Redis clients are managed via `server/utils/redis.ts` to ensure clean lifecycle management and prevent circular dependencies.
4. **Scoped Broadcasts**: Real-time updates (e.g., "Support Specialist joined") are scoped to `partner:{id}` rooms to minimize network overhead.

### Event Flow: Ticket Creation to Resolution

```mermaid
sequenceDiagram
    participant A as Agent
    participant S as Server (Redis)
    participant E as Support Specialist

    A->>S: ticket:new (Dept, Ref)
    A-->>E: ticket:created (Scoped Broadcast)
    E->>S: support:join (TicketId)
    S-->>A: support:joined (Ticket Participants)
    Note over A,E: Real-time Chat Active
    A->>S: message:send (Text)
    S->>S: Message Guards (Safety/Quality)
    S->>S: AI Translation (Check ai_enabled)
    S-->>E: message:new (Translated)
    E->>S: message:send (Internal/Normal)
    S-->>A: message:new (Original)
    E->>S: ticket:close (Notes)
    S-->>A: ticket:closed (Trigger Rating)
```

---

## 4. Database Schema

### Core Tables

```sql
partners           (id, name, industry, primary_color, secondary_color, 
                    ref_1_label, ref_2_label, ai_rules, departments, ai_enabled,
                    agent_prompt_strategy, support_prompt_strategy, enable_actionable_ai,
                    theme_config, ollama_model)
users              (id, name, lang, password, avatar_url, is_platform_operator)
memberships        (id, user_id, partner_id, role, dept)
tickets            (id, partner_id, dept, agent_id, agent_name, agent_lang, 
                    ref_1, ref_2, status, support_id, support_name, 
                    support_lang, support_joined_at, created_at, closed_at, 
                    closing_notes, closed_by, participants, summary)
messages           (id, ticket_id, sender_id, sender_name, text, translated_text, 
                    media_url, whisper, system, created_at, reactions, 
                    sentiment, canned_response_id)
ratings            (id, ticket_id, agent_id, support_id, rating, comment, created_at)
daily_stats        (date, partner_id, total, closed, abandoned, avg_response_ms, 
                    avg_duration_ms, avg_rating, sla_health, p95_response_ms, 
                    reopened, sentiment_sum, sentiment_count)
```

**JSON columns**: `participants`, `reactions`, `deptCounts`, `ratingsByDept`, `hourly`, `questions` are stored as JSON strings and parsed at query time.

---

## 5. Observability (Prometheus + Grafana)

The platform exposes Prometheus metrics at `/metrics` via `prom-client`. When running in Docker, Prometheus and Grafana are automatically provisioned.

### Metrics Exposed

| Metric | Type | Labels | Description |
|---|---|---|---|
| `http_request_duration_seconds` | Histogram | method, route, status | HTTP request latency |
| `http_requests_total` | Counter | method, route, status | Total HTTP requests |
| `socketio_connections_active` | Gauge | — | Active WebSocket connections |
| `socketio_events_total` | Counter | event | Socket.io events processed |
| `tickets_active_total` | Gauge | partner_id | Open/active tickets |
| `ticket_queue_depth` | Gauge | partner_id | Tickets awaiting support |
| `ai_pipeline_duration_seconds` | Histogram | type | AI pipeline call latency |
| `ai_pipeline_errors_total` | Counter | type | AI pipeline failures |

### Architecture
- **Metrics middleware** (`server/middleware/metrics.ts`): Instruments all HTTP requests.
- **Socket.io instrumentation**: Connection gauge + event counters in `server/socket/handlers.ts`.
- **AI pipeline timing**: Histogram wrapping Ollama calls in `server/services/translate.ts`.
- **Grafana dashboard**: Pre-provisioned 8-panel dashboard at `monitoring/grafana/dashboards/tessera.json`.

---

## 6. Data Lifecycle & Compliance (GDPR)

The platform enforces a 30-day data retention policy via the `gdpr.ts` service:

1. **Daily Purge Cycle**: A background job runs every 24 hours, scanning for records older than 30 days.
2. **Aggregation Before Deletion**: Before purging, ticket and message data is aggregated into the `daily_stats` table (counts, averages, sentiment sums) — preserving operational insights without PII.
3. **Transactional Safety**: The aggregation and deletion run inside a single Drizzle transaction to prevent data loss.
4. **What's Purged**: Messages, tickets, ratings, and translation cache entries older than the retention window.
5. **What's Kept**: Anonymized `daily_stats` rows, partner configuration, and user accounts (until explicit deletion request).
