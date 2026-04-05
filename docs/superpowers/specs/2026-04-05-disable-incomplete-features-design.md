# Disable Incomplete Features — Design Spec

**Date**: 2026-04-05
**Status**: Approved
**Approach**: Option B — Hide UI + Block at API level

## Problem

Three features (Canned Responses, Knowledge Base, Webhooks) are built but not ready for production use. They should be hidden from users and blocked at the API level until future development is complete.

## Decision

Keep all code, DB tables, and services intact. Disable at two layers:

1. **Server**: A `DISABLED_FEATURES` constant + tRPC middleware gate rejects all calls to disabled routers.
2. **Client**: Remove navigation entries, tab content, and the `CannedResponsePicker` from `ChatWindow`.

Re-enabling is a single constant change + uncommenting UI lines.

## Detailed Changes

### 1. Server — `DISABLED_FEATURES` constant

**File**: `server/constants.ts`

Add:

```ts
/**
 * Features that are built but not yet enabled for production use.
 * Remove a feature name from this array to enable it.
 */
export const DISABLED_FEATURES: readonly string[] = [
  'cannedResponse',
  'knowledgeBase',
  'webhooks',
] as const;
```

Single source of truth. One array edit to re-enable any feature.

### 2. Server — tRPC feature gate middleware

**File**: `server/trpc/trpc.ts`

Add a `featureGate` middleware factory:

```ts
import { DISABLED_FEATURES } from '../constants.js';

export function featureGate(feature: string) {
  return t.middleware(({ next }) => {
    if ((DISABLED_FEATURES as readonly string[]).includes(feature)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `Feature "${feature}" is not yet available`,
      });
    }
    return next();
  });
}
```

### 3. Server — Apply gate to three routers

**File**: `server/trpc/routers/cannedResponse.ts`
- Import `featureGate` from `../trpc.js`
- Wrap the router: apply `featureGate('cannedResponse')` as base middleware on all procedures

**File**: `server/trpc/routers/kb.ts`
- Import `featureGate` from `../trpc.js`
- Wrap the router: apply `featureGate('knowledgeBase')` as base middleware on all procedures

**File**: `server/trpc/routers/webhook.ts`
- Import `featureGate` from `../trpc.js`
- Wrap the router: apply `featureGate('webhooks')` as base middleware on all procedures

Implementation approach: Each router's procedures already use `partnerScopedProcedure` or `partnerAdminProcedure`. The simplest approach is to add a feature-gated variant of each base procedure, or add an early guard at the top of each procedure. The recommended pattern is to create gated procedure builders:

```ts
// In cannedResponse.ts
const gatedPartnerScoped = partnerScopedProcedure.use(featureGate('cannedResponse'));
const gatedPartnerAdmin = partnerAdminProcedure.use(featureGate('cannedResponse'));
```

Then replace `partnerScopedProcedure` / `partnerAdminProcedure` usage in that router with the gated variants.

### 4. Client — AdminView

**File**: `client/src/views/AdminView.tsx`

Remove (comment out with `// DISABLED_FEATURE:` prefix):

- **Imports** (lines 12-14): `AdminCannedResponses`, `AdminKnowledgeBase`, `AdminWebhooks`
- **Type union** (line 30): Remove `'canned_responses' | 'knowledge_base' | 'webhooks'` from `AdminTab`
- **NavButtons** (lines 124-126): The three sidebar nav buttons
- **Tab renders** (lines 143-145): The three `{view === '...' && <Component />}` lines

### 5. Client — ChatWindow

**File**: `client/src/components/ChatWindow.tsx`

Remove (comment out with `// DISABLED_FEATURE:` prefix):

- **Import** (line 6): `import CannedResponsePicker from './CannedResponsePicker';`
- **State** (line 55): `const [showCannedPicker, setShowCannedPicker] = useState(false);`
- **Render block** (~lines 895-903): The `{showCannedPicker && isSupport && ( <CannedResponsePicker ... /> )}` JSX block
- **Trigger logic** (~lines 913, 915): `setShowCannedPicker(true)` / `setShowCannedPicker(false)` calls in textarea onChange
- **Key guard** (~line 920): `if (showCannedPicker) return;` in keydown handler

### 6. No Database Changes

Tables `canned_responses`, `kb_articles`, `webhooks`, `webhook_logs` remain in schema. Empty tables have zero runtime cost. No migration required.

## Files Modified

| # | File | Change |
|---|------|--------|
| 1 | `server/constants.ts` | Add `DISABLED_FEATURES` array |
| 2 | `server/trpc/trpc.ts` | Add `featureGate()` middleware factory |
| 3 | `server/trpc/routers/cannedResponse.ts` | Apply `featureGate('cannedResponse')` to all procedures |
| 4 | `server/trpc/routers/kb.ts` | Apply `featureGate('knowledgeBase')` to all procedures |
| 5 | `server/trpc/routers/webhook.ts` | Apply `featureGate('webhooks')` to all procedures |
| 6 | `client/src/views/AdminView.tsx` | Remove nav buttons, tab renders, imports for 3 features |
| 7 | `client/src/components/ChatWindow.tsx` | Remove `CannedResponsePicker` import and render |

## Re-enabling a Feature

1. Remove the feature name from `DISABLED_FEATURES` in `server/constants.ts`
2. Uncomment the corresponding UI lines (search for `DISABLED_FEATURE:` comments)
3. Done — no migration, no build changes

## Out of Scope

- No per-partner feature flags (future enhancement)
- No env var control (constant is sufficient for now)
- No DB table removal or migration
- No changes to `webhookDispatch.ts` service (already not called from anywhere)
