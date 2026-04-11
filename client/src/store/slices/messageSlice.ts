import { StateCreator } from 'zustand';
import { StoreState, Message, OnlineSupport } from '../../types';

/**
 * Transient signal published when the server rejects an outgoing message
 * (content guard, repetition limit, etc.). The chat compose component
 * subscribes to this and surfaces a localized toast for the active ticket,
 * then clears the field by passing `null`. `at` is included so subsequent
 * rejections with the same `(ticketId, localId, code)` triple still trip
 * the React effect (Zustand only fires on referential change).
 */
export interface MessageRejection {
  ticketId: string;
  localId: string;
  code: string;
  at: number;
}

export interface MessageSlice {
  messages: Record<string, Message[]>;
  messageCursors: Record<string, { hasMore: boolean; nextCursor?: string; loading: boolean }>;
  onlineSupportUsers: OnlineSupport[];
  typingUsers: Record<string, Record<string, boolean>>;
  lastRejection: MessageRejection | null;

  setMessages: (ticketId: string, messages: Message[]) => void;
  addMessage: (ticketId: string, message: Message) => void;
  prependMessages: (ticketId: string, messages: Message[]) => void;
  setMessageCursor: (ticketId: string, hasMore: boolean, nextCursor?: string) => void;
  setMessageLoading: (ticketId: string, loading: boolean) => void;
  updateMessageState: (ticketId: string, messageId: string, updates: Partial<Message>) => void;
  removeMessage: (ticketId: string, messageId: string) => void;
  updateMessageReaction: (ticketId: string, messageId: string, reactions: Record<string, string[]>) => void;
  updateMessagePreviews: (ticketId: string, messageId: string, linkPreviews: Message['linkPreviews']) => void;
  setOnlineSupportUsers: (list: OnlineSupport[]) => void;
  setTyping: (ticketId: string, name: string, isTyping: boolean) => void;
  setLastRejection: (rejection: Omit<MessageRejection, 'at'> | null) => void;
}

/** Safely extract a numeric timestamp from a message, returning 0 for invalid/missing dates */
function safeTimestamp(m: { createdAt?: string; timestamp?: string }): number {
  const d = new Date(m.createdAt || m.timestamp || 0);
  const t = d.getTime();
  return Number.isNaN(t) ? 0 : t;
}

export const createMessageSlice: StateCreator<StoreState, [], [], MessageSlice> = (set) => ({
  messages: {},
  messageCursors: {},
  onlineSupportUsers: [],
  typingUsers: {},
  lastRejection: null,

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
        safeTimestamp(a) - safeTimestamp(b)
      );

      return { messages: { ...state.messages, [ticketId]: merged } };
    }),
  addMessage: (ticketId, message) =>
    set((state) => {
      const existing = state.messages[ticketId] || [];
      if (!message.pending) {
        // Primary: match by localId (client-generated ID echoed back by server)
        const localId = message.localId;
        let optimisticIndex = localId
          ? existing.findIndex(m => m.pending && m.id === localId)
          : -1;

        // Fallback: match by sender + text + time window (for messages sent before localId support)
        if (optimisticIndex === -1) {
          const serverTime = new Date(message.createdAt || message.timestamp || '').getTime();
          optimisticIndex = existing.findIndex(m => {
            if (!m.pending || m.senderId !== message.senderId) return false;
            const textMatch = m.originalText === message.originalText || m.text === message.originalText;
            if (!textMatch) return false;
            const pendingTime = new Date(m.createdAt || m.timestamp || '').getTime();
            if (serverTime && pendingTime && Math.abs(serverTime - pendingTime) > 5000) return false;
            return true;
          });
        }

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
        safeTimestamp(a) - safeTimestamp(b)
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
  removeMessage: (ticketId, messageId) => set((s) => {
    const msgs = s.messages[ticketId];
    if (!msgs) return s;
    const filtered = msgs.filter((m) => m.id !== messageId);
    if (filtered.length === msgs.length) return s; // no-op if id not found
    return {
      messages: {
        ...s.messages,
        [ticketId]: filtered,
      },
    };
  }),
  setLastRejection: (rejection) => set(() => ({
    lastRejection: rejection ? { ...rejection, at: Date.now() } : null,
  })),
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
  updateMessagePreviews: (ticketId, messageId, linkPreviews) =>
    set((state) => {
      const msgs = state.messages[ticketId];
      if (!msgs) return state;
      return {
        messages: {
          ...state.messages,
          [ticketId]: msgs.map((m) => (m.id === messageId ? { ...m, linkPreviews } : m)),
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
