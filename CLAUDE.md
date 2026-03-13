# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

M&P Support is a real-time chat web app for telecom customer support. Agents create tickets, experts handle them with live translation (Ollama LLM), and admins monitor KPIs. Three roles: `agent`, `expert`, `admin`. All code uses ES modules (`"type": "module"`).

## Commands

### Development

```bash
npm run dev              # Start both client and server concurrently
npm run install:all      # Install client + server dependencies
```

Separately:
```bash
cd server && npm run dev   # Express on port 3001 (node --watch)
cd client && npm run dev   # Vite on port 5173
```

### Docker (preferred runtime)

```bash
docker-compose up                                    # Start all services
docker exec i-pxs-support-server-1 node <file>.js   # Run a script in server container
docker logs -f i-pxs-support-server-1                # Tail server logs
```

### Testing

```bash
cd server && npm test           # Backend tests (vitest, single run)
cd server && npm run test:watch # Backend tests (watch mode)
cd client && npm test           # Frontend tests (vitest, single run)
cd client && npm run test:watch # Frontend tests (watch mode)
```

Via Docker:
```bash
docker-compose exec server npm test
docker-compose exec client npm test

> [!TIP]
> Use `docker-compose exec` over `docker exec` when possible for cleaner environment variable inheritance and simpler syntax.
```

Vitest supports filtering: `npx vitest run auth` runs only files matching "auth".

### Build

```bash
cd client && npm run build    # Vite production build
cd client && npm run preview  # Preview production build

> [!IMPORTANT]
> **Build Check**: Always run `npm run build` after major UI or dependency changes to ensure the bundle splitting and manual chunking are still effective and don't produce warnings.
```

## System Architecture

For detailed architectural diagrams, real-time message flows, and the AI translation pipeline, refer to **[ARCHITECTURE.md](./ARCHITECTURE.md)**.

### Key Conventions

- **Roles**: `agent`, `expert`, `admin`.
- **Departments**: `DSC` (Billing & Sales), `FOT` (Technical).
- **Aesthetics**: Follow the "Solaris" design system (glassmorphism, vibrant gradients). See **[CONTRIBUTING.md](./CONTRIBUTING.md)** for styling rules.
- **Safety**: Business hours enforced both server-side (socket middleware) and client-side. GDPR purge runs every 24h.
- Uploads validated by magic bytes (`file-type` package), not just MIME
- CSV exports escape formula-injection characters (`=`, `+`, `-`, `@`)
- GDPR: individual data purged after 30 days, aggregated into `daily_stats` first
- Vite proxies `/api` and `/uploads` to server (configured in `vite.config.ts`)
