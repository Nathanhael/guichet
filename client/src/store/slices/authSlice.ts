import { StateCreator } from 'zustand';
import { StoreState, User, Membership } from '../../types';
import { disconnectSocket } from '../../hooks/useSocket';

export interface AuthSlice {
  user: User | null;
  memberships: Membership[];
  activeMembershipId: string | null;
  activePartnerId: string | null;
  setUser: (user: User | null) => void;
  setMemberships: (memberships: Membership[]) => void;
  setActiveMembershipId: (id: string | null) => void;
  enterPartnerAsOperator: (partnerId: string) => Promise<void>;
  logout: () => Promise<void>;
}

function clearAuthState(set: (partial: Partial<StoreState>) => void) {
  sessionStorage.removeItem('user');
  sessionStorage.removeItem('memberships');
  sessionStorage.removeItem('activeMembershipId');
  sessionStorage.removeItem('activePartnerId');
  set({
    user: null,
    memberships: [],
    activeMembershipId: null,
    activePartnerId: null,
    tickets: [],
    messages: {},
    activeTicketId: null
  });
}

function safeJsonParse<T>(key: string, fallback: T): T {
  try {
    const item = sessionStorage.getItem(key);
    return item ? (JSON.parse(item) as T) : fallback;
  } catch (e) {
    console.error(`Error parsing sessionStorage key "${key}":`, e);
    return fallback;
  }
}

/** Check if the session is expired using the companion session_expires cookie */
function isSessionExpired(): boolean {
  try {
    const match = document.cookie.match(/(?:^|;\s*)session_expires=(\d+)/);
    if (!match) return true;
    const expiresAt = parseInt(match[1], 10);
    return expiresAt * 1000 < Date.now();
  } catch {
    return true;
  }
}

/**
 * Derive user.role from the active membership. The server /login and
 * /session endpoints return user without a top-level role field (role lives
 * only on memberships[]), so checks like `user.role === 'support'` would be
 * permanently undefined unless we hydrate it client-side. Called from every
 * setUser / setMemberships / setActiveMembershipId mutation so non-React
 * callers (socket handlers via useStore.getState()) get a materialized
 * user.role they can read synchronously.
 */
function syncUserRole(
  set: (partial: Partial<StoreState>) => void,
  get: () => StoreState,
): void {
  const { user, memberships, activeMembershipId } = get();
  if (!user) return;
  const active = memberships.find((m) => m.id === activeMembershipId);
  const nextRole = (active?.role ?? (user.isPlatformOperator ? 'platform_operator' : user.role)) as User['role'];
  if (nextRole && nextRole !== user.role) {
    const updated = { ...user, role: nextRole };
    sessionStorage.setItem('user', JSON.stringify(updated));
    set({ user: updated });
  }
}

export const createAuthSlice: StateCreator<StoreState, [], [], AuthSlice> = (set, get) => {
  const expired = isSessionExpired();

  // If session cookie is expired, clear everything
  if (expired) {
    sessionStorage.removeItem('user');
    sessionStorage.removeItem('memberships');
    sessionStorage.removeItem('activeMembershipId');
    sessionStorage.removeItem('activePartnerId');
  }

  // Hydrate initial user + derive role from active membership (same logic as
  // syncUserRole, but applied before the slice is created so we don't need a
  // post-mount side effect for page reloads).
  const initialUser = expired ? null : safeJsonParse<User | null>('user', null);
  const initialMemberships = expired ? [] : safeJsonParse<Membership[]>('memberships', []);
  const initialActiveMembershipId = expired ? null : sessionStorage.getItem('activeMembershipId') || null;
  if (initialUser && !initialUser.role) {
    const active = initialMemberships.find((m) => m.id === initialActiveMembershipId);
    const hydratedRole = active?.role ?? (initialUser.isPlatformOperator ? 'platform_operator' : undefined);
    if (hydratedRole) {
      initialUser.role = hydratedRole as User['role'];
      sessionStorage.setItem('user', JSON.stringify(initialUser));
    }
  }

  return {
    user: initialUser,
    memberships: initialMemberships,
    activeMembershipId: initialActiveMembershipId,
    activePartnerId: expired ? null : sessionStorage.getItem('activePartnerId') || null,

    setUser: (user) => {
      if (user) {
        sessionStorage.setItem('user', JSON.stringify(user));
        if (user.accessibilityPrefs) {
          get().hydrateAccessibilityPrefs(user.accessibilityPrefs);
        }
      } else {
        sessionStorage.removeItem('user');
      }
      set({ user });
      syncUserRole(set, get);
    },
    setMemberships: (memberships) => {
      if (memberships) sessionStorage.setItem('memberships', JSON.stringify(memberships));
      else sessionStorage.removeItem('memberships');
      set({ memberships });
      syncUserRole(set, get);
    },
    setActiveMembershipId: (id) => {
      // Partner-scoped in-memory state bleeds across tenants if not reset. The
      // hydration effect in SupportView rebuilds supportOpenTickets from the
      // new partner's localStorage, but between now and that effect firing,
      // the old partner's ticket IDs would be re-emitted as support:rejoin to
      // the new partner's socket rooms. Reset the obviously partner-scoped
      // slices here; fresh data arrives via socket:identify + ticket.list.
      const partnerResetSlice: Partial<StoreState> = {
        supportOpenTickets: [],
        tickets: [],
        messages: {},
        activeTicketId: null,
        unreadTickets: {},
      };

      if (id) {
        sessionStorage.setItem('activeMembershipId', id);
      } else {
        sessionStorage.removeItem('activeMembershipId');
        sessionStorage.removeItem('activePartnerId');
        // Clean up synthetic memberships when returning to platform cockpit
        const filtered = get().memberships.filter(m => !m.id.startsWith('platform_'));
        sessionStorage.setItem('memberships', JSON.stringify(filtered));
        set({ ...partnerResetSlice, activeMembershipId: null, activePartnerId: null, memberships: filtered });
        syncUserRole(set, get);
        return;
      }

      const membership = get().memberships.find(m => m.id === id);
      if (membership) {
        sessionStorage.setItem('activePartnerId', membership.partnerId);
        set({ ...partnerResetSlice, activeMembershipId: id, activePartnerId: membership.partnerId });
      } else {
        // If no membership found, assume the ID itself is the partnerId (Platform Operator scenario)
        sessionStorage.setItem('activePartnerId', id);
        set({ ...partnerResetSlice, activeMembershipId: id, activePartnerId: id });
      }
      syncUserRole(set, get);
    },
    enterPartnerAsOperator: async (partnerId: string) => {
      const res = await fetch('/api/v1/auth/enter-partner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ partnerId })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to enter partner');
      }
      const data = await res.json();
      const userId = get().user?.id;
      const syntheticMembershipId = `platform_${userId}_${partnerId}`;

      // Build a synthetic membership so usePartner can resolve the tenant name
      const syntheticMembership: Membership = {
        id: syntheticMembershipId,
        partnerId,
        partnerName: data.partnerName || partnerId,
        role: 'admin',
        departments: [],
        manifest: data.manifest || { industry: 'general', departments: [] },
      };

      const existing = get().memberships.filter(m => !m.id.startsWith('platform_'));
      const newMemberships = [...existing, syntheticMembership];
      
      sessionStorage.setItem('activeMembershipId', syntheticMembershipId);
      sessionStorage.setItem('activePartnerId', partnerId);
      sessionStorage.setItem('memberships', JSON.stringify(newMemberships));
      
      set({
        memberships: newMemberships,
        activeMembershipId: syntheticMembershipId,
        activePartnerId: partnerId,
      });
    },
    logout: async () => {
      try {
        await fetch('/api/v1/auth/logout', {
          method: 'POST',
          credentials: 'include',
        });
      } catch {
        // Local logout should still succeed even if the network call fails.
      }

      // Clear service worker cache to prevent stale authenticated data on shared devices
      if ('caches' in window) {
        caches.keys().then((keys) => keys.forEach((key) => caches.delete(key))).catch(() => {});
      }

      // Tear down the socket so the next login starts from a clean slate
      // instead of reusing a module-singleton socket whose handshake may be
      // stuck in CONNECT_ERROR retry.
      disconnectSocket();

      clearAuthState(set);
    },
  };
};
