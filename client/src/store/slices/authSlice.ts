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
  logout: () => void;
}

export const createAuthSlice: StateCreator<StoreState, [], [], AuthSlice> = (set, get) => ({
  user: JSON.parse(localStorage.getItem('user') || 'null'),
  memberships: JSON.parse(localStorage.getItem('memberships') || '[]'),
  activeMembershipId: localStorage.getItem('activeMembershipId') || null,
  activePartnerId: localStorage.getItem('activePartnerId') || null,
  token: localStorage.getItem('token') || null,

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
    else localStorage.removeItem('activeMembershipId');
    
    const membership = get().memberships.find(m => m.id === id);
    if (membership) {
      localStorage.setItem('activePartnerId', membership.partnerId);
      set({ activeMembershipId: id, activePartnerId: membership.partnerId });
    } else {
      set({ activeMembershipId: id });
    }
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
});
