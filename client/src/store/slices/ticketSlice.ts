import { StateCreator } from 'zustand';
import { StoreState, Ticket } from '../../types';

export interface TicketSlice {
  tickets: Ticket[];
  archivedTickets: Ticket[];
  activeTicketId: string | null;
  unreadTickets: Set<string>;
  participantsOnline: Record<string, boolean>;
  supportOpenTickets: string[];
  queuePosition: { position: number; etaMins: number } | null;

  setTickets: (tickets: Ticket[]) => void;
  setArchivedTickets: (archived: Ticket[]) => void;
  addTicket: (ticket: Ticket) => void;
  updateTicket: (ticketId: string, updates: Partial<Ticket>) => void;
  toggleTicketLabel: (ticketId: string, labelId: string) => void;
  setActiveTicketId: (id: string | null) => void;
  markUnread: (ticketId: string) => void;
  clearUnread: (ticketId: string) => void;
  setParticipantOnline: (participantId: string, online: boolean) => void;
  addSupportOpenTicket: (ticketId: string) => void;
  removeSupportOpenTicket: (ticketId: string) => void;
  setQueuePosition: (pos: { position: number; etaMins: number } | null) => void;
}

export const createTicketSlice: StateCreator<StoreState, [], [], TicketSlice> = (set) => ({
  tickets: [],
  archivedTickets: [],
  activeTicketId: null,
  unreadTickets: new Set(),
  participantsOnline: {},
  supportOpenTickets: [],
  queuePosition: null,

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
  setParticipantOnline: (participantId, online) =>
    set((state) => ({ participantsOnline: { ...state.participantsOnline, [participantId]: online } })),
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
});
