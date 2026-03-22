import { StateCreator } from 'zustand';
import { StoreState, User, Membership } from '../../types';

export interface AuthSlice {
  user: User | null;
  memberships: Membership[];
  activeMembershipId: string | null;
  activePartnerId: string | null;
  token: string | null;
  setUser: (user: User | null) => void;
  setToken: (token: string | null) => void;
  setMemberships: (memberships: Membership[]) => void;
  setActiveMembershipId: (id: string | null) => void;
  enterPartnerAsOperator: (partnerId: string) => Promise<void>;
  logout: () => void;
}

function safeJsonParse(key: string, fallback: any) {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : fallback;
  } catch (e) {
    console.error(`Error parsing localStorage key "${key}":`, e);
    return fallback;
  }
}

function isTokenExpired(token: string | null): boolean {
  if (!token) return true;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    // exp is in seconds, Date.now() is in ms
    return payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
}

export const createAuthSlice: StateCreator<StoreState, [], [], AuthSlice> = (set, get) => {
  const storedToken = localStorage.getItem('token');
  const expired = isTokenExpired(storedToken);

  // If token is expired, clear everything
  if (expired && storedToken) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('memberships');
    localStorage.removeItem('activeMembershipId');
    localStorage.removeItem('activePartnerId');
  }

  return {
    user: expired ? null : safeJsonParse('user', null),
    memberships: expired ? [] : safeJsonParse('memberships', []),
    activeMembershipId: expired ? null : localStorage.getItem('activeMembershipId') || null,
    activePartnerId: expired ? null : localStorage.getItem('activePartnerId') || null,
    token: expired ? null : storedToken,

    setUser: (user) => {
      if (user) localStorage.setItem('user', JSON.stringify(user));
      else localStorage.removeItem('user');
      set({ user });
    },
    setToken: (token) => {
      if (token) localStorage.setItem('token', token);
      else localStorage.removeItem('token');
      set({ token });
    },
    setMemberships: (memberships) => {
      if (memberships) localStorage.setItem('memberships', JSON.stringify(memberships));
      else localStorage.removeItem('memberships');
      set({ memberships });
    },
    setActiveMembershipId: (id) => {
      if (id) localStorage.setItem('activeMembershipId', id);
      else {
        localStorage.removeItem('activeMembershipId');
        localStorage.removeItem('activePartnerId');
        set({ activeMembershipId: null, activePartnerId: null });
        return;
      }
      
      const membership = get().memberships.find(m => m.id === id);
      if (membership) {
        localStorage.setItem('activePartnerId', membership.partnerId);
        set({ activeMembershipId: id, activePartnerId: membership.partnerId });
      } else {
        // If no membership found, assume the ID itself is the partnerId (Platform Operator scenario)
        localStorage.setItem('activePartnerId', id);
        set({ activeMembershipId: id, activePartnerId: id });
      }
    },
    enterPartnerAsOperator: async (partnerId: string) => {
      const token = get().token;
      const res = await fetch('/api/v1/auth/enter-partner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ partnerId })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to enter partner');
      }
      const data = await res.json();
      const userId = get().user?.id;
      const syntheticMembershipId = `platform_${userId}_${partnerId}`;
      get().setToken(data.token);
      localStorage.setItem('activeMembershipId', syntheticMembershipId);
      localStorage.setItem('activePartnerId', partnerId);
      set({ activeMembershipId: syntheticMembershipId, activePartnerId: partnerId });
    },
    logout: () => {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      localStorage.removeItem('memberships');
      localStorage.removeItem('activeMembershipId');
      localStorage.removeItem('activePartnerId');
      set({ 
        user: null, 
        token: null, 
        memberships: [], 
        activeMembershipId: null, 
        activePartnerId: null, 
        tickets: [], 
        messages: {}, 
        activeTicketId: null 
      });
    },
  };
};
