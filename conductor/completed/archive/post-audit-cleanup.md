# Plan: Post-Audit Cleanup & Hardening

**Created**: 2026-03-13
**Status**: Pending
**Context**: Follow-up from full project audit (MD files, code review, health check)

---

## Phase 1: Quick Wins (30 min)

### 1.1 Fix `any` types in client
- [x] `client/src/types/index.ts`: Type `AppConfig.limits`, `AppConfig.businessHours`, `StoreState.cannedResponses`, `StoreState.ratingPrompt`, `setRatingPrompt`, `updateMessageReaction`, `setCannedResponses`
- [x] `client/src/views/ExpertView.tsx`: Replace `(pObj as any).avatar` (lines 520, 603) with proper `Participant` type that includes optional `avatar`
- [x] `client/src/types/index.ts`: Remove duplicate `AgentStat` interface (lines 164 vs 206)

### 1.2 Fix `any` types in server scripts & tests
- [x] `server/seed_pg.ts`: `catch (err: any)` → `catch (err: unknown)`
- [x] `server/scripts/seed_test_data.ts`: Type `batchInsert` rows and per-entity row arrays
- [x] `server/scripts/migrate_users_json.ts`: `catch (err: any)` → `catch (err: unknown)`
- [x] `server/__tests__/auth.test.ts`: Type mock req/res objects
- [x] `server/__tests__/trpc.test.ts`: Type mock query builder and caller

---

## Phase 2: Verify & Validate (15 min)

### 2.1 Build verification
- [x] `docker-compose up --build` — confirm both client and server compile cleanly
- [x] Check server logs for `GDPR purge complete` (no DB errors)
- [x] Check client for clean Vite compilation (no warnings)

### 2.2 Run existing tests
- [x] `docker-compose exec server npm test` — all 5 test files pass
- [x] `docker-compose exec client npm test` — new store + i18n tests pass

---

## Phase 3: Expand Client Test Coverage (1-2 hrs)

### 3.1 Component render tests
- [x] `BionicText.test.tsx` — renders with bionic mode on/off
- [x] `MessageBubble.test.tsx` — renders own vs other messages, whisper, system, reactions
- [x] `BusinessHoursGuard.test.tsx` — shows/hides based on business hours state
- [x] `LoginForm.test.tsx` — form submission, validation, error display

### 3.2 Hook tests
- [x] `useSocket.test.ts` — mock socket.io-client, verify event registration and cleanup

---

## Phase 4: i18n Hardcoded Strings (30 min)

### 4.1 ExpertView hardcoded strings
- [x] "Archive" → `t('archive')`
- [x] "No results." → `t('no_results')`
- [x] "Loading…" → `t('loading')`
- [x] "All" (archive dept filter) → `t('all')`
- [x] "Load more (X remaining)" → `t('load_more')` with interpolation
- [x] "Online experts" → `t('online_experts')`
- [x] "No experts online" → `t('no_experts_online')`
- [x] "Back to queue" (title attr) → `t('back_to_queue')`
- [x] "Expert:" prefix → `t('expert_prefix')`

### 4.2 Add missing i18n keys
- [x] Add all new keys to `en`, `nl`, `fr` sections in `client/src/i18n.ts`

---

## Phase 5: Documentation Refresh (20 min)

### 5.1 CLAUDE.md updates
- [x] Mention tRPC as the primary API layer (not just Express routes)
- [x] Reference Redis adapter as implemented (not planned)
- [x] Add note about `conductor/` directory convention

### 5.2 Audit remaining MD files
- [x] `TECH_STACK.md` — verify dependency versions match package.json
- [x] `AGENT.md` — verify still accurate post-tRPC migration
- [x] `GUARDS_FEATURE.md` — verify guard count (8 or 9?) matches code
- [x] `USER_GUIDE.md` — verify demo personas still work with current seed data

---

## Notes
- Phases are independent — can be done in any order
- Phase 2 should ideally run before committing Phase 1 changes
- Phase 3 tests should mock socket.io and tRPC, not hit real services
- Scripts/tests (Phase 1.2) are lower priority than client types (Phase 1.1)
