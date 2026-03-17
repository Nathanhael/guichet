# Technical Documentation: Tessera (Clean Slate)

This document provides an overview of the core architecture for the simplified Tessera platform.

---

## 1. High-Level Architecture

The platform follows a real-time, event-driven architecture designed for high availability.

### Core Stack
- **Frontend**: React 18, Vite 5, Tailwind CSS 3. (Framer Motion logic is deactivated).
- **API**: **tRPC** for type-safe requests + **Socket.io** for real-time events.
- **Scaling**: **Redis** for Socket.io horizontal scaling and distributed presence.
- **Database**: PostgreSQL 16 + **Drizzle ORM**.

---

## 2. Multi-Tenant Architecture

Logic and data are isolated via a Partner/Membership model.

### Data Isolation
All database queries must include a `partner_id` filter to ensure strict tenant isolation.

### Standardized UI
Partner-specific branding logic has been replaced by a global **B&W Minimalist Standard**. This ensures all users benefit from the same high-performance, accessible interface regardless of their organization.

---

## 3. Real-Time Engine

### Horizontal Scaling (Redis)
1. **Socket.io Redis Adapter**: Syncs chat events across multiple server instances.
2. **Distributed Presence**: Online user status is stored in Redis Hashes.
3. **Message Lifecycle**: Supports `typing`, `delivered`, and `read` events globally.

---

## 4. Deactivated Components (Backlog)

The following components are currently disconnected to focus on core chat stability:
- **AI Asymmetric Pipeline**: Automated translation and script generation.
- **Topic Heat Detection**: Background worker for emerging incident detection.
- **GDPR Purge Service**: Automated PII data retention policy.
- **Agent Lite PWA**: Mobile-optimized field agent view.

---

## 5. API Design

- **tRPC Endpoint**: `/api/v1/trpc` — Main type-safe application logic.
- **REST Endpoints**:
    - `POST /api/v1/auth/login`: JWT-based authentication.
    - `POST /api/v1/uploads`: Simple file upload validation.
- **Health Check**: `/api/v1/health` — Basic DB and Redis connectivity.
