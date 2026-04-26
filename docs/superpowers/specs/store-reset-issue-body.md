# Zustand Store Reset Refactor — Registry Pattern

## Problem

`authSlice.clearAuthState()` directly mutates 5 other slices (tickets, messages, config, ui, rating). This breaks isolation: unit tests can't test ticket reset independently; refactoring any slice requires editing authSlice.

## Current (Brittle)

```typescript
const clearAuthState = () => {
  set({
    user: null,
    // Mutates other slices' state directly
    tickets: [],
    unreadTickets: {},
    messages: {},
    onlineSupportUsers: [],
    appConfig: null,
    allLabels: [],
    agentStatus: 'online',
    ratingTicketId: null,
  });
};
```

**Problem**: Test ticket cleanup → must mock full store. Rename `unreadTickets` → must edit authSlice + ticketSlice + every hook.

## Proposed: Registry Pattern

Each slice declares its own reset logic as `_resetX()` method. `authSlice` orchestrates via `clearAllPartnerState(get, set)`.

### Updated Signatures

```typescript
// authSlice
clearAllPartnerState = (get, set) => {
  // Call each slice's reset
  get()._resetTicketState?.();
  get()._resetMessageState?.();
  get()._resetConfigState?.();
  get()._resetUIState?.();
  get()._resetRatingState?.();
  
  // Reset auth-owned fields
  set({
    user: null,
    memberships: [],
    activeMembershipId: null,
    activePartnerId: null,
  });
};

// ticketSlice
_resetTicketState: () => void = () => {
  set({
    tickets: [],
    unreadTickets: {},
    activeTicketId: null,
    ticketsCursor: null,
  });
};

// messageSlice
_resetMessageState: () => void = () => {
  set({
    messages: {},
    onlineSupportUsers: [],
    typingUsers: {},
  });
};

// Repeat for config, ui, rating slices
```

## Benefits

| Property | Current | Proposed |
|----------|---------|----------|
| **Coupling** | authSlice → 5 others | authSlice → registry only |
| **Test isolation** | Mock full store | Mock ticket slice only |
| **Refactor safety** | Edit authSlice + slice | Edit slice only |
| **Visibility** | Scattered across set({}) | Centralized in authSlice |
| **Scalability** | Add slice → edit authSlice | Add slice → add resetter, one line |

## Implementation Plan

### Phase 1: Extract Reset Methods
- Add `_resetTicketState()` to ticketSlice
- Add `_resetMessageState()` to messageSlice
- Add `_resetConfigState()` to configSlice
- Add `_resetUIState()` to uiSlice
- Add `_resetRatingState()` to ratingSlice
- Each method resets only fields it owns

### Phase 2: Update Orchestration
- Rename `clearAuthState()` → `clearAllPartnerState()`
- Call `_resetX()` methods instead of inline mutations
- Verify backward compatibility (component calls unchanged)

### Phase 3: Tests
- Add unit tests for each slice's `_resetX()` in isolation
- Add integration test for `clearAllPartnerState()`
- Verify logout flow in E2E tests

## Backward Compatibility

- Component calls: `useStore(s => s.logout)()` unchanged
- Hook selectors: `useStore(s => s.tickets)` unchanged
- Only internal orchestration changes; no API break

## Questions for Review

1. Should partner-switch reset differ from logout? (Current: same)
2. Do we want type-safe resetter registry (TS won't let you forget a reset)?
3. Any slices that should NOT reset on logout?
