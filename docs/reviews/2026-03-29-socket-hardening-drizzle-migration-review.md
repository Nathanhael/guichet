# Code Review: Socket Hardening + Drizzle ORM Migration

**Reviewer**: Claude Opus 4.6 (Senior Code Reviewer)
**Date**: 2026-03-29
**Scope**: Socket hardening (CR-01/CR-02), centralized room management, DRY system messages, Drizzle ORM migration (4 query modules + tests)

---

## Summary

This is a well-executed refactoring that achieves its goals: zero raw SQL in handlers.ts, centralized room management, staff-only broadcast isolation, and LIKE injection prevention. The code is clean, consistent, and maintains all tenant isolation checks. I found one Important issue in the test suite and several Minor observations.

---

## Critical Issues

None.

---

## Important Issues

### I-1: Type mismatch in `ticketQueries.test.ts` -- `participants` as string

In `ticketQueries.test.ts` line 137, `createTicket` is called with `participants: '[]'` (a string), but the `CreateTicketData` interface in `ticketQueries.ts` (line 171) defines `participants` as `Array<{ id: string; name: string }>`.

The test passes because the mock doesn't validate input types, but this masks a real type mismatch. If TypeScript strict checks are enabled on tests, this should fail. Fix: change line 137 to `participants: []`.

**File**: `server/services/ticketQueries.test.ts:137`

### I-2: Redundancy between `systemMessage.ts` and `messageQueries.ts:insertMessage`

`insertSystemMessage()` in `systemMessage.ts` duplicates the insert-and-return pattern from `insertMessage()` in `messageQueries.ts`. The system message function could call `insertMessage({ ..., system: true, senderId: '__system__', senderName: 'System', ... })` instead of reimplementing the insert. This creates a maintenance risk where one path could diverge from the other (e.g., if a new column is added to messages).

**Files**: `server/services/systemMessage.ts`, `server/services/messageQueries.ts`

---

## Minor Issues

### M-1: `insertMessage` return type includes `originalText` but schema has no such column

`messageQueries.ts` line 50 returns `originalText: data.text` in the socket-ready object. This is a computed field for the client, not stored in DB -- which is fine for socket emission. But it's not documented and could confuse future developers. A brief comment would help.

### M-2: `as unknown as Message` cast in handlers.ts line 473

`message = msg as unknown as Message` is a double-cast smell. The `insertMessage` return type is well-defined, so ideally the `Message` type and the return type should be aligned or a mapper should bridge them.

**File**: `server/socket/handlers.ts:473`

### M-3: `findTargetSupport` does not verify the target's role

`userQueries.ts:findTargetSupport` joins users+memberships but doesn't filter by `role IN ('support', 'admin')`. A non-support user with a membership could be a valid transfer target. This may be intentional (admin transfers exist), but the JSDoc says "support user" which is misleading.

### M-4: No test for `insertSystemMessage`

`systemMessage.ts` has no dedicated test file. Its behavior is implicitly tested via handlers tests, but a unit test would improve coverage.

### M-5: `assignSupport` stores `participants` as `::text` after JSONB manipulation

In `ticketQueries.ts` line 216, the JSONB concat result is cast `::text` for storage. This works because the `participants` column is text/JSONB, but it relies on PostgreSQL's implicit text representation of JSONB. If the column type changes, this could break silently.

---

## Observations (Not Issues)

### O-1: Clean separation of concerns
The 4 query modules (`partnerQueries`, `userQueries`, `messageQueries`, `ticketQueries`) are well-organized by domain with clear JSDoc indicating which socket event uses each function.

### O-2: Rooms helper is minimal and effective
The `Rooms` object with `as const` return types enables compile-time verification of room name patterns. Good use of TypeScript template literal types.

### O-3: Constants extraction is well-scoped
All 7 magic numbers are properly named and documented. The file is focused and doesn't try to be a catch-all config.

### O-4: Staff-only room isolation (CR-01) is correctly implemented
- `ticket:created` broadcasts to `Rooms.staff(partnerId)` (line 491)
- `ticket:assigned` broadcasts to `Rooms.staff(partnerId)` (line 901)
- Agents get `ticket:created:self` only (line 489)
- Staff room join is gated on `socket.data.isSupport` (line 377)

### O-5: LIKE injection prevention is comprehensive
`escapeLikePattern` is used in all 4 LIKE-using files: `tickets.ts`, `kb.ts`, `message.ts`, `ticket.ts` (tRPC routers).

### O-6: Tenant isolation preserved throughout
Every handler that touches ticket data verifies `ticket.partnerId === socket.data.partnerId` before proceeding. The Drizzle migration did not weaken any of these checks.

### O-7: JSONB participants handling is defensive
Line 447 in handlers.ts: `typeof t.references === 'string' ? JSON.parse(t.references) : t.references` -- correctly handles both raw JSONB (Drizzle auto-parses) and string fallback.

### O-8: Zero `any` types in all new files
All query modules, constants, rooms, and systemMessage files are free of `any`.

### O-9: Test coverage pattern is consistent
All 4 query module test files follow the same mock pattern (chainable Drizzle mocks with `as never` casts). Tests verify both found and not-found paths for key queries.

---

## Verdict

**Ship it** after fixing I-1 (test type mismatch). I-2 (systemMessage duplication) is a design debt item that can be addressed in a follow-up.

The refactoring successfully eliminates all raw SQL from handlers.ts while preserving security invariants (tenant isolation, role checks, identity enforcement). The staff-only room pattern correctly prevents agent data leakage. Code quality is high throughout.
