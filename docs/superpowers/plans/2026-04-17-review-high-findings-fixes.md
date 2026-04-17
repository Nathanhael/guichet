# Fix 6 HIGH findings from 2026-04-17 review

**Status:** Proposed
**Source:** [2026-04-17-full-review.md](../reviews/2026-04-17-full-review.md)
**Strategy:** 5 focused PRs, sequenced by blast radius + dependency. Each phase ships independently.

## PR order at a glance

| # | Phase | Effort | Risk | Blocks |
|---|-------|--------|------|--------|
| 1 | Dev-login production gate | 5 min | trivial | — |
| 2 | Message soft-delete blob cleanup | 30 min | low | — |
| 3 | Archive snapshot transaction | 15 min | trivial | — |
| 4 | Migration journal + CI rebuild | 2–3 h | medium | fresh deploys |
| 5 | Redis-backed authLimiter | 1 h | low | horizontal scale |

PR 1–3 can land in parallel. PR 4 is the tricky one and should be verified against a fresh DB. PR 5 depends on nothing but is the highest-effort.

---

## PR 1 — Gate dev-login route at mount time (HIGH #1)

**Branch:** `fix/dev-login-production-gate`
**Files:** `server/routes/auth/index.ts`

### Why
Runtime `NODE_ENV === 'production'` check inside handler is fragile: any env where `NODE_ENV` is unset/misspelled/staging exposes an auth-bypass mint-any-JWT endpoint. Move gate to registration site so the route literal does not exist in prod.

### Steps
1. Edit [server/routes/auth/index.ts:14](../../../server/routes/auth/index.ts):
   ```ts
   import config from '../../config.js';
   // ...
   if (config.NODE_ENV !== 'production') {
     registerDevLoginRoutes(router);
   }
   ```
2. Leave the in-handler 404 as belt-and-suspenders (defense in depth).
3. Add a test in `server/__tests__/` asserting `POST /api/v1/auth/dev-login` returns 404 when `config.NODE_ENV === 'production'`. Use env override pattern already used in other tests.

### Verify
- `docker compose exec server npm test` — new test passes.
- E2E suite still green (still runs in non-prod, `loginAsDemo` helper unaffected).
- Grep `registerDevLoginRoutes` — only call site is the new guarded one.

### Commit
```
fix(auth): gate dev-login route at mount time, not in handler

Runtime NODE_ENV check inside the handler left the route literal
mounted in all environments. A misconfigured env string exposed
auth bypass. Move the guard to registration so the route does not
exist in production at all.
```

---

## PR 2 — Delete blobs on message soft-delete (HIGH #5)

**Branch:** `fix/soft-delete-blob-cleanup`
**Files:** `server/services/messageQueries.ts`, `server/services/storage.ts` (maybe), `server/services/messageQueries.test.ts`

### Why
[messageQueries.ts:223–229](../../../server/services/messageQueries.ts) nulls `mediaUrl` on soft-delete but never calls `storage.delete()`. Blobs linger in S3/Azure until GDPR purge (30 days). Users and staff expect deletion to mean deletion.

### Steps
1. Before the DB update in `softDeleteMessage`, load the current `mediaUrl` and `attachments` (check schema — if `messages.attachments` JSONB exists, handle both).
2. Extract filename segment from each URL (strip `/uploads/` prefix or CDN host).
3. Fire-and-forget `getStorage().delete(filename).catch(err => logger.warn({ err, messageId, filename }, '[msgQueries] blob delete failed'))` — **after** the DB update succeeds (don't orphan the DB row on storage failure).
4. Return the existing `now` value.

### Verify
- Unit test: mock `storage.delete`, call `softDeleteMessage`, assert `delete` called with correct filename(s).
- Unit test: storage error does not throw (fire-and-forget).
- Manual: upload file, delete message, check S3/Azure console — blob gone.
- Audit log sanity — no new log lines on happy path.

### Risks
- Legacy messages with non-storage mediaUrl (external CDN, broken URL) — `storage.delete` on a non-filename path should be a noop/warn, not throw. Verify `storage.delete` contract.
- Mass-delete flows (admin deleting many messages) — one storage call per message is fine at human scale; batch if `message:delete:many` exists.

### Commit
```
fix(storage): delete blobs when messages are soft-deleted

softDeleteMessage nulled mediaUrl but left the blob in S3/Azure
until the 30-day GDPR purge. User expectation is that delete
means delete. Fire-and-forget storage.delete after the DB update
so a storage outage does not block the DB write.
```

---

## PR 3 — Wrap snapshotTicketToArchive in a transaction (HIGH #6)

**Branch:** `fix/archive-snapshot-atomic`
**Files:** `server/services/archive.ts`

### Why
[archive.ts:187–211](../../../server/services/archive.ts) issues three sequential DB ops (select ticket, count messages, insert archive) with no surrounding transaction. Concurrent writes between ops produce incorrect `messageCount`. The batch path already uses `db.transaction()` — fix the regression.

### Steps
1. Wrap the existing body of `snapshotTicketToArchive` in `db.transaction(async (tx) => { ... })`.
2. Replace all `db.select/insert` with `tx.select/insert` inside the transaction.
3. Keep the `onConflictDoNothing()` — idempotency preserved.
4. The `if (!ticket)` and `if (ticket.status !== 'closed')` checks happen after the select, inside the transaction — they return early (implicitly committing an empty transaction, which is fine).

### Verify
- Unit test that asserts the function uses a transaction (mock `db.transaction`, assert called).
- Integration test if `archive.test.ts` exists: close a ticket, assert `archived_tickets.messageCount` matches `messages` row count.
- Manual: close a ticket with 10 messages, check archive row.

### Risks
- None — `onConflictDoNothing` preserves idempotency inside a transaction.

### Commit
```
fix(archive): wrap snapshotTicketToArchive in a transaction

Three sequential DB ops (select ticket, count messages, insert)
raced against concurrent writes to produce incorrect messageCount.
The batch archiveTickets() path already uses a transaction; fix
the on-close snapshot to match.
```

---

## PR 4 — Rebuild Drizzle migration journal + flip CI to `migrate` (HIGH #2 + #3 + LOW #5)

**Branch:** `fix/drizzle-journal-rebuild`
**Files:** `server/drizzle/meta/_journal.json`, `server/drizzle/meta/*_snapshot.json`, `server/drizzle/0006_ratings_outlive_tickets.sql` (rename), `scripts/ci.ps1`

### Why
Journal has 3 entries (idx 0–2); 10 migration files exist. `npm run db:migrate` (production path per docs) skips 7 migrations on a fresh DB, including `users.is_external` required by the B2B guest feature. CI hid this by using `drizzle-kit push --force` which bypasses the journal. Must fix together or CI will remain broken.

### Preconditions
1. `docker compose down -v` — be ready to blow away a dev DB for verification.
2. Backup current `_journal.json` and `server/drizzle/meta/` — these regenerate.
3. Confirm with team that no one has a partially-migrated DB in a shared env. If they do, they'll need `db:baseline` after this lands.

### Steps

#### 4.1 — Resolve the dual 0006 collision
- Rename `server/drizzle/0006_ratings_outlive_tickets.sql` → `server/drizzle/0007_ratings_outlive_tickets.sql`.
- Renumber `0007_partner_auth_method.sql` → `0008_partner_auth_method.sql`.
- Renumber `0008_drop_auth_method.sql` → `0009_drop_auth_method.sql`.
- Renumber `0009_drop_users_auth_method.sql` → `0010_drop_users_auth_method.sql`.
- Grep for any plan/doc that references old numbers; update references in `docs/superpowers/plans/2026-04-17-drop-users-auth-method.md` (marked Shipped — update migration line to reflect new number).

#### 4.2 — Rebuild journal + snapshots
Best path: regenerate from scratch using drizzle-kit itself against a fresh DB.

Option A (preferred — regenerate):
1. `docker compose down -v && docker compose up -d db`
2. `docker compose exec server npx drizzle-kit generate` — will detect all migrations and rebuild snapshots + journal.
3. Inspect the resulting `_journal.json` — should have 10 entries (0000–0009 post-rename).
4. Inspect each `*_snapshot.json` for correctness.

Option B (hand-edit if A fails):
1. Write `_journal.json` entries manually — copy the existing idx 0–2 format, use current timestamp in `when` for each new entry, tag matches filename minus `.sql`.
2. Run `drizzle-kit generate --custom` or similar to produce snapshots; diff against Option A output.

#### 4.3 — Verify fresh-DB migration path
1. `docker compose down -v` (wipe DB)
2. `docker compose up -d db`
3. `docker compose exec server npm run db:migrate` (NOT `push`)
4. `docker compose exec db psql -U user -d guichet -c "\dt"` — confirm all tables present.
5. Spot-check critical columns: `\d users` has `is_external`; `\d messages` has `sender_is_external` and `search_vector`; `\d ratings` does not cascade on ticket delete.
6. `docker compose exec server npx tsc --noEmit` — schema.ts matches DB.

#### 4.4 — Flip CI to `migrate`
- Edit [scripts/ci.ps1:47](../../../scripts/ci.ps1):
  ```powershell
  Run-Step "migrate" @("docker compose exec server npx drizzle-kit migrate")
  ```
- Run `powershell -File scripts/ci.ps1 -Skip e2e` against a fresh DB (destroy volume first) — must pass end-to-end.

#### 4.5 — Document migration path for existing envs
- Add a note to `CLAUDE.md` or `docs/BREAK_GLASS_RUNBOOK.md`: "If your DB was set up via `drizzle-kit push` before 2026-04-17, run `npm run db:baseline` once to seed the ledger with the current schema, then `db:migrate` will work going forward."

### Verify
- Fresh-DB path (4.3) passes fully.
- Existing-DB path: spin up a DB from a backup predating this change, run `db:baseline`, then `db:migrate` — no-op expected (ledger and schema in sync).
- CI green against both fresh and baselined DB.

### Risks
- **Rename breaks anyone with a half-applied DB.** Mitigation: `db:baseline` script handles this. Document clearly.
- **Snapshot JSON drift.** Diff Option A vs B outputs if both done. Commit whichever matches a fresh migrate.
- **Migration order changes behavior.** Unlikely — the current files are already in order numerically, just the journal is missing entries. Renaming 0006b→0007 doesn't change SQL ordering since both were being applied anyway.

### Commit
```
fix(db): rebuild Drizzle migration journal + switch CI to drizzle-kit migrate

The journal was stale at idx=2 while 10 migration files existed.
npm run db:migrate (the documented production path) left fresh
databases missing 7 migrations, including users.is_external for
the B2B guest feature. CI used `drizzle-kit push --force`, which
bypasses the journal and hid the drift.

- Rename 0006_ratings_outlive_tickets.sql → 0007 and shift
  subsequent files to resolve dual-0006 collision
- Regenerate _journal.json + snapshots via `drizzle-kit generate`
  against a fresh DB
- Flip scripts/ci.ps1 migrate step from `push --force` to `migrate`
  so future journal drift fails CI immediately
- Document db:baseline path for partially-migrated envs in
  BREAK_GLASS_RUNBOOK.md
```

---

## PR 5 — Redis-backed authLimiter (HIGH #4)

**Branch:** `fix/auth-rate-limit-redis`
**Files:** `server/app.ts`, `server/package.json`

### Why
[app.ts:135–158](../../../server/app.ts) uses `express-rate-limit` default in-memory store for `authLimiter` (5 req/min), `trpcLimiter` (200 req/min), `uploadLimiter` (10 req/min), `globalLimiter` (100/min). Multi-instance deploys (AWS/Azure docs recommend these) get N× the effective limit. DB-level lockout backstops login brute-force, but the HTTP limiter is not distributed-safe.

### Scope
Start with `authLimiter` only — it's the highest-risk (5 req/min). Leave other limiters for a follow-up unless effort is free.

### Steps
1. `docker compose exec server npm install rate-limit-redis`
2. In `server/app.ts`, import `RedisStore` from `rate-limit-redis` and the existing Redis client factory from `server/utils/redis.ts`.
3. Pass a `store: new RedisStore({ sendCommand: (...args) => redis.sendCommand(args) })` option to the `authLimiter` constructor. Verify the Redis client API matches the store's expected interface — ioredis vs node-redis v4 vs v5 have different shapes.
4. Keep in-memory fallback: if Redis is unavailable at construction, fall back to default store with a loud `logger.warn`. `globalLimiter` can stay in-memory since it's a second backstop.
5. Verify that the authLimiter `keyGenerator` uses the real client IP (behind lb/proxy) via Express `trust proxy` setting — already set? confirm.

### Verify
- Local: hit `/api/v1/auth/login` with wrong creds 5 times in rapid succession from one IP — 6th request blocked.
- Restart server — counter persists (Redis-backed). Before the change, counter would reset.
- Multi-instance simulation: `docker compose up --scale server=2`, hit login through the load balancer — 5 total attempts across both instances triggers lockout (previously would have allowed 10).
- Redis failure test: `docker compose stop redis`, server stays up, limiter falls back to in-memory with a WARN log.

### Risks
- **Redis client API mismatch** between `rate-limit-redis` expectations and the installed client. Test early in step 3.
- **Rolled back key generator** — ensure per-IP keys, not per-process keys.

### Commit
```
fix(security): Redis-backed auth rate limiter for multi-instance safety

express-rate-limit default store is in-memory and per-process. In a
horizontally-scaled deployment each instance maintains its own
counter, effectively multiplying the rate limit by the instance
count. Wire authLimiter to Redis via rate-limit-redis so the 5
req/min bucket is shared across instances. Falls back to in-memory
with a warn if Redis is unavailable at startup.
```

---

## Out of scope for this plan

Not addressed here; track separately:
- **M1 linkPreview rate limit** — worth a small follow-up PR; same Redis-backed pattern.
- **M2 stranded invited users** — needs a product decision (pendingInvite column? restrict to platform operators?). Spec before code.
- **M4 statsQueries Zod parse** — needs snapshot test plan first (deferred from prior review for the same reason).
- **M8 Prometheus scrape** — config-only fix but needs coordination with whoever owns monitoring.
- **M9 FIELD_ENCRYPTION_SECRET in prod compose** — quick fix, bundle into a "compose hardening" sweep.
- **M10 SMTP credential encryption** — needs a migration script; size it separately.
- **M11 VAPID placeholder swap** — 2-line fix; bundle into the compose sweep.
- **All LOW findings** — batch into one "quality sweep" PR once HIGH are all landed.

## Sequencing recommendation

- **Week 1:** PR 1, PR 2, PR 3 in parallel (reviewable in a single sitting).
- **Week 2:** PR 4 (migration journal) — needs focused attention, fresh-DB verification, and coordination if anyone has partially-migrated environments.
- **Week 2–3:** PR 5 (Redis limiter) — moderate effort, no hard dependencies.
- **Follow-ups:** MEDIUM/LOW sweep PR once HIGH queue drains.

Each PR should link back to the [consolidated review](../reviews/2026-04-17-full-review.md) in its description so the trail from finding → fix is legible.
