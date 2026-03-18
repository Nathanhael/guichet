# GEMINI.md - Project Context & Instructions (Clean Slate)

This file serves as the primary instructional context for Gemini CLI. The project is currently in a "Clean Slate" phase, prioritizing core chat functionality and a strict monochrome aesthetic.

## Project Overview
**Tessera** is a real-time, multi-tenant customer support platform. All complex features (AI Pipeline, Topic Heat, Solaris Design System) have been **deactivated** to focus on a lightweight, high-performance chat core.

### Active Features
- **Real-Time Communication**: Core chat functionality via Socket.io.
- **Dynamic Org Structure**: Departments are 100% data-driven via Partner JSONB.
- **B&W Minimalist Standard**: A strictly monochrome, static UI designed for maximum readability and zero motion.
- **Enterprise Schema**: Optimized with native JSONB, Enums, and Audit tracking.
- **Platform Oversight**: Global dashboard for managing Partners and Users (Azure Identity ready).

### Tech Stack
- **Frontend**: React 18, Vite 5, Tailwind CSS 3, Zustand.
- **Backend**: Node.js 20 (ESM), Express.js, tRPC, Socket.io.
- **Database**: PostgreSQL 16 (JSONB/Enums) + Redis 7.

---

## 🚨 Critical Mandates

1.  **STRICT B&W**: The theme is strictly black and white. **NEVER** introduce colors, gradients, or shadows.
2.  **ZERO MOTION**: All animations, transitions, and Framer Motion logic are stripped. UI must remain static.
3.  **DYNAMIC ONLY**: Never hardcode departments (e.g., 'DSC', 'FOT'). Always read from `manifest.departments`.
4.  **DOCKER ONLY**: Never run npm/node commands on the host machine.
5.  **TYPE SAFETY**: Maintain 100% tRPC and Drizzle type safety.

---

## Building and Running

| Task | Command |
| :--- | :--- |
| **Start Development** | `docker compose up` |
| **Run Backend Tests** | `docker compose exec server npm test` |
| **Run Frontend Tests** | `docker compose exec client npm test` |
| **Database Push** | `docker compose exec server npx drizzle-kit push` |

---

## Development Conventions

- **Global User Management**: Handle user invites and partner mapping in `PlatformView.tsx`.
- **Hybrid Auth**: Pre-provision users via email; map to `external_id` upon Azure OIDC login.
- **Adaptive UI**: Use horizontally scrollable bars for department filters to handle large lists.
