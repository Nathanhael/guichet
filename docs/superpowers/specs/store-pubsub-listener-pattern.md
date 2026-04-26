# Store Pub/Sub Listener Pattern — Technical Specification

**Status**: Design Specification (for Guichet store reset refactoring)  
**Date**: 2026-04-25  
**Problem**: `authSlice.clearAuthState()` directly mutates 5 other slices. Brittle, hard to extend, couples auth to every other slice.

---

## Executive Summary

This spec designs a **maximum-flexibility pub/sub listener pattern** where:
- `authSlice` emits typed events (e.g., `"auth:logout"`, `"auth:partner-switch"`)
- Other slices **subscribe** independently and reset themselves
- No registry, no central orchestrator, **zero coupling**
- Backward-compatible with existing `useStore(s => s.tickets)` selectors
- Supports conditional resets (e.g., "only reset config if partner changed, not on role change")
- Late-binding subscriptions (listeners registered after store creation)

**Hidden Complexity Addressed**:
- Race conditions between auth state change and listener invocation
- Unsubscription cleanup (prevent memory leaks in tests)
- Slice dependencies (e.g., message reset depends on ticket reset finishing)
- Event filtering (e.g., "subscribe to logout, not to partner switch")

---

## Architecture Overview

### Core Pattern: Event-Driven Reset

```
authSlice.logout()
  ↓
emit("auth:logout", { reason, userId })
  ↓
[ticketSlice listens]      [messageSlice listens]      [configSlice listens]
     ↓                          ↓                            ↓
reset tickets        →    reset messages         →    reset appConfig
```

**Key Insight**: Emission happens **inside** the Zustand `set()` call, so listeners can synchronously read the new auth state and decide what to reset.

---

## Interface Design

### 1. Event Types & Emitter API

```typescript
// Types: What events can be emitted?
export type StoreEvent = 
  | { type: 'auth:logout'; reason: 'user' | 'session-expired'; userId: string }
  | { type: 'auth:partner-switch'; from: string; to: string; userId: string }
  | { type: 'auth:role-change'; newRole: User['role'] }
  | { type: 'auth:membership-change'; added?: string[]; removed?: string[] }
  | { type: 'config:reload-required' };

// Emitter: How does authSlice broadcast?
export interface StoreEventEmitter {
  emit<T extends StoreEvent>(event: T): void;
  on<T extends StoreEvent>(
    type: T['type'],
    listener: (event: T) => void,
  ): Unsubscribe;
  once<T extends StoreEvent>(
    type: T['type'],
    listener: (event: T) => void,
  ): void;
}

export type Unsubscribe = () => void;
```

**Design Choices**:
- **Typed events**: TypeScript ensures only valid event shapes are emitted
- **Union discriminator**: `type` field allows exhaustive filtering
- **Synchronous API**: No promises, no async listeners (avoid transaction complexity)
- **Return unsubscribe**: Caller owns cleanup, not the emitter

---

### 2. Integration with Zustand

Emitter is **created per store instance**, not global:

```typescript
// store/eventEmitter.ts
export class StoreEventEmitter implements EventEmitterInterface {
  private listeners: Map<StoreEvent['type'], Set<(e: StoreEvent) => void>> = new Map();

  emit<T extends StoreEvent>(event: T): void {
    const subs = this.listeners.get(event.type);
    if (!subs) return;
    // Synchronous, in-order invocation. First listener to throw halts the chain.
    for (const fn of subs) fn(event as any);
  }

  on<T extends StoreEvent>(
    type: T['type'],
    listener: (event: T) => void,
  ): Unsubscribe {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    const subs = this.listeners.get(type)!;
    subs.add(listener as any);
    return () => subs.delete(listener as any);
  }

  once<T extends StoreEvent>(
    type: T['type'],
    listener: (event: T) => void,
  ): void {
    const unsub = this.on(type, (e) => {
      unsub();
      listener(e as T);
    });
  }

  clear(): void {
    this.listeners.clear();
  }
}

// Singleton per store, passed into context
const eventEmitter = new StoreEventEmitter();
```

Wired into `useStore.ts`:

```typescript
import { StoreEventEmitter } from './eventEmitter';
import type { StoreState } from '../types';

const eventEmitter = new StoreEventEmitter();

const useStore = create<StoreState>((...a) => ({
  ...createAuthSlice(eventEmitter)(...a),
  ...createTicketSlice(eventEmitter)(...a),
  ...createMessageSlice(eventEmitter)(...a),
  ...createUISlice(eventEmitter)(...a),
  ...createConfigSlice(eventEmitter)(...a),
  ...createRatingSlice(eventEmitter)(...a),
}));

// Export for tests & late-binding subscriptions
export { eventEmitter as storeEventEmitter };
```

**Why not global?**
- Multiple store instances (e.g., in tests) can coexist without cross-talk
- No singleton pollution; each test gets a fresh emitter
- Future: Client could spawn new stores per tenant (though unlikely)

---

### 3. Slice Implementation Pattern

#### Old (Coupled) Pattern
```typescript
// authSlice.ts: directly mutates all slices
function clearAuthState(set: (partial: Partial<StoreState>) => void) {
  set({
    user: null,
    tickets: [],          // ← authSlice hardcodes ticket reset
    messages: {},         // ← authSlice hardcodes message reset
    appConfig: null,      // ← authSlice hardcodes config reset
    // ...
  });
}
```

#### New (Decoupled) Pattern

```typescript
// authSlice.ts
export const createAuthSlice: StateCreator<StoreState, [], [], AuthSlice> = 
  (emitter: StoreEventEmitter) => (set, get) => {
    // Subscribe to own events? No. But if this slice ever needs to react to
    // OTHER slices' events, it would subscribe here.
    
    return {
      user: null,
      memberships: [],
      logout: async () => {
        try {
          await fetch('/api/v1/auth/logout', { credentials: 'include' });
        } catch {}
        if ('caches' in window) {
          caches.keys().then(keys => keys.forEach(k => caches.delete(k))).catch(() => {});
        }
        disconnectSocket();
        
        // Clear auth state locally
        sessionStorage.removeItem('user');
        sessionStorage.removeItem('memberships');
        sessionStorage.removeItem('activeMembershipId');
        sessionStorage.removeItem('activePartnerId');
        
        // Emit event. OTHER slices listen & reset themselves.
        set({ user: null, memberships: [], activeMembershipId: null, activePartnerId: null });
        emitter.emit({ type: 'auth:logout', reason: 'user', userId: get().user?.id || 'unknown' });
      },
      
      setActiveMembershipId: (id) => {
        // ... set state ...
        emitter.emit({ 
          type: 'auth:partner-switch', 
          from: oldPartnerId, 
          to: newPartnerId, 
          userId: get().user?.id || 'unknown',
        });
      },
    };
  };

// ticketSlice.ts: OWNS its own reset logic
export const createTicketSlice: StateCreator<StoreState, [], [], TicketSlice> = 
  (emitter: StoreEventEmitter) => (set, get) => {
    // Listen to auth events and decide what to reset
    const unsubLogout = emitter.on('auth:logout', () => {
      set({
        tickets: [],
        activeTicketId: null,
        unreadTickets: {},
        unreadSenders: {},
        participantsOnline: {},
        supportOpenTickets: [],
        queuePosition: null,
        topicAlerts: [],
      });
    });

    const unsubPartnerSwitch = emitter.on('auth:partner-switch', () => {
      // Partner switch also resets tickets (same as logout)
      set({
        tickets: [],
        activeTicketId: null,
        unreadTickets: {},
        unreadSenders: {},
        participantsOnline: {},
        supportOpenTickets: [],
        queuePosition: null,
        topicAlerts: [],
      });
    });

    // No unsubscribe needed here because the store lives forever.
    // But in tests, you'd clean up: `emitter.clear()` or `unsub()`.

    return {
      tickets: [],
      activeTicketId: null,
      // ... rest of slice ...
    };
  };

// configSlice.ts: Conditional reset (only partner switch, NOT logout)
export const createConfigSlice: StateCreator<StoreState, [], [], ConfigSlice> = 
  (emitter: StoreEventEmitter) => (set, get) => {
    emitter.on('auth:partner-switch', () => {
      // Only reset config if partner changed (not on logout)
      // Because logout already clears appConfig, but partner switch needs to
      // reload partner-specific config (labels, business hours, etc.)
      set({ appConfig: null, businessHoursStatus: null, allLabels: [] });
    });

    emitter.on('auth:logout', () => {
      // Logout also clears config (belt-and-suspenders)
      set({ appConfig: null, businessHoursStatus: null, allLabels: [] });
    });

    return {
      appConfig: null,
      // ... rest of slice ...
    };
  };

// messageSlice.ts: Event filtering by type
export const createMessageSlice: StateCreator<StoreState, [], [], MessageSlice> = 
  (emitter: StoreEventEmitter) => (set, get) => {
    emitter.on('auth:logout', () => {
      set({ messages: {}, messageCursors: {}, onlineSupportUsers: [], onlineAgentIds: [], typingUsers: {} });
    });

    emitter.on('auth:partner-switch', () => {
      set({ messages: {}, messageCursors: {}, onlineSupportUsers: [], onlineAgentIds: [], typingUsers: {} });
    });

    // Does NOT subscribe to role-change; message history is role-agnostic.

    return {
      messages: {},
      // ... rest of slice ...
    };
  };
```

**Key Points**:
- Slice declares its own reset logic, in the same module that owns the data
- Multiple slices can listen to the same event (independent)
- Slices can filter events (e.g., `configSlice` reacts to `partner-switch` but NOT `role-change`)
- No central reset function; each slice is responsible for itself

---

## Usage Examples

### Example 1: Logout in a Component

```typescript
// components/UserMenu.tsx
export function UserMenu() {
  const { user, logout } = useStore(s => ({ user: s.user, logout: s.logout }));

  const handleLogout = async () => {
    try {
      await logout();
      // After logout() returns:
      // - authSlice has cleared user + emitted 'auth:logout'
      // - ticketSlice has cleared tickets (via listener)
      // - messageSlice has cleared messages (via listener)
      // - configSlice has cleared appConfig (via listener)
      // All SYNCHRONOUSLY, before logout() returns.
    } catch (err) {
      console.error('Logout failed:', err);
    }
  };

  return (
    <button onClick={handleLogout}>
      Logout {user?.email}
    </button>
  );
}
```

### Example 2: Partner Switch (Only Reset Partner-Scoped Data)

```typescript
// authSlice.ts
setActiveMembershipId: (id) => {
  const oldPartnerId = get().activePartnerId;
  const newPartnerId = /* derive from id */;

  sessionStorage.setItem('activeMembershipId', id);
  set({ activeMembershipId: id, activePartnerId: newPartnerId });

  emitter.emit({
    type: 'auth:partner-switch',
    from: oldPartnerId,
    to: newPartnerId,
    userId: get().user?.id || 'unknown',
  });
};

// Components using useStore continue to work: selectors are unchanged
const { tickets } = useStore(s => ({ tickets: s.tickets }));
// After partner switch, tickets are empty (cleared by listener).
// Component re-renders with empty list.
```

### Example 3: Late-Binding Subscription (Tests)

```typescript
// __tests__/store.test.ts
import { storeEventEmitter } from '../store/useStore';
import useStore from '../store/useStore';

describe('Store reset on logout', () => {
  afterEach(() => {
    // Clear all listeners & emitter state
    storeEventEmitter.clear();
  });

  it('should reset ticket slice on auth:logout', () => {
    const store = useStore;
    
    // Add a ticket
    store.getState().addTicket({ id: '1', title: 'Test', /* ... */ });
    expect(store.getState().tickets).toHaveLength(1);

    // Listen to the event (late binding, AFTER store creation)
    let logoutEventFired = false;
    const unsub = storeEventEmitter.on('auth:logout', () => {
      logoutEventFired = true;
    });

    // Logout
    store.getState().logout();

    // Verify ticket was cleared
    expect(store.getState().tickets).toHaveLength(0);
    expect(logoutEventFired).toBe(true);
    unsub();
  });

  it('should NOT clear rating on partner switch', () => {
    // Rating slice should NOT reset on partner switch (it's user-scoped, not partner-scoped)
    // Verify that configSlice does reset, but ratingSlice does not.
  });
});
```

**Why late-binding matters**:
- Tests can subscribe to events to verify they fired (observability)
- New features can add listeners without modifying existing slices
- Analytics/logging can hook into events without touching business logic

---

## Hidden Complexity & Mitigations

### 1. Race Conditions: Event Emission During Set

**Problem**: What if a listener tries to read stale state?

```typescript
set({ user: null });
emitter.emit({ type: 'auth:logout', ... });

// Inside ticketSlice listener:
emitter.on('auth:logout', () => {
  const { user, tickets } = get();  // ← user is null (fresh), good!
  set({ tickets: [] });
});
```

**Solution**: Listeners are invoked AFTER the `set()` call completes, so `get()` sees the new state. This is synchronous but ordered: set → emit → listener → read.

**Testing**:
```typescript
it('listeners see fresh state after emit', () => {
  const store = useStore;
  let readUserInListener: User | null = 'STALE';

  storeEventEmitter.on('auth:logout', () => {
    readUserInListener = store.getState().user;
  });

  store.getState().logout();
  expect(readUserInListener).toBeNull(); // ✓ Fresh state
});
```

---

### 2. Memory Leaks: Unsubscription

**Problem**: If a listener is never unsubscribed, it holds a reference forever.

```typescript
// In a slice creation:
emitter.on('auth:logout', () => { /* ... */ });
// No unsubscribe saved. Listener persists for the app lifetime. ✓ OK (store lives forever).

// In a component:
useEffect(() => {
  const unsub = storeEventEmitter.on('auth:logout', () => { /* ... */ });
  return unsub;  // ✓ Cleanup in return
}, []);
```

**Mitigation**:
- Slice listeners (in `createXxxSlice`) don't unsubscribe (store lives forever)
- Component/hook listeners MUST unsubscribe in `useEffect` cleanup
- Tests MUST call `emitter.clear()` in `afterEach()` to reset

**Lint Rule** (optional but recommended):
```typescript
// eslint-plugin-react-hooks would catch this:
useEffect(() => {
  storeEventEmitter.on('auth:logout', () => { /* ... */ });
  // ❌ Missing return: ESLint warning
}, []);
```

---

### 3. Listener Ordering: Dependency Between Slices

**Problem**: What if `configSlice` needs to read ticket state before resetting?

```typescript
emitter.on('auth:partner-switch', () => {
  const { tickets } = get();  // ← tickets still have old partner's data!
  // configSlice wants to reset appConfig based on ticket count?
});
```

**Solution**: Rely on listener **registration order**. Zustand slices are composed in order:
```typescript
create<StoreState>((...a) => ({
  ...createAuthSlice(emitter)(...a),       // (1) Auth emits events
  ...createTicketSlice(emitter)(...a),     // (2) Ticket listens, resets
  ...createMessageSlice(emitter)(...a),    // (3) Message listens, resets
  ...createConfigSlice(emitter)(...a),     // (4) Config listens, resets
  ...createUISlice(emitter)(...a),
  ...createRatingSlice(emitter)(...a),
}));

// Listeners are invoked in registration order: ticket, message, config, ui, rating.
// If configSlice needs fresh ticket data, register it AFTER ticketSlice.
```

**If truly sequential**: Use a two-phase emit pattern:

```typescript
export type StoreEvent = 
  | { type: 'auth:logout'; phase: 'pre' | 'post'; ... }

// In authSlice:
emitter.emit({ type: 'auth:logout', phase: 'pre', ... });  // Slices prepare
set({ user: null, ... });
emitter.emit({ type: 'auth:logout', phase: 'post', ... }); // Slices finalize

// In configSlice:
emitter.on('auth:logout', (e) => {
  if (e.phase === 'post') {
    const { tickets } = get();  // ← Now fresh and reset by ticketSlice
    set({ appConfig: null, ... });
  }
});
```

But this is **rarely needed**. Most resets are independent.

---

### 4. Listener Errors: One Listener's Exception Halts the Chain

**Problem**: 
```typescript
emitter.on('auth:logout', () => {
  throw new Error('oops');  // ← Stops subsequent listeners
});
```

**Solution**: Wrap listener invocation in try-catch, log errors, continue:

```typescript
// In StoreEventEmitter.emit():
emit<T extends StoreEvent>(event: T): void {
  const subs = this.listeners.get(event.type);
  if (!subs) return;
  for (const fn of subs) {
    try {
      fn(event as any);
    } catch (err) {
      console.error(`Listener error for event ${event.type}:`, err);
      // Continue to next listener
    }
  }
}
```

**Testing**:
```typescript
it('listener error does not halt other listeners', () => {
  let secondListenerFired = false;

  storeEventEmitter.on('auth:logout', () => {
    throw new Error('first listener fails');
  });
  storeEventEmitter.on('auth:logout', () => {
    secondListenerFired = true;  // Should still run
  });

  store.getState().logout();
  expect(secondListenerFired).toBe(true);
  // Check console for error log
});
```

---

## Dependency Strategy: How Are Listeners Registered?

### Option A: Automatic (Slice-Internal)
Listeners registered inside `createXxxSlice()`. Zero configuration.
```typescript
export const createTicketSlice = (emitter) => (set, get) => {
  emitter.on('auth:logout', () => set({ tickets: [] }));
  return { /* slice */ };
};
```
**Pros**: Self-contained, zero external wiring  
**Cons**: Listeners always run; can't dynamically disable

### Option B: Registry (Centralized List)
Register listeners in a separate module:
```typescript
// store/listeners.ts
export function registerAllListeners(emitter: StoreEventEmitter, store: typeof useStore) {
  emitter.on('auth:logout', () => {
    store.setState({ tickets: [] });
  });
  emitter.on('auth:logout', () => {
    store.setState({ messages: {} });
  });
}

// store/useStore.ts
const useStore = create<StoreState>((...) => ({ /* ... */ }));
registerAllListeners(eventEmitter, useStore);
```
**Pros**: All resets visible in one place; can disable via feature flags  
**Cons**: Extra module, more boilerplate

### Recommendation: **Option A (Automatic)**
- Simpler, more maintainable
- Each slice owns its reset logic (SOLID: Single Responsibility)
- If you need dynamic disable later, Option B is an easy migration

---

## Trade-Offs vs. Registry Pattern

### Registry Pattern (Centralized)
```typescript
// Hypothetical alternative
const resetRegistry: Record<StoreEvent['type'], (() => void)[]> = {
  'auth:logout': [
    () => set({ tickets: [] }),
    () => set({ messages: {} }),
    () => set({ appConfig: null }),
  ],
};

authSlice.logout = async () => {
  clearAuthState();
  for (const reset of resetRegistry['auth:logout']) reset();
};
```

**Pros**:
- All resets visible in one place
- Easy to add/remove/conditional resets via runtime flags
- Explicit dependencies (if you document them)

**Cons**:
- Central module becomes a god module (every slice must register here)
- Tight coupling: authSlice depends on resetRegistry
- Hard to track which slice owns which reset (scattered across two files)
- Test setup is more complex (must import & register before using store)

### Pub/Sub Pattern (Proposed)
**Pros**:
- Each slice self-registers, owns its reset
- authSlice only knows about auth, not other slices
- New slice can add listener without touching auth code
- Late-binding: tests can add listeners dynamically
- Natural for cascading resets (listener A triggers event → listener B reacts)

**Cons**:
- Implicit dependencies (you must read each slice to know it listens)
- Harder to visualize the reset graph (requires code reading)
- Listener ordering matters (but typically doesn't)

**Winner**: Pub/Sub wins for maximum flexibility. If you need visibility, a single documentation table suffices:

```markdown
## Store Reset Events & Listeners

| Event | Emitted By | Listeners |
|-------|-----------|-----------|
| `auth:logout` | authSlice.logout() | ticketSlice, messageSlice, configSlice, uiSlice, ratingSlice |
| `auth:partner-switch` | authSlice.setActiveMembershipId() | ticketSlice, messageSlice, configSlice |
| `auth:role-change` | authSlice (via syncUserRole) | *(no listeners yet)* |
```

---

## Implementation Checklist

- [ ] Create `store/eventEmitter.ts` with `StoreEventEmitter` class
- [ ] Update `store/types/index.ts` to export `StoreEvent` union & `Unsubscribe` type
- [ ] Refactor `createAuthSlice()` to accept `emitter` and call `emitter.emit()` instead of mutating other slices
- [ ] Refactor `createTicketSlice()` to accept `emitter` and subscribe to `auth:logout` + `auth:partner-switch`
- [ ] Refactor `createMessageSlice()` to subscribe to `auth:logout` + `auth:partner-switch`
- [ ] Refactor `createConfigSlice()` to subscribe to `auth:logout` + `auth:partner-switch` (conditional logic)
- [ ] Refactor `createUISlice()` to subscribe to `auth:logout` (if needed)
- [ ] Refactor `createRatingSlice()` to subscribe to `auth:logout` (if needed)
- [ ] Update `store/useStore.ts` to wire emitter into all slices
- [ ] Export `storeEventEmitter` for tests
- [ ] Add tests for each slice's reset behavior (late-binding subscribers)
- [ ] Add test for listener error isolation
- [ ] Add test for listener ordering / race conditions
- [ ] Document reset event table (above)
- [ ] Update component examples (if any rely on direct `clearAuthState()`)

---

## Code Artifacts

### File: `store/eventEmitter.ts`
```typescript
export type StoreEvent = 
  | { type: 'auth:logout'; reason: 'user' | 'session-expired'; userId: string }
  | { type: 'auth:partner-switch'; from: string; to: string; userId: string }
  | { type: 'auth:role-change'; newRole: User['role'] }
  | { type: 'config:reload-required' };

export type Unsubscribe = () => void;

export interface StoreEventEmitterInterface {
  emit<T extends StoreEvent>(event: T): void;
  on<T extends StoreEvent>(type: T['type'], listener: (event: T) => void): Unsubscribe;
  once<T extends StoreEvent>(type: T['type'], listener: (event: T) => void): void;
  clear(): void;
}

export class StoreEventEmitter implements StoreEventEmitterInterface {
  private listeners: Map<StoreEvent['type'], Set<(e: StoreEvent) => void>> = new Map();

  emit<T extends StoreEvent>(event: T): void {
    const subs = this.listeners.get(event.type);
    if (!subs) return;
    for (const fn of subs) {
      try {
        fn(event as any);
      } catch (err) {
        console.error(`Listener error for event ${event.type}:`, err);
      }
    }
  }

  on<T extends StoreEvent>(
    type: T['type'],
    listener: (event: T) => void,
  ): Unsubscribe {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    const subs = this.listeners.get(type)!;
    subs.add(listener as any);
    return () => subs.delete(listener as any);
  }

  once<T extends StoreEvent>(
    type: T['type'],
    listener: (event: T) => void,
  ): void {
    const unsub = this.on(type, (e) => {
      unsub();
      listener(e as T);
    });
  }

  clear(): void {
    this.listeners.clear();
  }
}
```

### File: `store/useStore.ts` (Updated)
```typescript
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { StoreState } from '../types';
import { StoreEventEmitter } from './eventEmitter';
import { createAuthSlice } from './slices/authSlice';
import { createTicketSlice } from './slices/ticketSlice';
import { createMessageSlice } from './slices/messageSlice';
import { createUISlice } from './slices/uiSlice';
import { createConfigSlice } from './slices/configSlice';
import { createRatingSlice } from './slices/ratingSlice';

const eventEmitter = new StoreEventEmitter();

const useStore = create<StoreState>((...a) => ({
  ...createAuthSlice(eventEmitter)(...a),
  ...createTicketSlice(eventEmitter)(...a),
  ...createMessageSlice(eventEmitter)(...a),
  ...createUISlice(eventEmitter)(...a),
  ...createConfigSlice(eventEmitter)(...a),
  ...createRatingSlice(eventEmitter)(...a),
}));

export function useStoreShallow<T>(selector: (state: StoreState) => T): T {
  return useStore(useShallow(selector));
}

// Export for tests & late-binding subscriptions
export { eventEmitter as storeEventEmitter };
export default useStore;
```

### File: `store/slices/authSlice.ts` (Updated)
```typescript
import { StateCreator } from 'zustand';
import { StoreState, User, Membership } from '../../types';
import { StoreEventEmitter } from '../eventEmitter';
import { disconnectSocket } from '../../hooks/useSocket';

export interface AuthSlice {
  user: User | null;
  memberships: Membership[];
  activeMembershipId: string | null;
  activePartnerId: string | null;
  setUser: (user: User | null) => void;
  setMemberships: (memberships: Membership[]) => void;
  setActiveMembershipId: (id: string | null) => void;
  logout: () => Promise<void>;
}

export const createAuthSlice: (emitter: StoreEventEmitter) => StateCreator<StoreState, [], [], AuthSlice> = 
  (emitter) => (set, get) => {
    const isExpired = /* ... */;
    const initialUser = /* ... */;

    return {
      user: initialUser,
      memberships: [],
      activeMembershipId: null,
      activePartnerId: null,

      setUser: (user) => {
        set({ user });
        // No emit; setUser is not a reset event
      },

      setActiveMembershipId: (id) => {
        const oldPartnerId = get().activePartnerId;
        const membership = get().memberships.find(m => m.id === id);
        const newPartnerId = membership?.partnerId || id;

        if (id) {
          sessionStorage.setItem('activeMembershipId', id);
          sessionStorage.setItem('activePartnerId', newPartnerId);
          set({ activeMembershipId: id, activePartnerId: newPartnerId });
        } else {
          sessionStorage.removeItem('activeMembershipId');
          sessionStorage.removeItem('activePartnerId');
          set({ activeMembershipId: null, activePartnerId: null });
        }

        // Emit event; other slices will reset themselves
        if (oldPartnerId && newPartnerId && oldPartnerId !== newPartnerId) {
          emitter.emit({
            type: 'auth:partner-switch',
            from: oldPartnerId,
            to: newPartnerId,
            userId: get().user?.id || 'unknown',
          });
        }
      },

      logout: async () => {
        const userId = get().user?.id || 'unknown';
        try {
          await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include' });
        } catch {}

        if ('caches' in window) {
          caches.keys().then(keys => keys.forEach(k => caches.delete(k))).catch(() => {});
        }

        disconnectSocket();

        sessionStorage.removeItem('user');
        sessionStorage.removeItem('memberships');
        sessionStorage.removeItem('activeMembershipId');
        sessionStorage.removeItem('activePartnerId');

        // Clear auth state, then emit
        set({
          user: null,
          memberships: [],
          activeMembershipId: null,
          activePartnerId: null,
        });

        // Now other slices listen & reset themselves
        emitter.emit({
          type: 'auth:logout',
          reason: 'user',
          userId,
        });
      },
    };
  };
```

### File: `store/slices/ticketSlice.ts` (Updated)
```typescript
import { StateCreator } from 'zustand';
import { StoreState, Ticket } from '../../types';
import { StoreEventEmitter } from '../eventEmitter';

export interface TicketSlice {
  tickets: Ticket[];
  activeTicketId: string | null;
  // ... other fields ...
}

export const createTicketSlice: (emitter: StoreEventEmitter) => StateCreator<StoreState, [], [], TicketSlice> = 
  (emitter) => (set, get) => {
    // Listen to auth events
    emitter.on('auth:logout', () => {
      set({
        tickets: [],
        activeTicketId: null,
        unreadTickets: {},
        unreadSenders: {},
        participantsOnline: {},
        supportOpenTickets: [],
        queuePosition: null,
        topicAlerts: [],
      });
    });

    emitter.on('auth:partner-switch', () => {
      set({
        tickets: [],
        activeTicketId: null,
        unreadTickets: {},
        unreadSenders: {},
        participantsOnline: {},
        supportOpenTickets: [],
        queuePosition: null,
        topicAlerts: [],
      });
    });

    return {
      tickets: [],
      activeTicketId: null,
      // ... rest of slice ...
    };
  };
```

---

## Summary

This pub/sub pattern achieves **maximum flexibility** by:
1. **Decoupling**: Each slice owns its reset logic; authSlice doesn't hardcode it
2. **Extensibility**: New slices add listeners without modifying auth
3. **Testability**: Late-binding subscriptions let tests verify events fired
4. **Conditional Logic**: Slices can filter events (e.g., reset on logout but not role-change)
5. **Type Safety**: Union-discriminated `StoreEvent` prevents invalid event shapes

**Hidden Complexity Mitigated**:
- Synchronous ordering (set → emit → listener)
- Error isolation (listener exceptions don't halt others)
- Unsubscription cleanup (slices never unsubscribe; components use `useEffect` cleanup)
- Listener registration order as a lightweight dependency mechanism

No registry needed; zero globals; backward-compatible with existing selectors.
