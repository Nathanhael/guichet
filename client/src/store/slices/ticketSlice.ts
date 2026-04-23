import { StateCreator } from 'zustand';
import { StoreState, Ticket, TopicAlert } from '../../types';

export interface TicketSlice {
  tickets: Ticket[];
  activeTicketId: string | null;
  unreadTickets: Record<string, number>;
  participantsOnline: Record<string, boolean>;
  supportOpenTickets: string[];
  queuePosition: { position: number; etaMins: number } | null;
  topicAlerts: TopicAlert[];

  setTickets: (tickets: Ticket[]) => void;
  addTicket: (ticket: Ticket) => void;
  removeTicket: (ticketId: string) => void;
  updateTicket: (ticketId: string, updates: Partial<Ticket>) => void;
  toggleTicketLabel: (ticketId: string, labelId: string) => void;
  setActiveTicketId: (id: string | null) => void;
  markUnread: (ticketId: string) => void;
  clearUnread: (ticketId: string) => void;
  setParticipantOnline: (ticketId: string, online: boolean) => void;
  addSupportOpenTicket: (ticketId: string) => void;
  removeSupportOpenTicket: (ticketId: string) => void;
  setQueuePosition: (pos: { position: number; etaMins: number } | null) => void;
  addTopicAlert: (alert: TopicAlert) => void;
}

function tabStorageKey(partnerId?: string): string {
  return partnerId ? `guichet:supportOpenTabs:${partnerId}` : 'guichet:supportOpenTabs';
}

export const createTicketSlice: StateCreator<StoreState, [], [], TicketSlice> = (set, get) => ({
  tickets: [],
  activeTicketId: null,
  unreadTickets: {},
  participantsOnline: {},
  supportOpenTickets: [],
  queuePosition: null,
  topicAlerts: [],

  setTickets: (tickets) => set({ tickets }),
  addTicket: (ticket) =>
    set((state) => ({
      tickets: state.tickets.some((t) => t.id === ticket.id)
        ? state.tickets
        : [ticket, ...state.tickets],
    })),
  removeTicket: (ticketId) =>
    set((state) => ({
      tickets: state.tickets.filter((t) => t.id !== ticketId),
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

  setActiveTicketId: (id) => set({ activeTicketId: id }),
  markUnread: (ticketId) =>
    set((state) => ({
      unreadTickets: {
        ...state.unreadTickets,
        [ticketId]: (state.unreadTickets[ticketId] || 0) + 1,
      },
    })),
  clearUnread: (ticketId) =>
    set((state) => {
      const { [ticketId]: _, ...rest } = state.unreadTickets;
      return { unreadTickets: rest };
    }),
  setParticipantOnline: (ticketId, online) =>
    set((state) => ({ participantsOnline: { ...state.participantsOnline, [ticketId]: online } })),
  addSupportOpenTicket: (ticketId) =>
    set((state) => {
      const next = state.supportOpenTickets.includes(ticketId)
        ? state.supportOpenTickets
        : [...state.supportOpenTickets, ticketId];
      const key = tabStorageKey(get().activeMembershipId ?? undefined);
      localStorage.setItem(key, JSON.stringify(next));
      return { supportOpenTickets: next };
    }),
  removeSupportOpenTicket: (ticketId) =>
    set((state) => {
      const next = state.supportOpenTickets.filter((id) => id !== ticketId);
      const key = tabStorageKey(get().activeMembershipId ?? undefined);
      localStorage.setItem(key, JSON.stringify(next));
      return { supportOpenTickets: next };
    }),
  setQueuePosition: (pos) => set({ queuePosition: pos }),
  addTopicAlert: (alert) =>
    set((state) => ({
      topicAlerts: [alert, ...state.topicAlerts].slice(0, 50),
    })),
});
