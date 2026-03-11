import { create } from 'zustand';
import { StoreState, User, Ticket, Message, Label, AppConfig } from '../types';

const savedDark = localStorage.getItem('darkMode') === 'true';

const useStore = create<StoreState>((set) => ({
  user: null,
  token: localStorage.getItem('token') || null,
  appConfig: null,
  dyslexicMode: localStorage.getItem('dyslexicMode') === 'true',
  bionicReading: localStorage.getItem('bionicReading') === 'true',
  selectedLang: localStorage.getItem('selectedLang') || null,

  cannedResponses: [],
  setCannedResponses: (responses) => set({ cannedResponses: responses }),

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
    set({ user: null, token: null, tickets: [], messages: {}, activeTicketId: null });
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
        const optimisticIndex = existing.findIndex(m => m.pending && m.text === message.text && m.sender_id === message.sender_id);
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
      const current = { ...(state.typingUsers[ticketId] || {}) };
      if (isTyping) current[name] = true;
      else delete current[name];
      return { typingUsers: { ...state.typingUsers, [ticketId]: current } };
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

  unreadTickets: new Set<string>(),
  markUnread: (ticketId) =>
    set((state) => {
      const next = new Set(state.unreadTickets);
      next.add(ticketId);
      return { unreadTickets: next };
    }),
  clearUnread: (ticketId) =>
    set((state) => {
      if (!state.unreadTickets.has(ticketId)) return state;
      const next = new Set(state.unreadTickets);
      next.delete(ticketId);
      return { unreadTickets: next };
    }),

  agentOnline: {},
  setAgentOnline: (ticketId, online) =>
    set((state) => ({ agentOnline: { ...state.agentOnline, [ticketId]: online } })),

  businessHoursOpen: true,
  setBusinessHoursOpen: (open) => set({ businessHoursOpen: open }),

  darkMode: savedDark,
  toggleDarkMode: () =>
    set((state) => {
      const next = !state.darkMode;
      localStorage.setItem('darkMode', String(next));
      return { darkMode: next };
    }),

  toggleDyslexicMode: () =>
    set((state) => {
      const next = !state.dyslexicMode;
      localStorage.setItem('dyslexicMode', String(next));
      return { dyslexicMode: next };
    }),

  toggleBionicReading: () =>
    set((state) => {
      const next = !state.bionicReading;
      localStorage.setItem('bionicReading', String(next));
      return { bionicReading: next };
    }),

  setSelectedLang: (lang) => {
    localStorage.setItem('selectedLang', lang);
    set({ selectedLang: lang });
  },

  connectionStatus: 'connected',
  setConnectionStatus: (status) => set({ connectionStatus: status }),

  allLabels: [],
  setAllLabels: (labels: Label[]) => set({ allLabels: labels }),

  removeLabelGlobally: (labelId) =>
    set((state) => ({
      allLabels: (state.allLabels || []).filter((l) => l.id !== labelId),
      tickets: state.tickets.map((t) => ({
        ...t,
        labels: (t.labels || []).filter((id) => id !== labelId),
      })),
    })),
  
  queuePosition: null,
  setQueuePosition: (pos) => set({ queuePosition: pos }),
}));

export default useStore;
