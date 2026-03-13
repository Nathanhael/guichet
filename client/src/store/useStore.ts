import { create } from 'zustand';
import { StoreState, Label, Membership } from '../types';

const useStore = create<StoreState>((set) => ({
  user: null,
  memberships: [],
  activeMembershipId: localStorage.getItem('activeMembershipId') || null,
  activePartnerId: localStorage.getItem('activePartnerId') || null,
  token: localStorage.getItem('token') || null,
  appConfig: null,
  dyslexicMode: localStorage.getItem('dyslexicMode') === 'true',
  bionicReading: localStorage.getItem('bionicReading') === 'true',
  highContrastMode: localStorage.getItem('highContrastMode') === 'true',
  focusMode: localStorage.getItem('focusMode') === 'true',
  zenSettings: JSON.parse(localStorage.getItem('zenSettings') || '{"autoBionic":true,"notificationShield":true}'),
  selectedLang: localStorage.getItem('selectedLang') || null,

  cannedResponses: [],
  setCannedResponses: (responses) => set({ cannedResponses: responses }),

  setMemberships: (memberships) => set({ memberships }),
  setActiveMembershipId: (id) => {
    if (id) localStorage.setItem('activeMembershipId', id);
    else localStorage.removeItem('activeMembershipId');
    
    const membership = useStore.getState().memberships.find(m => m.id === id);
    if (membership) {
      localStorage.setItem('activePartnerId', membership.partnerId);
      set({ activeMembershipId: id, activePartnerId: membership.partnerId });
    } else {
      set({ activeMembershipId: id });
    }
  },

  updateMessageState: (ticketId, messageId, updates) => set((s) => {
    const msgs = s.messages[ticketId];
    if (!msgs) return s;
    return {
      messages: {
        ...s.messages,
        [ticketId]: msgs.map((m) => m.id === messageId ? { ...m, ...updates } : m)
      }
    };
  }),

  notificationsEnabled: localStorage.getItem('notificationsEnabled') !== 'false',
  setNotificationsEnabled: (enabled) => {
    localStorage.setItem('notificationsEnabled', String(enabled));
    set({ notificationsEnabled: enabled });
  },

  setAppConfig: (config) => set({ appConfig: config }),
  setUser: (user) => set({ user }),
  setToken: (token) => {
    if (token) localStorage.setItem('token', token);
    else localStorage.removeItem('token');
    set({ token });
  },
  logout: () => {
    localStorage.removeItem('token');
    localStorage.removeItem('activeMembershipId');
    localStorage.removeItem('activePartnerId');
    set({ user: null, token: null, memberships: [], activeMembershipId: null, activePartnerId: null, tickets: [], messages: {}, activeTicketId: null });
  },

  tickets: [],
  setTickets: (tickets) => set({ tickets }),
  archivedTickets: [],
  setArchivedTickets: (archived) => set({ archivedTickets: archived }),
  addTicket: (ticket) =>
    set((state) => ({
      tickets: state.tickets.some((t) => t.id === ticket.id)
        ? state.tickets
        : [ticket, ...state.tickets],
    })),
  updateTicket: (ticketId, updates) =>
    set((state) => ({
      tickets: state.tickets.map((t) => (t.id === ticketId ? { ...t, ...updates } : t)),
    })),

  toggleTicketLabel: (ticketId, labelId) => {
    set((state) => {
      const ticket = state.tickets.find((t) => t.id === ticketId);
      if (!ticket) return state;

      const currentLabels = ticket.labels || [];
      const isAdding = !currentLabels.includes(labelId);
      const nextLabels = isAdding
        ? [...currentLabels, labelId]
        : currentLabels.filter((id) => id !== labelId);

      return {
        tickets: state.tickets.map((t) =>
          t.id === ticketId ? { ...t, labels: nextLabels } : t
        ),
      };
    });
  },

  messages: {},
  setMessages: (ticketId, messages) =>
    set((state) => ({ messages: { ...state.messages, [ticketId]: messages } })),
  addMessage: (ticketId, message) =>
    set((state) => {
      const existing = state.messages[ticketId] || [];
      if (!message.pending) {
        const optimisticIndex = existing.findIndex(m => m.pending && m.text === message.text && m.senderId === message.senderId);
        if (optimisticIndex !== -1) {
          const next = [...existing];
          next[optimisticIndex] = message;
          return { messages: { ...state.messages, [ticketId]: next } };
        }
      }
      if (existing.some((m) => m.id === message.id)) return state;
      return { messages: { ...state.messages, [ticketId]: [...existing, message] } };
    }),

  onlineExperts: [],
  setOnlineExperts: (list) => set({ onlineExperts: list }),

  typingUsers: {},
  setTyping: (ticketId, name, isTyping) =>
    set((state) => {
      const ticketTyping = { ...(state.typingUsers[ticketId] || {}) };
      if (isTyping) ticketTyping[name] = true;
      else delete ticketTyping[name];
      return { typingUsers: { ...state.typingUsers, [ticketId]: ticketTyping } };
    }),

  activeTicketId: null,
  setActiveTicketId: (id) => set({ activeTicketId: id }),

  expertOpenTickets: [],
  addExpertOpenTicket: (ticketId) =>
    set((state) => ({
      expertOpenTickets: state.expertOpenTickets.includes(ticketId)
        ? state.expertOpenTickets
        : [...state.expertOpenTickets, ticketId],
    })),
  removeExpertOpenTicket: (ticketId) =>
    set((state) => ({
      expertOpenTickets: state.expertOpenTickets.filter((id) => id !== ticketId),
    })),

  ratingPrompt: null,
  setRatingPrompt: (data) => set({ ratingPrompt: data }),
  clearRatingPrompt: () => set({ ratingPrompt: null }),

  updateMessageReaction: (ticketId, messageId, reactions) =>
    set((state) => {
      const msgs = state.messages[ticketId];
      if (!msgs) return state;
      return {
        messages: {
          ...state.messages,
          [ticketId]: msgs.map((m) => (m.id === messageId ? { ...m, reactions } : m)),
        },
      };
    }),

  unreadTickets: new Set(),
  markUnread: (ticketId) =>
    set((state) => {
      const next = new Set(state.unreadTickets);
      next.add(ticketId);
      return { unreadTickets: next };
    }),
  clearUnread: (ticketId) =>
    set((state) => {
      const next = new Set(state.unreadTickets);
      next.delete(ticketId);
      return { unreadTickets: next };
    }),

  agentOnline: {},
  setAgentOnline: (ticketId, online) =>
    set((state) => ({ agentOnline: { ...state.agentOnline, [ticketId]: online } })),

  businessHoursOpen: true,
  setBusinessHoursOpen: (open) => set({ businessHoursOpen: open }),

  darkMode: localStorage.getItem('darkMode') === 'true',
  toggleDarkMode: () =>
    set((state) => {
      const next = !state.darkMode;
      localStorage.setItem('darkMode', String(next));
      if (next) document.documentElement.classList.add('dark');
      else document.documentElement.classList.remove('dark');
      return { darkMode: next };
    }),

  toggleDyslexicMode: () =>
    set((state) => {
      const next = !state.dyslexicMode;
      localStorage.setItem('dyslexicMode', String(next));
      if (next) document.documentElement.classList.add('dyslexic-mode');
      else document.documentElement.classList.remove('dyslexic-mode');
      return { dyslexicMode: next };
    }),

  toggleBionicReading: () =>
    set((state) => {
      const next = !state.bionicReading;
      localStorage.setItem('bionicReading', String(next));
      return { bionicReading: next };
    }),

  toggleHighContrastMode: () =>
    set((state) => {
      const next = !state.highContrastMode;
      localStorage.setItem('highContrastMode', String(next));
      if (next) document.documentElement.classList.add('high-contrast-mode');
      else document.documentElement.classList.remove('high-contrast-mode');
      return { highContrastMode: next };
    }),

  toggleFocusMode: () =>
    set((state) => {
      const next = !state.focusMode;
      localStorage.setItem('focusMode', String(next));
      
      // Auto-bionic logic
      if (next && state.zenSettings.autoBionic && !state.bionicReading && state.dyslexicMode) {
        localStorage.setItem('bionicReading', 'true');
        return { focusMode: next, bionicReading: true };
      }
      
      return { focusMode: next };
    }),

  updateZenSettings: (updates) =>
    set((state) => {
      const next = { ...state.zenSettings, ...updates };
      localStorage.setItem('zenSettings', JSON.stringify(next));
      return { zenSettings: next };
    }),

  setSelectedLang: (lang) => {
    localStorage.setItem('selectedLang', lang);
    set({ selectedLang: lang });
  },

  connectionStatus: 'disconnected',
  setConnectionStatus: (status) => set({ connectionStatus: status }),

  allLabels: [],
  setAllLabels: (labels) => set({ allLabels: labels }),
  removeLabelGlobally: (labelId) =>
    set((state) => ({ allLabels: state.allLabels.filter((l) => l.id !== labelId) })),
  addLabelGlobally: (label) =>
    set((state) => ({ allLabels: [...state.allLabels, label] })),

  queuePosition: null,
  setQueuePosition: (pos) => set({ queuePosition: pos }),
}));

export default useStore;
