# Zustand Slice Composition / Family Pattern

**Version**: 1.0  
**Status**: Design Brief  
**Date**: 2026-04-25  
**Author**: Claude Code

---

## Executive Summary

This brief proposes a **slice composition pattern** that organizes Zustand slices into logical **families** with a built-in `reset()` method. The goal is to make logout and partner-switch logic declarative and testable without tight coupling between slices.

**Current Problem**:
- `authSlice.logout()` calls `clearAuthState(set)`, which directly mutates all 5 other slices by name.
- New slices require manual edits to `clearAuthState()`.
- Dependencies are implicit (developers must read the code to understand what resets).
- Testing partner-scoped data reset requires mocking multiple slices.

**Proposed Solution**:
- Define **3 families**: `AuthFamily`, `PartnerDataFamily`, `UIFamily`
- Each family declares which slices it owns and has a `reset()` method.
- `authSlice.logout()` calls `partnerDataFamily.reset()` + `uiFamily.reset()`.
- New partner-scoped slices auto-join the family by declaring membership.

**Benefit**: Developers see "partner data" and immediately know what resets together on logout/switch.

---

## Current State: Implicit Dependencies

### authSlice.logout() → clearAuthState()

```typescript
// client/src/store/slices/authSlice.ts, line 238–259

logout: async () => {
  try {
    await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include' });
  } catch {
    // Local logout should still succeed even if the network call fails.
  }

  if ('caches' in window) {
    caches.keys().then((keys) => keys.forEach((key) => caches.delete(key))).catch(() => {});
  }

  disconnectSocket();

  clearAuthState(set);  // ← Monolithic reset function
};
```

### clearAuthState() Hard-Codes All Slices

```typescript
// authSlice.ts, line 17–62

function clearAuthState(set: (partial: Partial<StoreState>) => void) {
  sessionStorage.removeItem('user');
  sessionStorage.removeItem('memberships');
  sessionStorage.removeItem('activeMembershipId');
  sessionStorage.removeItem('activePartnerId');
  
  set({
    // auth
    user: null,
    memberships: [],
    activeMembershipId: null,
    activePartnerId: null,
    
    // ticket (partner-scoped)
    tickets: [],
    activeTicketId: null,
    unreadTickets: {},
    unreadSenders: {},
    participantsOnline: {},
    supportOpenTickets: [],
    queuePosition: null,
    topicAlerts: [],
    
    // message (partner-scoped)
    messages: {},
    messageCursors: {},
    onlineSupportUsers: [],
    onlineAgentIds: [],
    typingUsers: {},
    lastRejection: null,
    
    // config (partner-scoped)
    appConfig: null,
    businessHoursStatus: null,
    allLabels: [],
    
    // rating (user-scoped)
    ratingPrompt: null,
    
    // ui (session-scoped)
    agentStatus: 'online',
    lightboxImages: [],
    lightboxIndex: null,
    prefsModifiedLocally: false,
    connectionStatus: 'disconnected',
  });
}
```

**Problem 1**: Scattered across 5 slices; hard to audit.  
**Problem 2**: New slices require edit to `clearAuthState()`.  
**Problem 3**: No clear interface showing "what resets together."  
**Problem 4**: Tests can't verify ticket cleanup in isolation.  

---

## Proposed: Slice Families with Reset Hierarchy

### Conceptual Model

```
┌─────────────────────────────────────────────────────────┐
│ StoreState (6 slices)                                   │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │ AuthFamily                                       │   │
│  ├──────────────────────────────────────────────────┤   │
│  │ Slices: authSlice                                │   │
│  │ State: user, memberships, activeMembershipId     │   │
│  │ Reset: clears sessionStorage + calls partner-    │   │
│  │        data + ui families to reset               │   │
│  └──────────────────────────────────────────────────┘   │
│         ↓ .logout() or session expiry                    │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │ PartnerDataFamily                                │   │
│  ├──────────────────────────────────────────────────┤   │
│  │ Slices: ticketSlice, messageSlice, configSlice  │   │
│  │ State: all partner-scoped data                   │   │
│  │ Reset: clears in-memory + localStorage per-      │   │
│  │        partner state                             │   │
│  └──────────────────────────────────────────────────┘   │
│  ↑ Resets on logout or partner switch                   │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │ UIFamily                                         │   │
│  ├──────────────────────────────────────────────────┤   │
│  │ Slices: uiSlice, ratingSlice                     │   │
│  │ State: lightbox, agent status, rating prompt     │   │
│  │ Reset: clears session UI state only (preserves  │   │
│  │        dark mode, lang, a11y prefs)              │   │
│  └──────────────────────────────────────────────────┘   │
│  ↑ Resets on logout (not partner switch)                │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

**Key**: Each family has a `reset()` method. Auth family calls the others on logout.

---

## Architecture: Type-Safe Family Registry

### 1. Define Family Interface

```typescript
// client/src/store/families.ts (new file)

import { StoreState } from '../types';

/**
 * A SliceFamily groups related slices and declares their reset logic.
 * Families are composed at store creation time; reset is called
 * (a) by dependent families during their own reset, or
 * (b) directly via useStore.getState() in event handlers.
 */
export interface SliceFamily {
  /** Human-readable name for debugging */
  name: string;
  
  /** Slice keys (member of) this family. Used for validation + docs. */
  sliceKeys: (keyof StoreState)[];
  
  /**
   * Reset method: called with the Zustand `set` function and full `get` function.
   * Responsible for clearing all its own state fields and any side effects
   * (sessionStorage, localStorage, etc.).
   */
  reset: (
    set: (partial: Partial<StoreState>) => void,
    get: () => StoreState,
  ) => void;
}
```

### 2. Create Each Family

#### AuthFamily

```typescript
// client/src/store/families.ts

export const authFamily: SliceFamily = {
  name: 'AuthFamily',
  sliceKeys: ['user', 'memberships', 'activeMembershipId', 'activePartnerId'],
  
  reset: (set, get) => {
    // Clear persistent auth tokens
    sessionStorage.removeItem('user');
    sessionStorage.removeItem('memberships');
    sessionStorage.removeItem('activeMembershipId');
    sessionStorage.removeItem('activePartnerId');
    
    // Clear auth state itself
    set({
      user: null,
      memberships: [],
      activeMembershipId: null,
      activePartnerId: null,
    });
    
    // Trigger partner-data reset (user is now null, so no active partner)
    partnerDataFamily.reset(set, get);
    
    // Trigger UI reset (preserve device prefs)
    uiFamily.reset(set, get);
  },
};
```

#### PartnerDataFamily

```typescript
export const partnerDataFamily: SliceFamily = {
  name: 'PartnerDataFamily',
  sliceKeys: ['tickets', 'activeTicketId', 'unreadTickets', 'unreadSenders',
    'participantsOnline', 'supportOpenTickets', 'queuePosition', 'topicAlerts',
    'messages', 'messageCursors', 'onlineSupportUsers', 'onlineAgentIds', 'typingUsers',
    'lastRejection', 'appConfig', 'businessHoursStatus', 'allLabels'
  ],
  
  reset: (set, get) => {
    const activeMembershipId = get().activeMembershipId;
    
    // Clear partner-scoped localStorage (per-partner open tabs)
    if (activeMembershipId) {
      localStorage.removeItem(`guichet:supportOpenTabs:${activeMembershipId}`);
    }
    
    // Clear all partner-scoped in-memory state
    set({
      // ticket slice
      tickets: [],
      activeTicketId: null,
      unreadTickets: {},
      unreadSenders: {},
      participantsOnline: {},
      supportOpenTickets: [],
      queuePosition: null,
      topicAlerts: [],
      
      // message slice
      messages: {},
      messageCursors: {},
      onlineSupportUsers: [],
      onlineAgentIds: [],
      typingUsers: {},
      lastRejection: null,
      
      // config slice
      appConfig: null,
      businessHoursStatus: null,
      allLabels: [],
    });
  },
};
```

#### UIFamily

```typescript
export const uiFamily: SliceFamily = {
  name: 'UIFamily',
  sliceKeys: ['agentStatus', 'lightboxImages', 'lightboxIndex', 'prefsModifiedLocally', 'connectionStatus', 'ratingPrompt'],
  
  reset: (set, get) => {
    // Clear session-scoped UI state but preserve device preferences
    // (darkMode, selectedLang, dyslexicMode, bionicReading, monochromeMode,
    //  focusMode, notificationsEnabled, soundEnabled, viewMode, rightSidebarExpanded).
    
    set({
      agentStatus: 'online',
      lightboxImages: [],
      lightboxIndex: null,
      prefsModifiedLocally: false,
      connectionStatus: 'disconnected',
      ratingPrompt: null,
    });
  },
};
```

### 3. Family Registry (for Inspection + Validation)

```typescript
// client/src/store/families.ts

export const familyRegistry: Record<string, SliceFamily> = {
  auth: authFamily,
  partnerData: partnerDataFamily,
  ui: uiFamily,
};

/**
 * Validate that all StoreState fields are declared in exactly one family.
 * Run at dev time to catch configuration drift.
 */
export function validateFamilyRegistry(storeKeys: (keyof StoreState)[]): void {
  const declaredKeys = new Set<keyof StoreState>();
  
  Object.values(familyRegistry).forEach((family) => {
    family.sliceKeys.forEach((key) => {
      if (declaredKeys.has(key)) {
        throw new Error(`Key "${String(key)}" declared in multiple families`);
      }
      declaredKeys.add(key);
    });
  });
  
  // Warn about undeclared keys (won't fail, just warn)
  storeKeys.forEach((key) => {
    if (!declaredKeys.has(key)) {
      console.warn(`Store key "${String(key)}" is not declared in any family`);
    }
  });
}
```

---

## Integration: Updated authSlice.logout()

### Before (Implicit)

```typescript
logout: async () => {
  try {
    await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include' });
  } catch {}
  
  if ('caches' in window) {
    caches.keys().then((keys) => keys.forEach((key) => caches.delete(key))).catch(() => {});
  }
  
  disconnectSocket();
  
  clearAuthState(set);  // ← Magic function that resets everything
};
```

### After (Explicit Family Composition)

```typescript
// client/src/store/slices/authSlice.ts

import { authFamily } from '../families';

logout: async () => {
  try {
    await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include' });
  } catch {}
  
  if ('caches' in window) {
    caches.keys().then((keys) => keys.forEach((key) => caches.delete(key))).catch(() => {});
  }
  
  disconnectSocket();
  
  // Explicit: reset auth family (which internally resets partner data + UI)
  authFamily.reset(set, get);
};
```

**Benefit**: Line 15 shows exactly what resets. Dev can click on `authFamily` and see the full hierarchy.

---

## Handling Partner Switches

When user switches partners (via `setActiveMembershipId`), only partner-scoped state should reset.

### Current Implementation (authSlice.ts, line 160–199)

```typescript
setActiveMembershipId: (id) => {
  const partnerResetSlice: Partial<StoreState> = {
    supportOpenTickets: [],
    tickets: [],
    messages: {},
    activeTicketId: null,
    unreadTickets: {},
    unreadSenders: {},
  };

  if (id) {
    // ... switch to new partner
    set({ ...partnerResetSlice, activeMembershipId: id, activePartnerId: membership.partnerId });
  } else {
    // ... return to platform cockpit
    set({ ...partnerResetSlice, activeMembershipId: null, ... });
  }
};
```

**Problem**: Hard-coded slice fields again.

### With Families

```typescript
setActiveMembershipId: (id) => {
  // Reset only partner-scoped state, not auth or device UI prefs
  partnerDataFamily.reset(set, get);
  
  if (id) {
    const membership = get().memberships.find(m => m.id === id);
    if (membership) {
      sessionStorage.setItem('activePartnerId', membership.partnerId);
      set({ activeMembershipId: id, activePartnerId: membership.partnerId });
    }
  } else {
    sessionStorage.removeItem('activeMembershipId');
    sessionStorage.removeItem('activePartnerId');
    const filtered = get().memberships.filter(m => !m.id.startsWith('platform_'));
    sessionStorage.setItem('memberships', JSON.stringify(filtered));
    set({ activeMembershipId: null, activePartnerId: null, memberships: filtered });
  }
  
  syncUserRole(set, get);
};
```

**Benefit**: Clear intent: "reset partner data when switching partners."

---

## Backward Compatibility: useStore() Unchanged

Components continue to use the same selectors:

```typescript
// Before + After — no change needed

const { tickets, activeTicketId } = useStoreShallow(s => ({
  tickets: s.tickets,
  activeTicketId: s.activeTicketId,
}));

const user = useStore(s => s.user);
```

The families are an **internal organization pattern** for reset logic, not a public API change.

---

## Testing: Family Resets in Isolation

### Test PartnerDataFamily Reset Independently

```typescript
// client/src/store/__tests__/families.test.ts

import { describe, it, expect } from 'vitest';
import { create } from 'zustand';
import { StoreState } from '../../types';
import { partnerDataFamily } from '../families';
import { createTicketSlice } from '../slices/ticketSlice';
import { createMessageSlice } from '../slices/messageSlice';
import { createConfigSlice } from '../slices/configSlice';

describe('PartnerDataFamily', () => {
  it('resets all partner-scoped state', () => {
    const useTestStore = create<StoreState>((...a) => ({
      ...createTicketSlice(...a),
      ...createMessageSlice(...a),
      ...createConfigSlice(...a),
      activeMembershipId: 'member-123',
      activePartnerId: 'partner-456',
    }));
    
    // Seed the store with partner data
    useTestStore.setState({
      tickets: [{ id: 't1', subject: 'Issue' }],
      messages: { t1: [{ id: 'm1', body: 'Hello' }] },
      allLabels: [{ id: 'label1', name: 'Bug' }],
    });
    
    // Reset the family
    partnerDataFamily.reset(
      (partial) => useTestStore.setState(partial),
      () => useTestStore.getState(),
    );
    
    // Assert: all partner-scoped fields cleared
    const state = useTestStore.getState();
    expect(state.tickets).toEqual([]);
    expect(state.messages).toEqual({});
    expect(state.allLabels).toEqual([]);
    expect(state.appConfig).toBeNull();
    
    // Assert: auth fields untouched
    expect(state.activeMembershipId).toBe('member-123');
    expect(state.activePartnerId).toBe('partner-456');
  });
});
```

**Benefit**: Tests verify ticket cleanup independently without mocking other slices.

---

## Trade-offs Analysis

| Aspect | Gain | Loss |
|--------|------|------|
| **Mental Model** | Crystal-clear family membership; "partner data resets together" | Slightly more code upfront |
| **Testability** | Families can be tested in isolation | Need to wire up test stores properly |
| **Maintainability** | New partner-scoped slices auto-join by declaring membership | Must update family registry when adding slices |
| **Dependency Clarity** | Explicit call graph (auth → partner data → ui) | Circular dependency risk if not careful (solved by unidirectional flow) |
| **Refactoring** | Easy to swap reset logic for specific families without touching others | If a field moves families, must update registry |
| **Type Safety** | TypeScript validates `sliceKeys` at compile time | Must keep `sliceKeys` in sync with actual reset fields |
| **Backward Compat** | 100% — no changes to components or selectors | None |

### Hidden Complexity

1. **Circular Dependencies**: If `partnerDataFamily.reset()` called `authFamily.reset()`, we'd have a loop. **Solution**: Enforce unidirectional flow (auth → partnerData → ui). Add a lint rule to catch reverse dependencies.

2. **Side Effects**: What if a family reset triggers a socket disconnect or API call? **Solution**: Keep families as pure state mutations. Side effects (like `disconnectSocket()`) stay in `authSlice.logout()` before calling families.

3. **Validation at Runtime**: The `validateFamilyRegistry()` helper catches drift. **Solution**: Call it in store bootstrap (dev only) or in CI.

4. **Hydration Timing**: Do families reset during hydration (page reload)? **Solution**: Only on logout/switch, not on initial `safeJsonParse()`. Auth family is the only one that hydrates from sessionStorage.

---

## Implementation Roadmap

### Phase 1: Create Families File (No Breaking Changes)

```bash
1. Create client/src/store/families.ts
   - Define SliceFamily interface
   - Define authFamily, partnerDataFamily, uiFamily
   - Add validateFamilyRegistry()
2. Run validation in dev (optional, warn-only)
3. Test with isolated Vitest suite
4. Commit without modifying authSlice yet
```

### Phase 2: Wire into authSlice

```bash
1. Import authFamily in authSlice.ts
2. Replace clearAuthState(set) call with authFamily.reset(set, get)
3. Remove clearAuthState() function
4. Update setActiveMembershipId() to call partnerDataFamily.reset()
5. E2E test: logout flow, partner switch flow
```

### Phase 3: Documentation + Convention

```bash
1. Update CLAUDE.md with "Family Membership" section
2. Add JSDoc template for new slices:
   /**
    * Part of PartnerDataFamily.
    * Resets on logout + partner switch.
    */
3. Lint rule: warn if new slice doesn't declare family membership
```

### Phase 4 (Optional): Extend Pattern

```bash
If needed later: add a resetAllFamilies() for session expiry edge cases,
or a partialReset(family) for advanced use cases.
```

---

## Key Decisions

1. **Unidirectional Dependency Flow**: Auth calls partner-data; partner-data never calls auth. Prevents cycles.

2. **Slices Declare, Don't Register**: Each slice declares its own reset logic. `PartnerDataFamily` composes multiple slices but doesn't own them.

3. **Families are Functions, Not Classes**: Keep it simple; use closures for clarity. No inheritance or complex OOP.

4. **Validation is Optional**: `validateFamilyRegistry()` is a lint/dev helper, not a runtime gate. Catches drift early.

5. **No New Public API**: Components don't import families. Only slices use them internally. Keeps API surface minimal.

---

## Example: Adding a New Partner-Scoped Slice

### Before (Manual Edit)

```typescript
// 1. Create new slice
export const createTranscriptSlice: StateCreator<StoreState, [], [], TranscriptSlice> = ...

// 2. Add to useStore in useStore.ts
const useStore = create<StoreState>((...a) => ({
  ...createAuthSlice(...a),
  ...createTranscriptSlice(...a),  // ← New
  ...createTicketSlice(...a),
  ...createMessageSlice(...a),
  ...createUISlice(...a),
  ...createConfigSlice(...a),
  ...createRatingSlice(...a),
}));

// 3. Edit clearAuthState() manually
function clearAuthState(set: (partial: Partial<StoreState>) => void) {
  set({
    // ... existing fields ...
    transcripts: [],  // ← Add here
    activeTranscriptId: null,  // ← Add here
  });
}
```

### After (Declarative)

```typescript
// 1. Create new slice with family annotation
/**
 * PartnerDataFamily: resets on logout + partner switch.
 */
export const createTranscriptSlice: StateCreator<StoreState, [], [], TranscriptSlice> = ...

// 2. Add to useStore (same as before)
const useStore = create<StoreState>((...a) => ({
  ...createAuthSlice(...a),
  ...createTranscriptSlice(...a),  // ← No special handling
  ...createTicketSlice(...a),
  ...createMessageSlice(...a),
  ...createUISlice(...a),
  ...createConfigSlice(...a),
  ...createRatingSlice(...a),
}));

// 3. Update family registry (one place)
export const partnerDataFamily: SliceFamily = {
  name: 'PartnerDataFamily',
  sliceKeys: [
    'tickets', 'activeTicketId', 'unreadTickets', 'unreadSenders',
    'participantsOnline', 'supportOpenTickets', 'queuePosition', 'topicAlerts',
    'messages', 'messageCursors', 'onlineSupportUsers', 'onlineAgentIds', 'typingUsers',
    'lastRejection', 'appConfig', 'businessHoursStatus', 'allLabels',
    'transcripts', 'activeTranscriptId',  // ← Add here
  ],
  reset: (set, get) => {
    set({
      // ... existing resets ...
      transcripts: [],  // ← Add here
      activeTranscriptId: null,  // ← Add here
    });
  },
};
```

**Benefit**: Single family declaration captures intent + reset logic. No scattered manual edits.

---

## Alternatives Considered

### Alternative 1: Pub/Sub Pattern

**Idea**: Each slice subscribes to a "reset" event. When auth.logout() fires the event, all subscribers reset.

```typescript
// Example
useStore.subscribe((state) => state.user, (newUser, oldUser) => {
  if (oldUser && !newUser) {
    ticketSlice.resetOnLogout();
    messageSlice.resetOnLogout();
  }
});
```

**Pros**: 
- Decoupled; each slice knows only about itself.

**Cons**:
- Implicit dependencies harder to trace (what fires the event?).
- Subtle bugs if subscriber order matters.
- Hard to test (must orchestrate multiple subscriptions).

### Alternative 2: Middleware Pattern

**Idea**: Intercept `set()` calls and run family reset logic as middleware.

```typescript
const useStore = create<StoreState>(
  withFamilyMiddleware((...a) => ({
    ...createAuthSlice(...a),
    ...createTicketSlice(...a),
  }))
);
```

**Pros**:
- Automatic; slices don't call families explicitly.

**Cons**:
- Magic behavior; hard to debug.
- Middleware complexity; side effects hidden.
- Testing middleware is harder than testing pure functions.

### Alternative 3: Registry Pattern (Centralized)

**Idea**: Central registry maps slices → reset functions. Slices register on creation.

```typescript
familyRegistry.register('ticketSlice', {
  onLogout: (set) => set({ tickets: [], ... }),
});
```

**Pros**:
- Single source of truth for all resets.

**Cons**:
- Slices must reach out to registry (dependency inversion).
- New slices require mutation of shared registry.
- Harder to reason about initialization order.

### Why We Chose Families

**Families** strike a balance:
- **Explicit** (unlike pub/sub) — clear call graph.
- **Composable** (unlike middleware) — pure functions, easy to test.
- **Organized** (unlike registry) — families group related slices, not scattered calls.
- **Declarative** (unlike mixed approaches) — "PartnerDataFamily" reads as intent.

---

## Implementation Code Template

See separate file: `zustand-family-pattern-implementation.ts` (if attached).

---

## Validation Checklist

- [ ] All 6 slices declared in exactly one family
- [ ] Unidirectional dependency: auth → partnerData → ui (no reverse calls)
- [ ] No side effects in family.reset() (side effects stay in authSlice.logout())
- [ ] Tests verify each family's reset independently
- [ ] E2E tests verify full logout + partner-switch flows
- [ ] Components unchanged; backward compatible 100%
- [ ] `validateFamilyRegistry()` runs in dev + CI
- [ ] CLAUDE.md updated with family membership convention
- [ ] JSDoc template added for new slices

---

## Conclusion

The family pattern transforms implicit logout logic into **declarative composition**. Developers see "AuthFamily calls PartnerDataFamily" and immediately understand what resets. New partner-scoped slices auto-join by updating one registry. Tests can verify resets in isolation.

Trade-off: ~50 lines of boilerplate for massive clarity gains.

**Recommend**: Implement Phase 1 + 2, then make it the standard for new slices.
