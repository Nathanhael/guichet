import { StateCreator } from 'zustand';
import { StoreState, Message, OnlineSupport } from '../../types';

export interface MessageSlice {
  messages: Record<string, Message[]>;
  messageCursors: Record<string, { hasMore: boolean; nextCursor?: string; loading: boolean }>;
  onlineSupportUsers: OnlineSupport[];
  typingUsers: Record<string, Record<string, boolean>>;

  setMessages: (ticketId: string, messages: Message[]) => void;
  addMessage: (ticketId: string, message: Message) => void;
  prependMessages: (ticketId: string, messages: Message[]) => void;
  setMessageCursor: (ticketId: string, hasMore: boolean, nextCursor?: string) => void;
  setMessageLoading: (ticketId: string, loading: boolean) => void;
  updateMessageState: (ticketId: string, messageId: string, updates: Partial<Message>) => void;
  updateMessageReaction: (ticketId: string, messageId: string, reactions: Record<string, string[]>) => void;
  setOnlineSupportUsers: (list: OnlineSupport[]) => void;
  setTyping: (ticketId: string, name: string, isTyping: boolean) => void;
}

export const createMessageSlice: StateCreator<StoreState, [], [], MessageSlice> = (set) => ({
  messages: {},
  messageCursors: {},
  onlineSupportUsers: [],
  typingUsers: {},

  setMessages: (ticketId, newMessages) =>
    set((state) => {
      const existing = state.messages[ticketId] || [];
      // Create a map of existing messages by ID
      const msgMap = new Map();
      existing.forEach(m => msgMap.set(m.id, m));
      
      // Add or update with new messages
      newMessages.forEach(m => msgMap.set(m.id, m));
      
      // Sort by creation time to maintain order
      const merged = Array.from(msgMap.values()).sort((a, b) => 
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );

      return { messages: { ...state.messages, [ticketId]: merged } };
    }),
  addMessage: (ticketId, message) =>
    set((state) => {
      const existing = state.messages[ticketId] || [];
      if (!message.pending) {
        const serverTime = new Date(message.createdAt || message.timestamp || '').getTime();
        const optimisticIndex = existing.findIndex(m => {
          if (!m.pending || m.senderId !== message.senderId) return false;
          const textMatch = m.originalText === message.originalText || m.text === message.originalText;
          if (!textMatch) return false;
          // Guard against stale optimistic matches: require server timestamp within 5 seconds
          const pendingTime = new Date(m.createdAt || m.timestamp || '').getTime();
          if (serverTime && pendingTime && Math.abs(serverTime - pendingTime) > 5000) return false;
          return true;
        });
        if (optimisticIndex !== -1) {
          const next = [...existing];
          next[optimisticIndex] = message;
          return { messages: { ...state.messages, [ticketId]: next } };
        }
      }
      if (existing.some((m) => m.id === message.id)) return state;
      return { messages: { ...state.messages, [ticketId]: [...existing, message] } };
    }),
  prependMessages: (ticketId, newMessages) =>
    set((state) => {
      const existing = state.messages[ticketId] || [];
      const msgMap = new Map();
      newMessages.forEach(m => msgMap.set(m.id, m));
      existing.forEach(m => msgMap.set(m.id, m)); // existing wins on conflict
      const merged = Array.from(msgMap.values()).sort((a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
      return { messages: { ...state.messages, [ticketId]: merged } };
    }),

  setMessageCursor: (ticketId, hasMore, nextCursor) =>
    set((state) => ({
      messageCursors: {
        ...state.messageCursors,
        [ticketId]: { ...state.messageCursors[ticketId], hasMore, nextCursor, loading: false },
      },
    })),

  setMessageLoading: (ticketId, loading) =>
    set((state) => ({
      messageCursors: {
        ...state.messageCursors,
        [ticketId]: { ...state.messageCursors[ticketId], hasMore: state.messageCursors[ticketId]?.hasMore ?? false, loading },
      },
    })),

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
  setOnlineSupportUsers: (list) => set({ onlineSupportUsers: list }),
  setTyping: (ticketId, name, isTyping) =>
    set((state) => {
      const ticketTyping = { ...(state.typingUsers[ticketId] || {}) };
      if (isTyping) ticketTyping[name] = true;
      else delete ticketTyping[name];
      return { typingUsers: { ...state.typingUsers, [ticketId]: ticketTyping } };
    }),
});
