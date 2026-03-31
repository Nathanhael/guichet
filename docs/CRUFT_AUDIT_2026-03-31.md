# Tessera Cruft Audit — 2026-03-31

## Scope

Repo-wide pass across tracked source, config, scripts, load tests, and local artifacts.

Method used:
- direct import/reference tracing
- package/compose/runtime entrypoint verification
- search for repo references to standalone scripts
- schema cross-checks for seed scripts
- local artifact review for ignored/untracked leftovers

## Findings

### 1. Confirmed Unused Or Delete-Safe

#### 1.1 `client/src/test/helpers.tsx` — confirmed unused

File: [client/src/test/helpers.tsx](D:/Projects_Coding/tessera/client/src/test/helpers.tsx#L1)

Why it looks dead:
- It defines test factories and mocks, but I found no tracked imports of it anywhere in `client/src`.
- Current platform tests inline their own fixtures and mocks instead of reusing this helper.

Assessment:
- High confidence delete-safe.

#### 1.2 `client/replacer.js` — orphaned codemod script ✅ DELETED

File: [client/replacer.js](D:/Projects_Coding/tessera/client/replacer.js#L1)

Why it looks dead:
- It is a one-off search/replace script for old Tailwind class names.
- I found no tracked references from README, package scripts, Vite, Docker, tests, or source code.

Assessment:
- High confidence delete-safe.

#### 1.3 Local generated artifacts and leftovers ✅ DELETED

Delete-safe local artifacts:
- `client/dist/`
- `test-results/`
- `client/test-results/`
- empty directory `D:\Projects_Coding\tessera\DProjects_Codingtesseradocssuperpowersplans`

Evidence:
- [`.gitignore`](D:/Projects_Coding/tessera/.gitignore#L55) ignores `test-results/`
- [`.gitignore`](D:/Projects_Coding/tessera/.gitignore#L56) ignores `client/test-results/`
- `client/dist/` is a build artifact and is already ignored by the root `dist/` rule in [`.gitignore`](D:/Projects_Coding/tessera/.gitignore#L9)
- the weird `D...` directory is empty and untracked

Assessment:
- High confidence delete-safe.

### 2. Stale Or Broken Files

#### 2.1 `server/scripts/seed_test_data.ts` — stale against current schema ✅ DELETED

File: [server/scripts/seed_test_data.ts](D:/Projects_Coding/tessera/server/scripts/seed_test_data.ts#L221)

This script appears to target an older schema:
- it inserts `users` rows with `role` and `dept` columns at [server/scripts/seed_test_data.ts](D:/Projects_Coding/tessera/server/scripts/seed_test_data.ts#L221)
- current `users` table does not have `role` or `dept`; role now lives on `memberships` at [server/db/schema.ts](D:/Projects_Coding/tessera/server/db/schema.ts#L37) and [server/db/schema.ts](D:/Projects_Coding/tessera/server/db/schema.ts#L84)
- it inserts legacy ticket shapes starting at [server/scripts/seed_test_data.ts](D:/Projects_Coding/tessera/server/scripts/seed_test_data.ts#L288), while current tickets use `agentId` / `agentName` / `agentLang` / `supportId` / `references` as shown in [server/db/schema.ts](D:/Projects_Coding/tessera/server/db/schema.ts#L91), [server/db/schema.ts](D:/Projects_Coding/tessera/server/db/schema.ts#L95), [server/db/schema.ts](D:/Projects_Coding/tessera/server/db/schema.ts#L98), and [server/db/schema.ts](D:/Projects_Coding/tessera/server/db/schema.ts#L100)
- it inserts ratings with `expert_id` at [server/scripts/seed_test_data.ts](D:/Projects_Coding/tessera/server/scripts/seed_test_data.ts#L368), but current schema uses `supportId` at [server/db/schema.ts](D:/Projects_Coding/tessera/server/db/schema.ts#L154) and [server/db/schema.ts](D:/Projects_Coding/tessera/server/db/schema.ts#L159)

Reference drift:
- `seed_test_data.ts` is only documented in [docs/FILE_GUIDE.md](D:/Projects_Coding/tessera/docs/FILE_GUIDE.md#L213)

Assessment:
- High confidence stale and currently broken.
- Either delete it or rewrite it for the current schema before anyone tries to use it.

#### 2.2 `testing/load/load-500.js` — stale auth model ✅ DELETED

File: [testing/load/load-500.js](D:/Projects_Coding/tessera/testing/load/load-500.js#L67)

Why it is suspect:
- it sends `Authorization: Bearer ...` at [testing/load/load-500.js](D:/Projects_Coding/tessera/testing/load/load-500.js#L67)
- current auth writes the session into the `tessera_token` cookie at [server/services/authSession.ts](D:/Projects_Coding/tessera/server/services/authSession.ts#L117), [server/services/authSession.ts](D:/Projects_Coding/tessera/server/services/authSession.ts#L143), and [server/services/authSession.ts](D:/Projects_Coding/tessera/server/services/authSession.ts#L145)
- tRPC context reads `req.cookies?.tessera_token` at [server/trpc/context.ts](D:/Projects_Coding/tessera/server/trpc/context.ts#L39)
- the script also hardcodes `alice@acme.com` and `acme-corp` at [testing/load/load-500.js](D:/Projects_Coding/tessera/testing/load/load-500.js#L45) and [testing/load/load-500.js](D:/Projects_Coding/tessera/testing/load/load-500.js#L71), but the standard README seed path uses `seed_pg.ts` at [README.md](D:/Projects_Coding/tessera/README.md#L41), which seeds `tessera-main`, not `acme-corp`

Assessment:
- High confidence stale.
- It should either be updated to cookie-based auth and documented seeding requirements, or removed.

#### 2.3 `testing/load/load.js`, `testing/load/ws.js`, `testing/load/ws-500.js` — usable, but seeded against a different dataset than README

Files:
- [testing/load/load.js](D:/Projects_Coding/tessera/testing/load/load.js#L5)
- [testing/load/ws.js](D:/Projects_Coding/tessera/testing/load/ws.js#L53)
- [testing/load/ws-500.js](D:/Projects_Coding/tessera/testing/load/ws-500.js#L52)

Why they are risky:
- they depend on `alice@acme.com` / `acme-corp`, which comes from `seed_e2e.ts`, not the README quickstart seed
- README only documents `seed_pg.ts` and basic k6 commands at [README.md](D:/Projects_Coding/tessera/README.md#L41), [README.md](D:/Projects_Coding/tessera/README.md#L87), and [README.md](D:/Projects_Coding/tessera/README.md#L88)

Assessment:
- Medium confidence not-dead but misleading.
- Keep if you still use them, but document the required seed explicitly.

#### 2.4 `testing/load/debug.js` and `testing/load/refresh.js` — manual-only and weakly documented

Files:
- [testing/load/debug.js](D:/Projects_Coding/tessera/testing/load/debug.js#L1)
- [testing/load/refresh.js](D:/Projects_Coding/tessera/testing/load/refresh.js#L1)

Why they are suspect:
- they are listed in [docs/FILE_GUIDE.md](D:/Projects_Coding/tessera/docs/FILE_GUIDE.md#L438) and [docs/FILE_GUIDE.md](D:/Projects_Coding/tessera/docs/FILE_GUIDE.md#L441)
- they are not listed in the actual load test README table, which only includes `smoke.js`, `load.js`, `ws.js`, `load-500.js`, and `ws-500.js` at [testing/load/README.md](D:/Projects_Coding/tessera/testing/load/README.md#L35)
- I found no package scripts or top-level docs that call them

Assessment:
- Medium confidence stale/manual-only.
- Keep only if they are part of someone’s active troubleshooting workflow.

#### 2.5 `server/package.json` start script is out of sync with the production image ✅ FIXED

Files:
- [server/package.json](D:/Projects_Coding/tessera/server/package.json#L7)
- [server/Dockerfile.prod](D:/Projects_Coding/tessera/server/Dockerfile.prod#L27)

Why it matters:
- `package.json` says `node dist/app.js`
- production Docker runs `node dist/server/index.js`

Assessment:
- Not dead code, but definite script drift.

### 3. Manual-Only But Purposeful Files

These are not automatically wired into npm scripts, but they still look intentional and valid:

- [server/seed_pg.ts](D:/Projects_Coding/tessera/server/seed_pg.ts#L8)
  - documented in [README.md](D:/Projects_Coding/tessera/README.md#L41)
- [server/scripts/baseline_drizzle.ts](D:/Projects_Coding/tessera/server/scripts/baseline_drizzle.ts#L59)
  - wired by `db:baseline` in [server/package.json](D:/Projects_Coding/tessera/server/package.json#L10)
- [scripts/encrypt_existing_keys.ts](D:/Projects_Coding/tessera/scripts/encrypt_existing_keys.ts#L1)
  - one-time migration, documented in [docs/FILE_GUIDE.md](D:/Projects_Coding/tessera/docs/FILE_GUIDE.md#L454)
- [server/scripts/reset_demo_users.ts](D:/Projects_Coding/tessera/server/scripts/reset_demo_users.ts#L1)
  - manual recovery/reset utility, documented in [docs/FILE_GUIDE.md](D:/Projects_Coding/tessera/docs/FILE_GUIDE.md#L210)

Assessment:
- Keep unless you explicitly want to remove operator tooling.

### 4. Docs And Tooling Drift

#### 4.1 `server/eslint.config.js` exists locally, but is ignored and not wired up ✅ DELETED (local file removed, FILE_GUIDE updated)

Files:
- [server/eslint.config.js](D:/Projects_Coding/tessera/server/eslint.config.js#L1)
- [docs/FILE_GUIDE.md](D:/Projects_Coding/tessera/docs/FILE_GUIDE.md#L41)
- [`.gitignore`](D:/Projects_Coding/tessera/.gitignore#L15)

Why it is drift:
- the file exists locally and imports ESLint packages at [server/eslint.config.js](D:/Projects_Coding/tessera/server/eslint.config.js#L3)
- `docs/FILE_GUIDE.md` treats it as part of the repo at [docs/FILE_GUIDE.md](D:/Projects_Coding/tessera/docs/FILE_GUIDE.md#L41)
- but the root ignore file excludes `server/**/*.js` at [`.gitignore`](D:/Projects_Coding/tessera/.gitignore#L15), so this config is not actually tracked

Assessment:
- High confidence tooling drift.
- Either unignore and wire it properly, or remove the local file and stop documenting it.

#### 4.2 PWA files are active and should not be mistaken for dead assets

Files:
- [client/public/sw.js](D:/Projects_Coding/tessera/client/public/sw.js#L1)
- [client/src/main.tsx](D:/Projects_Coding/tessera/client/src/main.tsx#L59)
- [client/vite.config.ts](D:/Projects_Coding/tessera/client/vite.config.ts#L9)

Why this matters:
- `sw.js` is registered at runtime in [client/src/main.tsx](D:/Projects_Coding/tessera/client/src/main.tsx#L59)
- Vite mutates the built service worker during build at [client/vite.config.ts](D:/Projects_Coding/tessera/client/vite.config.ts#L25)

Assessment:
- Active; not a cleanup target.

## Verdict

### High-confidence cleanup candidates

- delete [client/src/test/helpers.tsx](D:/Projects_Coding/tessera/client/src/test/helpers.tsx#L1)
- delete [client/replacer.js](D:/Projects_Coding/tessera/client/replacer.js#L1)
- delete local artifacts `client/dist/`, `test-results/`, `client/test-results/`, and the empty `DProjects_Codingtesseradocssuperpowersplans/` directory
- delete or fully rewrite [server/scripts/seed_test_data.ts](D:/Projects_Coding/tessera/server/scripts/seed_test_data.ts#L221)
- fix or remove [testing/load/load-500.js](D:/Projects_Coding/tessera/testing/load/load-500.js#L67)

### Medium-confidence cleanup candidates

- remove [testing/load/debug.js](D:/Projects_Coding/tessera/testing/load/debug.js#L1) if no one actively uses it
- remove [testing/load/refresh.js](D:/Projects_Coding/tessera/testing/load/refresh.js#L1) if no one actively uses it

### Keep

- the runtime/server core, DB layer, migrations, tRPC core, PWA assets, and compose files
- the manual admin/ops scripts that still match current behavior

## Recommended Next Actions

1. ~~Delete the confirmed dead files and local artifacts.~~ ✅ Done
2. ~~Remove or rewrite `server/scripts/seed_test_data.ts`.~~ ✅ Deleted
3. ~~Decide whether the k6 suite is meant to target `seed_pg.ts` data or `seed_e2e.ts` data, then document one path consistently.~~ ✅ Documented seed_e2e.ts requirement in testing/load/README.md
4. ~~Fix the `server/package.json` `start` script drift.~~ ✅ Fixed to `dist/server/index.js`
5. ~~Either track ESLint properly or stop documenting `server/eslint.config.js`.~~ ✅ Deleted local file, removed from FILE_GUIDE.md
