# Plan: Configurable Business Hours per Partner

## Goal
Allow **admin** and **platform_operator** roles to configure business hours per partner via the UI, replacing the current global environment-variable approach. Each partner gets its own opening hours and timezone.

## Current State
- `isWithinBusinessHours()` reads global env vars `BUSINESS_HOURS_START` / `BUSINESS_HOURS_END` (default 07:30–22:30)
- Timezone hardcoded to `Europe/Brussels`
- Enforced only in `socket/handlers.ts` line 145 (`ticket:new`)
- `/api/config` returns global hours; client stores in Zustand
- No database columns, no admin UI, no per-partner support

## Architecture Decisions
- **Env vars become the fallback default** — if a partner has no custom hours, use env vars
- **Timezone per partner** — stored as IANA string (e.g. `Europe/Brussels`)
- **Admin and platform_operator** can edit; manager/support/agent cannot
- **Reuse existing patterns**: partner tRPC router, AdminAISettings layout style

---

## Tasks

### Task 1: Database Schema — Add columns to `partners` table

**File**: `server/db/schema.ts`

Add three columns to the `partners` table:
```ts
businessHoursStart: text('business_hours_start'),  // HH:MM format, nullable (null = use env default)
businessHoursEnd: text('business_hours_end'),      // HH:MM format, nullable
businessHoursTimezone: text('business_hours_timezone').default('Europe/Brussels'),
```

**Verification**: `npm test` passes (no runtime impact — nullable columns)

### Task 2: Drizzle Migration

Generate and apply migration:
```bash
cd server && npx drizzle-kit generate
```

Review the generated SQL, ensure it's an `ALTER TABLE partners ADD COLUMN` with no `NOT NULL` constraint (existing rows get null).

**Verification**: Migration applies cleanly; existing partner rows unaffected

### Task 3: Update `isWithinBusinessHours()` to accept partner config

**File**: `server/services/businessHours.ts`

Change signature:
```ts
export function isWithinBusinessHours(partner?: {
  businessHoursStart?: string | null;
  businessHoursEnd?: string | null;
  businessHoursTimezone?: string | null;
}): boolean
```

Logic:
1. Use `partner.businessHoursStart ?? config.BUSINESS_HOURS_START`
2. Use `partner.businessHoursEnd ?? config.BUSINESS_HOURS_END`
3. Use `partner.businessHoursTimezone ?? 'Europe/Brussels'`
4. Rest of logic stays the same

**Verification**: Existing unit tests pass (called without args = uses defaults). Add 2 new tests for partner-specific hours.

### Task 4: Update Socket Handler to pass partner config

**File**: `server/socket/handlers.ts` (~line 145)

In `ticket:new` handler:
1. The handler already has access to `partnerId` from the socket's auth context
2. Query partner record: `const partner = await db.select().from(partners).where(eq(partners.id, partnerId)).then(r => r[0])`
3. Pass to check: `if (!isWithinBusinessHours(partner))`

**Verification**: Manual test — create ticket outside hours with partner-specific config

### Task 5: Update `/api/config` endpoint to be partner-aware

**File**: `server/app.ts` (~line 97)

The `/api/config` endpoint needs the partner context. Two options:
- **Option A**: Accept `?partnerId=xxx` query param (no auth needed, config is non-sensitive)
- **Option B**: Read partner from JWT if present, fallback to global

Recommend **Option A** for simplicity. The client already knows `activePartnerId`.

Return:
```json
{
  "businessHoursStart": "<partner or global>",
  "businessHoursEnd": "<partner or global>",
  "businessHoursTimezone": "<partner or global>",
  ...
}
```

**Verification**: `curl localhost:3001/api/config?partnerId=xxx` returns partner-specific hours

### Task 6: tRPC mutation for updating business hours

**File**: `server/trpc/routers/partner.ts`

Add `updateBusinessHours` mutation (adminProcedure):
```ts
input: z.object({
  businessHoursStart: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  businessHoursEnd: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  businessHoursTimezone: z.string().min(1).nullable(),
})
```

Follow exact pattern of existing `updateAIRules` mutation.

**Verification**: Unit test calling mutation, then querying DB to confirm columns updated

### Task 7: Admin UI — Business Hours Settings panel

**File**: New component `client/src/components/admin/AdminBusinessHours.tsx`

UI elements:
- Two time inputs (start/end) — HTML `<input type="time">` styled with Solaris classes
- Timezone dropdown (common IANA zones: Europe/Brussels, Europe/London, Europe/Paris, America/New_York, etc.)
- "Reset to default" button (sets all to null → server falls back to env vars)
- Save button triggering `partner.updateBusinessHours` tRPC mutation

Mount in AdminView alongside existing settings panels.

**Verification**: Visual check — form renders, saves, and reloads persisted values

### Task 8: Client-side — Fetch partner-aware config

**File**: `client/src/App.tsx` (~line 85)

Update the config fetch to include `partnerId`:
```ts
fetch(`/api/config?partnerId=${activePartnerId}`)
```

Also add `businessHoursTimezone` to the `AppConfig` type in `client/src/types/index.ts`.

**Verification**: Switching partners in the UI reloads business hours from the correct partner config

---

## Out of Scope
- Per-day schedules (Mon–Fri vs weekends) — future enhancement
- Holiday calendars
- Multiple time windows per day
- Enforcement beyond `ticket:new` (message sending, etc.)

## Rollback
All changes are additive (nullable columns, optional function params). Removing the feature = revert code; columns can stay harmless.
