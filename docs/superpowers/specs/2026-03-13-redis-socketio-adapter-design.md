# Redis Socket.io Adapter — Design Spec

**Date:** 2026-03-13
**Status:** Completed
**Goal:** Add Redis adapter to Socket.io so horizontal scaling works (multiple server instances share room state).

## Context

Socket.io rooms are in-memory per instance. Without an adapter, a message emitted on instance A never reaches clients connected to instance B. This is a blocker for any multi-container Azure deployment.

## Scope

Local Docker setup now. Azure Cache for Redis later — one env var swap.

## Design

### Redis service (`docker-compose.yml`)
Add an `redis` service using the official `redis:7-alpine` image. Expose port `6379`. No persistence needed for this use case.

### Server packages
- `@socket.io/redis-adapter` — official Socket.io adapter
- `redis` — Node's native Redis client (not ioredis)

### Wiring (`server/app.ts`)
Before `io` starts accepting connections:
1. Create two Redis clients (`pubClient`, `subClient`) from `REDIS_URL`
2. Call `io.adapter(createAdapter(pubClient, subClient))`
3. If Redis connection fails → log a warning, continue with in-memory adapter (dev safety net)

### Configuration
- `REDIS_URL` env var, default `redis://localhost:6379`
- Add to `server/config.ts` alongside existing env vars
- Add `REDIS_URL=redis://redis:6379` to `docker-compose.yml` server environment

### Azure migration path
Swap `REDIS_URL` to the Azure Cache for Redis connection string. No code changes needed.

## Files to touch
- `docker-compose.yml` — add redis service, add REDIS_URL to server env
- `server/package.json` — add @socket.io/redis-adapter, redis
- `server/config.ts` — add REDIS_URL
- `server/app.ts` — wire adapter on startup

## Out of scope
- Redis persistence / AOF
- Redis auth (not needed for local dev)
- ioredis (overkill here)
- Azure Cache for Redis setup (future)
