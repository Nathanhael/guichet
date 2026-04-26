# Zustand Store Reset Pattern: Design Brief

## Problem

**Current state**: `authSlice.clearAuthState()` directly mutates all 5 other slices. This is brittle and untestable.

```typescript
// authSlice.ts (lines 17-62)
function clearAuthState(set: (partial: Partial<StoreState>) => void) {
  set({
    // Directly mutates ticket, message, config, rating, ui slices ↓
    tickets: [],
    activeTicketId: null,
    unreadTickets: {},
    messages: {},
    messageCursors: {},
    onlineSupportUsers: [],
    onlineAgentIds: [],
    typingUsers: {},
    appConfig: null,
    businessHoursStatus: null,
    allLabels: [],
    ratingPrompt: null,
    agentStatus: 'online',
    lightboxImages: [],
    lightboxIndex: null,
    connectionStatus: 'disconnected',
  });
}
```

**Issues**:
1. **Tight coupling**: authSlice knows the internal shape of 5 other slices.
2. **Untestable slice isolation**: You can't test `ticketSlice` without risking it being reset by auth logout.
3. **Brittle refactoring**: Adding a field to ticketSlice requires editing authSlice.
4. **Single responsibility violation**: authSlice owns both auth lifecycle AND global state cleanup.

---

## Solution: Minimal Reset Registry

A **registry pattern** where each slice declares what it resets on logout, and authSlice simply iterates the registry. No cross-slice imports.

### Design Principles

1. **Centralized contracts, decentralized ownership**: Each slice owns its reset logic.
2. **Single entry point**: `useStore.logout()` is the ONLY place a human calls reset.
3. **Backward compatible**: `useStore(s => s.tickets)` still works.
4. **Testable**: Each slice's reset can be unit-tested independently.
5. **No new files**: Lean into Zustand's compose pattern.

---

## Implementation

### Step 1: Define Reset Contracts (In Each Slice)

Each slice exports a `ResetFields` type and a resetter function:

```typescript
// ticketSlice.ts

export interface TicketSlice {
  // ... existing fields
  tickets: Ticket[];
  activeTicketId: string | null;
  unreadTickets: Record<string, number>;
  unreadSenders: Record<string, string>;
  participantsOnline: Record<string, boolean>;
  supportOpenTickets: string[];
  queuePosition: { position: number; etaMins: number } | null;
  topicAlerts: TopicAlert[];
  
  // ... existing setters
  setTickets: (tickets: Ticket[]) => void;
  // ...
  
  // NEW: Reset contract (internal, only called by store)
  _resetTicketState?: () => void;
}

export const createTicketSlice: StateCreator<StoreState, [], [], TicketSlice> = (set, get) => ({
  tickets: [],
  activeTicketId: null,
  unreadTickets: {},
  unreadSenders: {},
  participantsOnline: {},
  supportOpenTickets: [],
  queuePosition: null,
  topicAlerts: [],
  
  // ... existing setters
  
  // NEW: Resetter function (idempotent, pure)
  _resetTicketState: () =>
    set({
      tickets: [],
      activeTicketId: null,
      unreadTickets: {},
      unreadSenders: {},
      participantsOnline: {},
      supportOpenTickets: [],
      queuePosition: null,
      topicAlerts: [],
    }),
});
```

**Why `_resetTicketState`?**
- Underscore prefix signals "internal, don't call directly".
- Named clearly so grep finds all resetters.
- Defined inline in the slice where state lives.
- Idempotent: calling twice = calling once.

### Step 2: Refactor authSlice.logout()

Replace the hardcoded `clearAuthState()` with a registry iteration:

```typescript
// authSlice.ts

// NEW: Centralized reset orchestrator (1 line per resetter)
function clearAllPartnerState(get: () => StoreState, set: (partial: Partial<StoreState>) => void) {
  // Clear auth
  sessionStorage.removeItem('user');
  sessionStorage.removeItem('memberships');
  sessionStorage.removeItem('activeMembershipId');
  sessionStorage.removeItem('activePartnerId');
  
  // Disable service worker cache on shared devices
  if ('caches' in window) {
    caches.keys().then((keys) => keys.forEach((key) => caches.delete(key))).catch(() => {});
  }
  
  // Tear down socket
  disconnectSocket();
  
  // Reset all partner-scoped slices by calling their resetters
  const state = get();
  state._resetTicketState?.();
  state._resetMessageState?.();
  state._resetConfigState?.();
  state._resetRatingState?.();
  // ui state intentionally NOT reset; device prefs preserved
  
  // Finally reset auth state
  set({
    user: null,
    memberships: [],
    activeMembershipId: null,
    activePartnerId: null,
    agentStatus: 'online',
    lightboxImages: [],
    lightboxIndex: null,
    connectionStatus: 'disconnected',
  });
}

export const createAuthSlice: StateCreator<StoreState, [], [], AuthSlice> = (set, get) => {
  // ... existing initialization
  
  return {
    // ... existing fields
    
    logout: async () => {
      try {
        await fetch('/api/v1/auth/logout', {
          method: 'POST',
          credentials: 'include',
        });
      } catch {
        // Network failure doesn't block local logout
      }
      
      // NEW: Use orchestrator instead of hardcoded reset
      clearAllPartnerState(get, set);
    },
  };
};
```

### Step 3: Update messageSlice, configSlice, ratingSlice

Same pattern as ticketSlice. Example:

```typescript
// messageSlice.ts

export interface MessageSlice {
  messages: Record<string, Message[]>;
  messageCursors: Record<string, { hasMore: boolean; nextCursor?: string; loading: boolean }>;
  onlineSupportUsers: OnlineSupport[];
  onlineAgentIds: string[];
  typingUsers: Record<string, Record<string, boolean>>;
  lastRejection: MessageRejection | null;
  
  // ... existing setters
  
  // NEW: Reset contract
  _resetMessageState?: () => void;
}

export const createMessageSlice: StateCreator<StoreState, [], [], MessageSlice> = (set) => ({
  messages: {},
  messageCursors: {},
  onlineSupportUsers: [],
  onlineAgentIds: [],
  typingUsers: {},
  lastRejection: null,
  
  // ... existing setters
  
  // NEW: Resetter
  _resetMessageState: () =>
    set({
      messages: {},
      messageCursors: {},
      onlineSupportUsers: [],
      onlineAgentIds: [],
      typingUsers: {},
      lastRejection: null,
    }),
});
```

### Step 4: StoreState Type Union (Already Exist)

TypeScript automatically unions all slice interfaces:

```typescript
// types/index.ts (unchanged, Zustand does this automatically)
export type StoreState = AuthSlice & TicketSlice & MessageSlice & 
                         ConfigSlice & UISlice & RatingSlice;
```

---

## Usage

### Component Usage (Unchanged)

```typescript
// components/LoginView.tsx
import useStore from '../store/useStore';

export function LoginView() {
  const logout = useStore(s => s.logout);
  
  return (
    <button onClick={logout}>
      Logout
    </button>
  );
}
```

**That's it.** One line. No complexity exposed.

### Full User Flow

```
1. User clicks "Logout"
2. Component calls `logout()`
3. logout() calls `clearAllPartnerState(get, set)`
4. clearAllPartnerState() iterates resetters:
   - _resetTicketState()
   - _resetMessageState()
   - _resetConfigState()
   - _resetRatingState()
   - (ui NOT reset; device prefs preserved)
5. Finally resets auth state
6. Socket already torn down
7. Browser navigates to /login
8. New user logs in with clean state
```

---

## Testing

### Test 1: Ticket Slice Isolation

```typescript
// ticketSlice.test.ts
import { describe, it, expect } from 'vitest';
import { createTicketSlice } from './ticketSlice';

describe('ticketSlice._resetTicketState', () => {
  it('resets all ticket state to initial', () => {
    let state = { tickets: [], activeTicketId: null, unreadTickets: {}, /* ... */ };
    const set = (partial: Partial<typeof state>) => {
      state = { ...state, ...partial };
    };
    const get = () => state;
    
    const slice = createTicketSlice(set, get);
    
    // Mutate state
    slice.addTicket({ id: 'tk1', customerId: 'c1', status: 'open', /* ... */ });
    slice.setActiveTicketId('tk1');
    slice.markUnread('tk1', 'Alice');
    
    expect(state.tickets.length).toBe(1);
    expect(state.activeTicketId).toBe('tk1');
    
    // Reset
    slice._resetTicketState?.();
    
    expect(state.tickets).toEqual([]);
    expect(state.activeTicketId).toBeNull();
    expect(state.unreadTickets).toEqual({});
  });
});
```

### Test 2: Auth Logout Orchestration

```typescript
// authSlice.test.ts
describe('logout orchestration', () => {
  it('calls all slice resetters in order', () => {
    const calls: string[] = [];
    const state = {
      _resetTicketState: () => calls.push('ticket'),
      _resetMessageState: () => calls.push('message'),
      _resetConfigState: () => calls.push('config'),
      _resetRatingState: () => calls.push('rating'),
      // ... other fields
    };
    
    const get = () => state;
    const set = vitest.fn();
    
    clearAllPartnerState(get, set);
    
    expect(calls).toEqual(['ticket', 'message', 'config', 'rating']);
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        user: null,
        memberships: [],
        activeMembershipId: null,
      })
    );
  });
});
```

---

## Hidden Complexity

This abstraction **hides**:

1. **Slice coupling**: Components never import auth logic; logout is transparent.
2. **Reset order**: ticketSlice resets first, then messageSlice, etc. (intentional but hidden).
3. **sessionStorage cleanup**: Only auth knows about it; other slices only know Zustand.
4. **Socket teardown**: Orthogonal to state reset; hidden in logout().
5. **Device preference preservation**: UI slice intentionally NOT in reset loop (hidden decision).

---

## Dependency Strategy

**No cross-slice imports.** Each slice is independent.

Slices communicate reset via:
1. **Registry pattern**: `authSlice` calls `get()`, checks for `_resetX` methods.
2. **Optional chaining**: `state._resetTicketState?.()` (safe if resetter missing).
3. **Zustand's `get()` at reset time**: Slices are already composed; `get()` sees them all.

```typescript
// No this:
import { resetTickets } from './ticketSlice'; // ❌ Circular risk

// Yes this:
const state = get(); // Already has all resetters
state._resetTicketState?.(); // Call via reference
```

---

## Dependency Graph

```
┌──────────────────────────────────────────┐
│           useStore.logout()              │
│      (1 entry point, components call)    │
└──────────────────────────────────────────┘
                     ↓
    ┌────────────────────────────────────┐
    │  clearAllPartnerState(get, set)    │
    │  (orchestrator, lives in authSlice)│
    └────────────────────────────────────┘
            ↓           ↓           ↓
    ┌────────────┐ ┌─────────┐ ┌───────────┐
    │  ticket    │ │ message │ │  config   │
    │  ._reset() │ │._reset()│ │._reset()  │
    └────────────┘ └─────────┘ └───────────┘
         ↓
  (Reset independently:
   no imports between slices)
```

---

## Trade-offs

| Trade-off | Cost | Benefit |
|-----------|------|---------|
| **Extra methods per slice** | 1 line per slice | Each slice owns its reset logic; testable in isolation |
| **Resetters optional** (`?.()`) | Safer but looser | No compile-time guarantee; caught at runtime if resetter missing |
| **centralized orchestrator** | 1 function in authSlice | Single clear source of truth for reset order |
| **Resetter not public API** | Naming convention (`_reset*`) | Signals "internal"; prevents accidental direct calls |
| **No exported reset registry** | Can't introspect reset order | Simpler; register is implicit in orchestrator loop |
| **Device prefs preserved** | Must manually exclude ui slice | Solves shared device scenario; requires intent |

---

## Migration Path

### Phase 1: Add Resetters (Non-Breaking)

1. Add `_resetTicketState`, `_resetMessageState`, etc. to each slice.
2. `clearAuthState()` still works (unchanged).
3. Tests pass.

### Phase 2: Switchover

1. Replace `clearAuthState()` call with `clearAllPartnerState()`.
2. Verify logout flow in browser.
3. Delete old `clearAuthState()` function.

### Phase 3: Leverage Isolation

1. Write unit tests for each slice's resetter independently.
2. Refactor slices without fear of breaking logout.

---

## Edge Cases

### Q: What if a slice is added later?

**A**: Add `_resetNewSlice()` to the new slice, call it in `clearAllPartnerState()`. One-line addition.

### Q: What if a resetter fails (throws)?

**A**: Wrap in try-catch:

```typescript
function clearAllPartnerState(get: () => StoreState, set: (partial: Partial<StoreState>) => void) {
  try { get()._resetTicketState?.(); } catch (e) { console.error('Ticket reset failed:', e); }
  try { get()._resetMessageState?.(); } catch (e) { console.error('Message reset failed:', e); }
  // ...
}
```

### Q: What about partnerSwitch (setActiveMembershipId)?

**A**: `setActiveMembershipId()` already manually resets `supportOpenTickets`, `tickets`, `messages`, `activeTicketId`, `unreadTickets`, `unreadSenders` (lines 167–174). This is correct: switching partners is NOT the same as logout.

If you want to DRY it up, extract a `clearPartnerState()` helper:

```typescript
function clearPartnerState(set: (partial: Partial<StoreState>) => void) {
  set({
    supportOpenTickets: [],
    tickets: [],
    messages: {},
    activeTicketId: null,
    unreadTickets: {},
    unreadSenders: {},
  });
}
```

Then call in both `setActiveMembershipId()` and `logout()`. But it's orthogonal to the reset registry.

---

## Summary

| Aspect | Pattern |
|--------|---------|
| **Entry point** | `useStore(s => s.logout)` — one line, always |
| **Complexity location** | `clearAllPartnerState()` in authSlice |
| **Slice ownership** | Each slice owns its `_resetX` method |
| **Communication** | Via `get()` at reset time; no cross-imports |
| **Testing** | Each slice tested independently + orchestration test |
| **Scalability** | Add resetter to new slice; call in orchestrator |
| **Device prefs** | Preserved by not including ui slice in reset |
| **Backward compat** | 100% — `useStore(s => s.logout)` unchanged |

---

## Code Checklist

- [ ] Add `_resetTicketState?: () => void` to `TicketSlice`
- [ ] Add `_resetMessageState?: () => void` to `MessageSlice`
- [ ] Add `_resetConfigState?: () => void` to `ConfigSlice`
- [ ] Add `_resetRatingState?: () => void` to `RatingSlice`
- [ ] Replace `clearAuthState()` in authSlice with `clearAllPartnerState()`
- [ ] Add unit test for each slice's resetter
- [ ] Add integration test for logout orchestration
- [ ] Verify browser logout flow (dev login → logout → login)
- [ ] Delete old `clearAuthState()` function
