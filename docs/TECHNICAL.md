# Technical Documentation: Tessera (Clean Slate)

This document provides an overview of the core architecture for the simplified, high-performance Tessera platform.

---

## 1. Enterprise Schema (PostgreSQL)

The database has been overhauled for type safety and performance:
- **Native JSONB**: All structured data (`departments`, `participants`, `reactions`) uses native JSONB for efficient nested querying.
- **PG Enums**: Enforced data integrity for `user_role`, `ticket_status`, and `severity`.
- **Audit Tracking**: Consistent `created_at`, `updated_at`, and `deleted_at` (soft delete) columns across all core entities.
- **Azure Identity Prep**: Added `email` and `external_id` columns to support OIDC integration.

---

## 2. Dynamic Organizational Structure

Tessera is 100% data-driven. Hardcoded constants for departments have been removed.
- **Manifest-Driven**: The `SupportView` generates filters based on the `departments` JSONB array in the `partners` table.
- **Adaptive UI**: Horizontal scrollable bar handles large department lists without layout breaks.
- **Platform Manager**: CRUD tools in `PlatformView` allow real-time structure changes without code deployment.

---

## 3. Real-Time Engine (Socket.io & Redis)

- **Horizontal Scaling**: Uses the Redis adapter to sync events across server instances.
- **Distributed Presence**: Online status tracked via Redis Hashes.
- **Core Events**: Optimized for `message`, `typing`, and `presence` with zero animation overhead on the frontend.

---

## 4. UI Architecture (Static B&W)

- **Standardization**: Decoupled theme from partner data. All organizations use the global monochrome standard.
- **Motion Stripped**: All Framer Motion and CSS transitions have been removed to prioritize immediate responsiveness.
- **Contrast Optimization**: Solid black/white surfaces ensure maximum readability in both Light and Dark modes.

---

## 5. API Strategy

- **tRPC**: Main application logic with end-to-end type safety.
- **REST**: Limited to legacy Auth and File Uploads.
- **Dynamic Headers**: Authorization tokens are fetched dynamically from the store for every tRPC request.
