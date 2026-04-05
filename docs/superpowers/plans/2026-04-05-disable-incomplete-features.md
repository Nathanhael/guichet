# Disable Incomplete Features — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide Canned Responses, Knowledge Base, and Webhooks from the UI and block all their tRPC procedures at the API level, keeping the code intact for future enablement.

**Architecture:** A `DISABLED_FEATURES` constant in `server/constants.ts` drives a `featureGate()` tRPC middleware that rejects all calls to disabled routers with `FORBIDDEN`. Client-side, the three admin tabs and the `CannedResponsePicker` in `ChatWindow` are removed. All disabled UI code is commented with `// DISABLED_FEATURE:` for easy grep-and-restore.

**Tech Stack:** tRPC middleware, TypeScript, React

**Spec:** `docs/superpowers/specs/2026-04-05-disable-incomplete-features-design.md`

---

## File Map

| # | File | Action | Responsibility |
|---|------|--------|----------------|
| 1 | `server/constants.ts` | Modify | Add `DISABLED_FEATURES` array |
| 2 | `server/trpc/trpc.ts` | Modify | Add `featureGate()` middleware factory |
| 3 | `server/trpc/routers/cannedResponse.ts` | Modify | Gate all procedures with `featureGate('cannedResponse')` |
| 4 | `server/trpc/routers/kb.ts` | Modify | Gate all procedures with `featureGate('knowledgeBase')` |
| 5 | `server/trpc/routers/webhook.ts` | Modify | Gate all procedures with `featureGate('webhooks')` |
| 6 | `client/src/views/AdminView.tsx` | Modify | Remove imports, nav buttons, tab renders for 3 features |
| 7 | `client/src/components/ChatWindow.tsx` | Modify | Remove `CannedResponsePicker` and all related state/logic |

---

### Task 1: Add `DISABLED_FEATURES` constant

**Files:**
- Modify: `server/constants.ts:25` (append after last constant)

- [ ] **Step 1: Add the constant**

At the end of `server/constants.ts`, after line 25, add:

```ts
/**
 * Features that are built but not yet enabled for production use.
 * Remove a feature name from this array to enable it.
 * Used by featureGate() middleware in trpc.ts to block all procedures.
 */
export const DISABLED_FEATURES: readonly string[] = [
  'cannedResponse',
  'knowledgeBase',
  'webhooks',
] as const;
```

- [ ] **Step 2: Verify no TypeScript errors**

Run: `docker compose exec server npx tsc --noEmit`
Expected: No errors (this is a standalone constant with no imports).

- [ ] **Step 3: Commit**

```bash
git add server/constants.ts
git commit -m "feat: add DISABLED_FEATURES constant for feature gating"
```

---

### Task 2: Add `featureGate()` middleware to tRPC

**Files:**
- Modify: `server/trpc/trpc.ts:1` (add import), `server/trpc/trpc.ts:104` (append middleware)

- [ ] **Step 1: Add import for DISABLED_FEATURES**

At the top of `server/trpc/trpc.ts`, after line 4:

```ts
import { DISABLED_FEATURES } from '../constants.js';
```

- [ ] **Step 2: Add the featureGate middleware factory**

At the end of `server/trpc/trpc.ts`, after line 104, add:

```ts

/**
 * Middleware that blocks all procedures for a disabled feature.
 * Usage: `partnerScopedProcedure.use(featureGate('featureName'))`
 *
 * Returns FORBIDDEN with a clear message when the feature is in DISABLED_FEATURES.
 * To re-enable, remove the feature name from DISABLED_FEATURES in constants.ts.
 */
export const featureGate = (feature: string) =>
  t.middleware(({ next }) => {
    if (DISABLED_FEATURES.includes(feature)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `Feature "${feature}" is not yet available`,
      });
    }
    return next();
  });
```

- [ ] **Step 3: Verify no TypeScript errors**

Run: `docker compose exec server npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add server/trpc/trpc.ts
git commit -m "feat: add featureGate() tRPC middleware for disabling features"
```

---

### Task 3: Gate the cannedResponse router

**Files:**
- Modify: `server/trpc/routers/cannedResponse.ts:2` (update import), `server/trpc/routers/cannedResponse.ts:9` (add gated procedures)

- [ ] **Step 1: Update import to include featureGate**

Change line 2 from:

```ts
import { router, partnerScopedProcedure, partnerAdminProcedure } from '../trpc.js';
```

to:

```ts
import { router, partnerScopedProcedure, partnerAdminProcedure, featureGate } from '../trpc.js';
```

- [ ] **Step 2: Add gated procedure aliases before the router definition**

Insert before line 9 (`export const cannedResponseRouter = router({`):

```ts
// DISABLED_FEATURE: Canned Responses — gated until feature is production-ready
const gatedPartnerScoped = partnerScopedProcedure.use(featureGate('cannedResponse'));
const gatedPartnerAdmin = partnerAdminProcedure.use(featureGate('cannedResponse'));

```

- [ ] **Step 3: Replace procedure references in the router**

In the router definition, replace all occurrences of:
- `partnerScopedProcedure` → `gatedPartnerScoped`
- `partnerAdminProcedure` → `gatedPartnerAdmin`

The `list` procedure uses `partnerScopedProcedure` — change to `gatedPartnerScoped`.
The `create`, `update`, `delete` procedures use `partnerAdminProcedure` — change to `gatedPartnerAdmin`.

- [ ] **Step 4: Verify no TypeScript errors**

Run: `docker compose exec server npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add server/trpc/routers/cannedResponse.ts
git commit -m "feat: gate cannedResponse router with featureGate middleware"
```

---

### Task 4: Gate the kb router

**Files:**
- Modify: `server/trpc/routers/kb.ts:2` (update import), insert gated aliases before router

- [ ] **Step 1: Update import to include featureGate**

Change line 2 from:

```ts
import { router, partnerScopedProcedure, partnerAdminProcedure } from '../trpc.js';
```

to:

```ts
import { router, partnerScopedProcedure, partnerAdminProcedure, featureGate } from '../trpc.js';
```

- [ ] **Step 2: Add gated procedure aliases**

Insert before the router definition (after the `slugify` function and `articleListColumns` const, before `export const kbRouter = router({`):

```ts
// DISABLED_FEATURE: Knowledge Base — gated until feature is production-ready
const gatedPartnerScoped = partnerScopedProcedure.use(featureGate('knowledgeBase'));
const gatedPartnerAdmin = partnerAdminProcedure.use(featureGate('knowledgeBase'));

```

- [ ] **Step 3: Replace procedure references in the router**

In the router definition, replace all occurrences of:
- `partnerScopedProcedure` → `gatedPartnerScoped`
- `partnerAdminProcedure` → `gatedPartnerAdmin`

Procedures using `partnerScopedProcedure`: `list`, `get`, `search`, `aiSearch`
Procedures using `partnerAdminProcedure`: `create`, `update`, `delete`

- [ ] **Step 4: Verify no TypeScript errors**

Run: `docker compose exec server npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add server/trpc/routers/kb.ts
git commit -m "feat: gate kb router with featureGate middleware"
```

---

### Task 5: Gate the webhook router

**Files:**
- Modify: `server/trpc/routers/webhook.ts:3` (update import), insert gated alias before router

- [ ] **Step 1: Update import to include featureGate**

Change line 3 from:

```ts
import { router, partnerAdminProcedure } from '../trpc.js';
```

to:

```ts
import { router, partnerAdminProcedure, featureGate } from '../trpc.js';
```

- [ ] **Step 2: Add gated procedure alias**

Insert before `export const webhookRouter = router({` (after the `verifyWebhookOwnership` function):

```ts
// DISABLED_FEATURE: Webhooks — gated until feature is production-ready
const gatedPartnerAdmin = partnerAdminProcedure.use(featureGate('webhooks'));

```

- [ ] **Step 3: Replace procedure references in the router**

In the router definition, replace all occurrences of:
- `partnerAdminProcedure` → `gatedPartnerAdmin`

All procedures (`list`, `create`, `update`, `regenerateSecret`, `delete`, `test`, `logs`) use `partnerAdminProcedure`.

- [ ] **Step 4: Verify no TypeScript errors**

Run: `docker compose exec server npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add server/trpc/routers/webhook.ts
git commit -m "feat: gate webhook router with featureGate middleware"
```

---

### Task 6: Remove disabled features from AdminView

**Files:**
- Modify: `client/src/views/AdminView.tsx`

- [ ] **Step 1: Remove the three imports (lines 12-14)**

Remove these three lines:

```ts
import AdminCannedResponses from '../components/admin/AdminCannedResponses';
import AdminKnowledgeBase from '../components/admin/AdminKnowledgeBase';
import AdminWebhooks from '../components/admin/AdminWebhooks';
```

Replace with:

```ts
// DISABLED_FEATURE: Canned Responses, Knowledge Base, Webhooks — hidden until production-ready
// import AdminCannedResponses from '../components/admin/AdminCannedResponses';
// import AdminKnowledgeBase from '../components/admin/AdminKnowledgeBase';
// import AdminWebhooks from '../components/admin/AdminWebhooks';
```

- [ ] **Step 2: Remove from AdminTab type (line 30)**

Change:

```ts
type AdminTab = 'dashboard' | 'satisfaction' | 'alerts' | 'team' | 'business_hours' | 'departments' | 'tickets' | 'archive' | 'feedback' | 'labels' | 'canned_responses' | 'knowledge_base' | 'webhooks';
```

to:

```ts
type AdminTab = 'dashboard' | 'satisfaction' | 'alerts' | 'team' | 'business_hours' | 'departments' | 'tickets' | 'archive' | 'feedback' | 'labels'; // DISABLED_FEATURE: removed 'canned_responses' | 'knowledge_base' | 'webhooks'
```

- [ ] **Step 3: Remove the three NavButtons (lines 124-126)**

Remove these three lines:

```tsx
          <NavButton id="canned_responses" label={t('canned_responses')} icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>} />
          <NavButton id="knowledge_base" label={t('knowledge_base')} icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>} />
          <NavButton id="webhooks" label={t('webhooks')} icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>} />
```

Replace with:

```tsx
          {/* DISABLED_FEATURE: Canned Responses, Knowledge Base, Webhooks — NavButtons hidden until production-ready */}
```

- [ ] **Step 4: Remove the three tab renders (lines 143-145)**

Remove these three lines:

```tsx
          {view === 'canned_responses' && <AdminCannedResponses />}
          {view === 'knowledge_base' && <AdminKnowledgeBase />}
          {view === 'webhooks' && <AdminWebhooks />}
```

Replace with:

```tsx
          {/* DISABLED_FEATURE: Canned Responses, Knowledge Base, Webhooks — tab panels hidden until production-ready */}
```

- [ ] **Step 5: Verify no TypeScript errors**

Run: `docker compose exec client npx tsc --noEmit`
Expected: No errors. The removed type members are no longer referenced.

- [ ] **Step 6: Commit**

```bash
git add client/src/views/AdminView.tsx
git commit -m "feat: hide canned responses, knowledge base, webhooks tabs from AdminView"
```

---

### Task 7: Remove CannedResponsePicker from ChatWindow

**Files:**
- Modify: `client/src/components/ChatWindow.tsx`

- [ ] **Step 1: Comment out the import (line 5)**

Change:

```ts
import CannedResponsePicker from './CannedResponsePicker';
```

to:

```ts
// DISABLED_FEATURE: import CannedResponsePicker from './CannedResponsePicker';
```

- [ ] **Step 2: Comment out the state declaration (line 54)**

Change:

```ts
  const [showCannedPicker, setShowCannedPicker] = useState(false);
```

to:

```ts
  // DISABLED_FEATURE: const [showCannedPicker, setShowCannedPicker] = useState(false);
```

- [ ] **Step 3: Remove the CannedResponsePicker render block (lines 895-903)**

Change:

```tsx
              {/* Canned response picker */}
              {showCannedPicker && isSupport && (
                <CannedResponsePicker
                  inputText={text}
                  dept={ticket.dept}
                  onSelect={(body) => { setText(body); setShowCannedPicker(false); }}
                  onClose={() => setShowCannedPicker(false)}
                />
              )}
```

to:

```tsx
              {/* DISABLED_FEATURE: CannedResponsePicker removed until production-ready */}
```

- [ ] **Step 4: Remove the canned picker trigger logic in onChange (lines 911-916)**

In the textarea's `onChange` handler, change:

```ts
                  // Show canned picker when typing "/" at start
                  if (isSupport && val.startsWith('/')) {
                    setShowCannedPicker(true);
                  } else {
                    setShowCannedPicker(false);
                  }
```

to:

```ts
                  // DISABLED_FEATURE: canned picker "/" trigger removed until production-ready
```

- [ ] **Step 5: Remove the canned picker key guard in onKeyDown (line 920)**

Change:

```ts
                  if (showCannedPicker) return; // Let picker handle keys
```

to:

```ts
                  // DISABLED_FEATURE: canned picker key guard removed until production-ready
```

- [ ] **Step 6: Update the placeholder text (line 924)**

Change:

```ts
                placeholder={isSupport ? (t('type_message_slash') || 'Type a message or / for quick replies') : t('type_message')}
```

to:

```ts
                placeholder={t('type_message')}
```

The slash-command hint is misleading when canned responses are disabled.

- [ ] **Step 7: Verify no TypeScript errors**

Run: `docker compose exec client npx tsc --noEmit`
Expected: No errors. All references to `showCannedPicker` and `CannedResponsePicker` are commented out.

- [ ] **Step 8: Commit**

```bash
git add client/src/components/ChatWindow.tsx
git commit -m "feat: remove CannedResponsePicker from ChatWindow until feature is enabled"
```

---

### Task 8: Verify full build

- [ ] **Step 1: Run server typecheck**

Run: `docker compose exec server npx tsc --noEmit`
Expected: Clean pass, no errors.

- [ ] **Step 2: Run client typecheck**

Run: `docker compose exec client npx tsc --noEmit`
Expected: Clean pass, no errors.

- [ ] **Step 3: Run server tests**

Run: `docker compose exec server npm test`
Expected: All existing tests pass. The `webhookDispatch.test.ts` tests should still pass — they test the dispatch service directly, not through the tRPC router.

- [ ] **Step 4: Run client tests**

Run: `docker compose exec client npm test`
Expected: All existing tests pass.

- [ ] **Step 5: Final commit (if any test fixes needed)**

If tests required adjustments, commit those fixes:

```bash
git add -A
git commit -m "fix: adjust tests for disabled features"
```
