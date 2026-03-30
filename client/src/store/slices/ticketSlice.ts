import { StateCreator } from 'zustand';
import { StoreState, Ticket, TopicAlert } from '../../types';

export interface TicketSlice {
  tickets: Ticket[];
  archivedTickets: Ticket[];
  activeTicketId: string | null;
  unreadTickets: Record<string, boolean>;
  participantsOnline: Record<string, boolean>;
  supportOpenTickets: string[];
  queuePosition: { position: number; etaMins: number } | null;
  topicAlerts: TopicAlert[];

  setTickets: (tickets: Ticket[]) => void;
  setArchivedTickets: (archived: Ticket[]) => void;
  addTicket: (ticket: Ticket) => void;
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

export const createTicketSlice: StateCreator<StoreState, [], [], TicketSlice> = (set) => ({
  tickets: [],
  archivedTickets: [],
  activeTicketId: null,
  unreadTickets: {},
  participantsOnline: {},
  supportOpenTickets: [],
  queuePosition: null,
  topicAlerts: [],

  setTickets: (tickets) => set({ tickets }),
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

  setActiveTicketId: (id) => set({ activeTicketId: id }),
  markUnread: (ticketId) =>
    set((state) => ({
      unreadTickets: { ...state.unreadTickets, [ticketId]: true },
    })),
  clearUnread: (ticketId) =>
    set((state) => {
      const { [ticketId]: _, ...rest } = state.unreadTickets;
      return { unreadTickets: rest };
    }),
  setParticipantOnline: (ticketId, online) =>
    set((state) => ({ participantsOnline: { ...state.participantsOnline, [ticketId]: online } })),
  addSupportOpenTicket: (ticketId) =>
    set((state) => ({
      supportOpenTickets: state.supportOpenTickets.includes(ticketId)
        ? state.supportOpenTickets
        : [...state.supportOpenTickets, ticketId],
    })),
  removeSupportOpenTicket: (ticketId) =>
    set((state) => ({
      supportOpenTickets: state.supportOpenTickets.filter((id) => id !== ticketId),
    })),
  setQueuePosition: (pos) => set({ queuePosition: pos }),
  addTopicAlert: (alert) =>
    set((state) => ({
      topicAlerts: [alert, ...state.topicAlerts].slice(0, 50),
    })),
});
