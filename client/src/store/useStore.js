import { create } from 'zustand';

const savedDark = localStorage.getItem('darkMode') === 'true';

const useStore = create((set) => ({
  user: null,
  setUser: (user) => set({ user }),
  logout: () => set({ user: null, tickets: [], messages: {}, activeTicketId: null }),

  tickets: [],
  setTickets: (tickets) => set({ tickets }),
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

  messages: {},
  setMessages: (ticketId, messages) =>
    set((state) => ({ messages: { ...state.messages, [ticketId]: messages } })),
  addMessage: (ticketId, message) =>
    set((state) => {
      const existing = state.messages[ticketId] || [];
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

  unreadTickets: new Set(),
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

  // agentOnline: { [ticketId]: boolean }
  agentOnline: {},
  setAgentOnline: (ticketId, online) =>
    set((state) => ({ agentOnline: { ...state.agentOnline, [ticketId]: online } })),

  businessHoursOpen: true,
  setBusinessHoursOpen: (open) => set({ businessHoursOpen: open }),

  // Dark mode — persisted to localStorage
  darkMode: savedDark,
  toggleDarkMode: () =>
    set((state) => {
      const next = !state.darkMode;
      localStorage.setItem('darkMode', next);
      return { darkMode: next };
    }),
}));

export default useStore;
