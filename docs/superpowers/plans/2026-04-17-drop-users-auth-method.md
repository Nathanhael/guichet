# Drop `users.auth_method` column

**Status:** Blocked — waiting on `claude/admiring-mendel-337850` (partners.auth_method drop) to land on `main`.
**Branch (target):** rebase `claude/priceless-goldstine-686e45` onto updated `main` once unblocked.
**Migration:** `server/drizzle/0008_drop_users_auth_method.sql` (assumes parent PR lands as `0007_drop_auth_method.sql`).

## Why

Follow-up to partner-level `auth_method` removal. After parent PR lands:
- Partner `authMethod` enum/column gone → all `partner.authMethod === 'both'` branches become dead.
- `users.auth_method` text column is only written inside those dead branches ([server/trpc/routers/platform/users.ts:180](server/trpc/routers/platform/users.ts:180), [server/trpc/routers/partner/members.ts:214](server/trpc/routers/partner/members.ts:214)).
- Column becomes orphaned data. Drop it.

## Preconditions (verify before starting)

1. `git log main --oneline | grep drop.auth_method` — parent commit present.
2. `server/drizzle/0007_drop_auth_method.sql` exists on main.
3. Rebase this worktree: `git fetch origin && git rebase origin/main`.
4. Re-grep: `users.authMethod` writes/reads should only live in `listGlobalUsers` select + schema definition. If still in write paths, parent PR incomplete — stop.

## Steps

### 1. Schema + select removal
- `server/db/schema.ts` — delete line `authMethod: text('auth_method'), // Per-user auth method override (null = use partner default)` (around line 79).
- `server/trpc/routers/platform/users.ts` — remove `authMethod: users.authMethod,` from `userColumns` (line 90 in current HEAD; may shift post-rebase).

### 2. Migration
Create `server/drizzle/0008_drop_users_auth_method.sql`:
```sql
ALTER TABLE "users" DROP COLUMN IF EXISTS "auth_method";
```
Update `server/drizzle/meta/_journal.json` + generate snapshot via `docker compose exec server npx drizzle-kit generate` (or hand-edit meta if journal script available).

### 3. Apply on dev
```bash
docker exec -i guichet-db-1 psql -U user -d guichet < server/drizzle/0008_drop_users_auth_method.sql
```
Verify: `docker exec guichet-db-1 psql -U user -d guichet -c "\d users"` — no `auth_method` column.

### 4. Client follow-through
Post-rebase the client should already be clean (parent PR handled partner-level types). Sanity-grep:
- `client/src/components/platform/types.ts` — `GlobalUser` interface should not expose `authMethod`. Remove if present.
- `client/src/types/index.ts` — `User`/`Partner` shapes: drop any `authMethod` on the user shape only.
- Hunt component references: `InviteUserModal`, `AdminTeam` invite flow, `EditPartnerModal` — remove any per-user `authMethod` radios/form fields that survived the parent PR.

### 5. Test path references
Check `client/src/test/helpers.tsx:32` and `server/trpc/routers/platform.lifecycle.audit.test.ts` — drop any `authMethod` from user-shaped factories. Partner-shaped factories handled by parent PR.

### 6. Docs
- `docs/TENANT_IDENTITY_SPEC.md` — remove the line `\`users.auth_method\` text column remains on the schema as legacy data` (and any surrounding sentence that loses meaning).
- `CHANGELOG.md` — append to `Unreleased → Removed`: `users.auth_method column (legacy per-user override, orphaned after partner auth_method drop)`.

### 7. Verify
Ephemeral containers (match parent session invocation):
```bash
docker compose run --rm server npx tsc --noEmit
docker compose run --rm client npx tsc --noEmit
docker compose run --rm server npm test
docker compose run --rm client npm test
```
Then `powershell -File scripts/ci.ps1 -Skip e2e` locally.

### 8. Commit
```
refactor(auth): drop users.auth_method column

Follow-up to partners.auth_method removal. Column was only written
inside partner authMethod='both' branches, which no longer exist.
```

## Risks / rollback

- **Drizzle journal drift** — if `_journal.json` isn't regenerated correctly, `drizzle-kit push` on fresh DBs will fail. Mitigation: run `db:baseline` dry-run on a throwaway DB.
- **Production data loss** — `auth_method` values silently discarded. Acceptable: data is orphaned and unread, but note in CHANGELOG for operators running DB backups before migrate.
- **Rollback**: `ALTER TABLE users ADD COLUMN auth_method text;` restores shape but not data. Keep backup from `npm run db:backup` taken before apply.

## Out of scope

- No behavior change for SSO/local login flows (all partner-level, already handled by parent PR).
- No touch to `authSession.ts`, `sso.ts`, `routes/sso.ts` — those reference `partners.authMethod`, which is parent PR's domain.
