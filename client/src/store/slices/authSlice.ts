import { StateCreator } from 'zustand';
import { StoreState, User, Membership } from '../../types';

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

export const createAuthSlice: StateCreator<StoreState, [], [], AuthSlice> = (set, get) => {
  const expired = isSessionExpired();

  // If session cookie is expired, clear everything
  if (expired) {
    sessionStorage.removeItem('user');
    sessionStorage.removeItem('memberships');
    sessionStorage.removeItem('activeMembershipId');
    sessionStorage.removeItem('activePartnerId');
  }

  return {
    user: expired ? null : safeJsonParse('user', null),
    memberships: expired ? [] : safeJsonParse('memberships', []),
    activeMembershipId: expired ? null : sessionStorage.getItem('activeMembershipId') || null,
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
    },
    setMemberships: (memberships) => {
      if (memberships) sessionStorage.setItem('memberships', JSON.stringify(memberships));
      else sessionStorage.removeItem('memberships');
      set({ memberships });
    },
    setActiveMembershipId: (id) => {
      if (id) sessionStorage.setItem('activeMembershipId', id);
      else {
        sessionStorage.removeItem('activeMembershipId');
        sessionStorage.removeItem('activePartnerId');
        set({ activeMembershipId: null, activePartnerId: null });
        return;
      }

      const membership = get().memberships.find(m => m.id === id);
      if (membership) {
        sessionStorage.setItem('activePartnerId', membership.partnerId);
        set({ activeMembershipId: id, activePartnerId: membership.partnerId });
      } else {
        // If no membership found, assume the ID itself is the partnerId (Platform Operator scenario)
        sessionStorage.setItem('activePartnerId', id);
        set({ activeMembershipId: id, activePartnerId: id });
      }
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
      await res.json();
      const userId = get().user?.id;
      const syntheticMembershipId = `platform_${userId}_${partnerId}`;
      sessionStorage.setItem('activeMembershipId', syntheticMembershipId);
      sessionStorage.setItem('activePartnerId', partnerId);
      set({ activeMembershipId: syntheticMembershipId, activePartnerId: partnerId });
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

      clearAuthState(set);
    },
  };
};
