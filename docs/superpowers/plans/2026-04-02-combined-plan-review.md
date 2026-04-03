# Code Review: Combined Transfer + Status Plan vs. Specs and Codebase

**Reviewer:** Senior Code Reviewer (Claude Opus 4.6)
**Date:** 2026-04-02

---

## 1. Spec Coverage

Both specs are fully covered by the plan. Every requirement maps to at least one task:

| Spec Requirement | Plan Task(s) |
|---|---|
| Transfer menu shows departments | Task 3 |
| Server dept-based transfer | Task 2 |
| Optional whisper note | Tasks 2, 3 |
| Return to queue unchanged | Tasks 2, 3 |
| Remove `no_other_support_online` | Task 1 |
| Translation keys (transfer) | Task 1 |
| Translation keys (status) | Task 1 |
| Redis `statusChangedAt` field | Tasks 5, 6 |
| `agent_status_log` table | Task 7 |
| `daily_agent_status` table | Task 7 |
| `support:status` socket handler | Task 5 |
| Status restore on reconnect | Task 6 |
| Daily rollup | Tasks 8, 16 |
| tRPC status router | Task 10 |
| QueueSidebar team panel | Task 12 |
| AdminTeam status column | Task 13 |
| AdminStats time-in-status | Task 14 |
| Capacity badge in SupportNav | Task 15 |
| GDPR purge for status log | Task 17 |
| `OnlineSupport` type update | Task 11 |
| `StatusPicker` event alignment | Task 5 |

**No gaps found.**

---

## 2. Critical Issues (Must Fix)

### C1. Task 2 uses Drizzle ORM but handlers.ts does not import it

**Location:** Task 2, Step 1 (line 162 of plan)

The rewritten `ticket:transfer` handler uses `db.query.partners.findFirst(...)` and `db.update(tickets).set(...)` with `eq()` from Drizzle ORM. However, `handlers.ts` does **not** import `db` or Drizzle schema tables. The file uses service functions (`ticketQueries.ts`, `userQueries.ts`, etc.) as an abstraction layer -- it never calls `db` directly.

- `handlers.ts` has zero `import { db }` lines (confirmed by grep).
- `partners` is not imported from schema.
- `eq` is not imported from `drizzle-orm`.

**Impact:** Build failure. The entire Task 2 handler code will produce import errors.

**Fix:** Either (a) add the direct DB imports (`db`, `tickets`, `partners`, `eq` from drizzle-orm) to handlers.ts, or (b) refactor the handler code to call service-layer functions (preferred, matches existing patterns). Task 2 Step 4 acknowledges the `partners` import gap but the `db`, `tickets`, and `eq` imports are not mentioned at all.

### C2. Task 6 Step 1 -- Lua script ARGV numbering is wrong

**Location:** Task 6, Step 1 (line 588 of plan)

The plan says to add `statusChangedAt` as `ARGV[7]`. But the actual Lua script uses only 6 ARGV values (userId, name, role, partnerId, isPlatformOp, ttl). There is no ARGV[7] slot. Additionally, the Lua script unconditionally resets `status` to `'available'` on every identify call (both new and reconnecting users), which directly contradicts the spec's "persist status across reconnects" requirement.

**Impact:** (a) ARGV[7] would require adding the argument to the `pubClient.eval()` call's `arguments` array, which the plan does not show. (b) More critically, the Lua script always sets `status = 'available'`, so even if `statusChangedAt` is stored, the persisted status is immediately overwritten on reconnect, making Task 6 Step 3 (restore persisted status) ineffective.

**Fix:** The Lua script needs modification to preserve the existing status on reconnect (when `exists == 1`). The `else` branch should NOT set `'status', 'available'`. It should only set status to `'available'` in the `exists == 0` branch (first connection).

### C3. `insertWhisperMessage` does not exist anywhere in the codebase

**Location:** Task 2, Steps 1 and 2 (lines 173, 230 of plan)

The handler calls `insertWhisperMessage()` but this function does not exist anywhere in the server codebase (confirmed by recursive grep). Task 2 Step 2 says "add if not already present," which is good -- but the implementation shown returns a `text` field while the `messages` table uses `body`. The returned shape (`{ text, whisper, system, timestamp }`) does not match the existing `mapMessageRow` / socket message format used elsewhere (which uses `body` and `createdAt`).

**Impact:** Runtime crash unless the helper is added, and potential client-side rendering bugs if the returned message shape does not match the client's `Message` type.

**Fix:** The plan acknowledges this ("adapt field names to match existing pattern") but the provided code contradicts that guidance. The implementation should follow `insertSystemMessage`'s pattern exactly.

### C4. Task 2 uses `db.query.partners` without Drizzle `relations` setup

**Location:** Task 2, Step 1 (line 162)

The plan uses `db.query.partners.findFirst({ where: eq(...), columns: {...} })`. This requires Drizzle's `relations` API to be configured for the `partners` table. Even if we add the import, `db.query` requires the relational query API which may not be set up for the `partners` table.

**Impact:** Potential runtime error. Should use `db.select().from(partners).where(...)` instead, which is the pattern used elsewhere in the codebase services.

---

## 3. Important Issues (Should Fix)

### I1. Task 5 -- presence router has `'offline'` in its enum; plan removes it

**Location:** Task 5, Step 3 (line 528)

The presence router's `z.enum` currently includes `['available', 'busy', 'away', 'offline']`. The plan replaces it with `['available', 'break', 'lunch', 'meeting', 'training']`. This removes `'offline'` -- but `'offline'` may be used by the existing `setStatus` mutation callers. The plan does not audit callers of the tRPC `presence.setStatus` mutation.

**Fix:** Check all callers of `trpc.presence.setStatus` for `'offline'` usage before removing it.

### I2. Task 2 -- `transferTicket` and `findTargetSupport` imports not removed

**Location:** Task 2, Step 3 (line 262)

The plan says to remove the `transferTicket` function but it is imported from `ticketQueries.ts` at the top of `handlers.ts` (line 22). The plan does not mention removing the import statement. Similarly, `findTargetSupport` from `userQueries.ts` (line 37) is no longer used but the import removal is not mentioned.

**Impact:** Unused import warnings or lint errors, but not a build failure (TypeScript allows unused imports by default unless `noUnusedLocals` is set).

**Fix:** Add explicit steps to remove `transferTicket` and `findTargetSupport` from the import blocks.

### I3. Task 14 -- `AgentStatusStats` uses untyped `Record<string, unknown>` casts

**Location:** Task 14, Step 1 (line 1389)

The `chartData` mapping uses `(row as { userId?: string })` and other type casts from `Record<string, unknown>`. This violates the project's "No `any` types" mandate and is fragile.

**Fix:** Define a proper interface for the tRPC response type and use it directly. The `getTeamStats` / `getAgentStats` return types from Drizzle are already typed -- leverage them.

### I4. Task 14 -- AdminStats `activePartnerId` access pattern unclear

**Location:** Task 14, Step 2 (line 1489)

The plan says to pass `activePartnerId` but does not show how to access it. AdminStats uses `useStoreShallow` but the grep does not show `activePartnerId` being destructured in the component. The plan says "follow the existing pattern" without specifying it.

**Fix:** The plan should explicitly show the store selector addition: `const { activePartnerId } = useStoreShallow(s => ({ activePartnerId: s.activePartnerId }))`.

### I5. Task 9 Step 4 -- disconnect handler `result.role` check is wrong

**Location:** Task 9, Step 4 (line 1006)

The plan shows `if (result.role === 'agent')` to decide whether to close the status row. But status tracking applies to ALL support-role users, not just agents with role `'agent'`. The `closeOpenRow` call should happen for any user who was tracked (support, admin, agent).

**Fix:** Move `statusTracking.closeOpenRow()` outside the `result.role === 'agent'` block. It should fire whenever `result.removed` is true, regardless of role.

### I6. Task 16 -- `app.ts` imports `db` from `'./db.js'` but plan imports `partners` from `'./db/schema.js'`

**Location:** Task 16, Step 2 (line 1571)

The plan shows `import { partners } from './db/schema.js'` and uses `db.select({ id: partners.id }).from(partners)`. The existing `app.ts` imports `db` from `./db.js`. Need to verify `db` is the Drizzle instance (not the raw pg pool).

**Fix:** Verify `./db.js` exports the Drizzle `db` instance. If it exports a raw query helper instead, use the correct import path.

---

## 4. Suggestions (Nice to Have)

### S1. Task 1 -- `transfer_to_department` key already exists as `transfer_to`

The plan adds `transfer_to_department` while removing `transfer_to` (line 45 of en.ts). This is correct, but the "remove" instruction should specify exact line numbers since `transfer` (line 44) must be kept while `transfer_to` (line 45) is removed. A careless find-and-delete could remove the wrong key.

### S2. Rollup scheduling (Task 16) only rolls up yesterday

The hourly interval only rolls up yesterday's data. For the current day, the stacked bar chart in AgentStatusStats will show no data until after midnight. Consider also rolling up today's partial data, or note this limitation in the plan.

### S3. `support:status` vs `status:set` event naming

The spec says "New listener: `support:status`" but the plan correctly changes everything to `status:set` (matching the existing server handler name). This is the right call. Just noting the spec deviation is intentional and beneficial.

---

## 5. File Conflict Analysis

No destructive conflicts found. The key shared file `server/socket/handlers.ts` is modified in Tasks 2, 5, 6, and 9 -- all touching different sections of the file:

| Task | Section Modified |
|---|---|
| Task 2 | `ticket:transfer` handler (line 922) |
| Task 5 | `status:set` handler (line 596) |
| Task 6 | `socket:identify` handler (line 354) |
| Task 9 | `status:set` (again), `socket:identify` (again), `disconnect` (line 1035) |

Tasks 5 and 9 both modify the `status:set` handler -- Task 5 updates the valid statuses, Task 9 adds the `statusTracking.logTransition` call. This is fine because Task 9 replaces the entire handler block that Task 5 wrote. The plan correctly sequences these (5 before 9).

---

## 6. Task Ordering Assessment

The ordering is correct. Dependencies flow properly:

- Task 1 (i18n) has no dependencies, good first task
- Task 2 (server handler) depends on nothing new
- Task 3 (client menu) depends on Task 1 (translation keys)
- Task 5 (status values) depends on nothing new
- Task 6 (reconnect) depends on Task 5 (presence changes)
- Task 7 (DB tables) depends on nothing
- Task 8 (service) depends on Task 7 (tables)
- Task 9 (wire service) depends on Tasks 5, 8
- Task 10 (tRPC router) depends on Tasks 8, 7
- Task 11 (types) depends on nothing
- Tasks 12-15 (UI) depend on Task 11 (types + color utility)
- Task 16 (rollup scheduling) depends on Task 8
- Task 17 (GDPR) depends on Task 7

No circular or missing dependencies.

---

## 7. Codebase Alignment -- Line Number Accuracy

| Plan Reference | Actual | Status |
|---|---|---|
| `ticket:transfer` at line 922 | Line 922 | Correct |
| `status:set` at line 605 | Line 596 | Wrong (off by 9 lines) |
| `showTransferMenu` at line 57 | Line 57 | Correct |
| `transferTicket` function at lines 479-483 | Lines 479-483 | Correct |
| `transferTargets` at line 486 | Line 486 | Correct |
| Transfer menu JSX at lines 598-635 | Lines 598-635 | Correct |
| `setUserStatus` at line 141 | Line 141 | Correct |
| `savedViews` table at line 443 | Line 445 | Off by 2 lines |
| File length 1081 lines | 1081-1090 | Close (minor drift) |
| `disconnect` handler at line 1035 | Line 1035 | Correct |
| `transferTicket` in ticketQueries at line 277 | Line 277 | Correct |
| `returnTicketToQueue` in ticketQueries at line 293 | Line 299 | Off by 6 lines |
| Presence router `z.enum` at line 26 | Line 26 | Correct |

The `status:set` handler line reference (605 vs actual 596) is the most significant deviation -- an implementer following the plan literally might look at the wrong section.

---

## Summary

**Overall assessment:** The plan is well-structured with correct task ordering and complete spec coverage. However, there are 4 critical issues that would cause build or runtime failures if not addressed:

1. **C1** -- handlers.ts has no `db`/Drizzle imports; plan injects raw DB queries into a file that exclusively uses service abstractions
2. **C2** -- Lua script always resets status to `'available'` on reconnect, defeating the entire "persist status" feature
3. **C3** -- `insertWhisperMessage` does not exist and the provided implementation has wrong field names
4. **C4** -- Uses `db.query.partners` relational API which may not be configured

These must be resolved before implementation begins.
