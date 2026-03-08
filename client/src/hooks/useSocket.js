import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import useStore from '../store/useStore';

let socket = null;

export function getSocket() {
  if (!socket) {
    socket = io('http://localhost:3001', { autoConnect: true });
  }
  return socket;
}

export function useSocket() {
  const { user, addTicket, updateTicket, addMessage, setMessages, setBusinessHoursOpen, setTyping, setOnlineExperts } = useStore();
  const listenersAttached = useRef(false);

  // Re-identify whenever user changes (e.g. after login)
  useEffect(() => {
    if (!user) return;
    const s = getSocket();
    s.emit('socket:identify', { userId: user.id, role: user.role, name: user.name });
  }, [user]);

  useEffect(() => {
    const s = getSocket();

    if (listenersAttached.current) return;
    listenersAttached.current = true;

    // New ticket created (broadcast to experts/managers)
    s.on('ticket:created', ({ ticket }) => {
      addTicket(ticket);
    });

    // Agent: own ticket confirmed
    s.on('ticket:created:self', ({ ticket, message }) => {
      addTicket(ticket);
      if (message) addMessage(ticket.id, message);
    });

    // Expert joined a ticket
    s.on('expert:joined', ({ ticketId, expertName, participants }) => {
      updateTicket(ticketId, { expertName, status: 'active', participants: participants || [] });
    });

    // History when expert joins
    s.on('ticket:history', ({ ticketId, messages }) => {
      setMessages(ticketId, messages);
    });

    // New message in any open ticket
    s.on('message:new', ({ message }) => {
      addMessage(message.ticketId, message);
      // Mark unread if not the sender's own message
      const state = useStore.getState();
      if (message.senderId !== state.user?.id) {
        state.markUnread(message.ticketId);
      }
    });

    // Typing indicators
    s.on('typing:update', ({ ticketId, senderName, typing }) => {
      setTyping(ticketId, senderName, typing);
    });

    // Online experts/managers
    s.on('experts:online', (list) => {
      setOnlineExperts(list);
    });

    // Agent online/offline status
    s.on('agent:status', ({ ticketId, agentId, online }) => {
      const state = useStore.getState();
      state.setAgentOnline(ticketId, online);
      // Add a system message to the chat
      if (!online) {
        state.addMessage(ticketId, {
          id: `system-offline-${Date.now()}`,
          ticketId,
          senderId: '__system__',
          senderName: 'System',
          text: `Agent has disconnected.`,
          translatedText: null,
          mediaUrl: null,
          system: true,
          createdAt: new Date().toISOString(),
        });
      }
    });

    // Reaction updated
    s.on('reaction:updated', ({ ticketId, messageId, reactions }) => {
      useStore.getState().updateMessageReaction(ticketId, messageId, reactions);
    });

    // Rating saved confirmation
    s.on('rating:saved', () => {
      useStore.getState().clearRatingPrompt();
    });

    // Ticket closed
    s.on('ticket:closed', ({ ticketId }) => {
      updateTicket(ticketId, { status: 'closed' });
      // Trigger rating prompt for agent
      const state = useStore.getState();
      if (state.user?.role === 'agent') {
        const ticket = state.tickets.find((t) => t.id === ticketId);
        if (ticket && ticket.agentId === state.user.id && ticket.expertName) {
          state.setRatingPrompt({
            ticketId,
            expertId: ticket.expertId,
            expertName: ticket.expertName,
          });
        }
      }
    });

    // Ticket updated (status change broadcast)
    s.on('ticket:updated', ({ ticketId, ...updates }) => {
      updateTicket(ticketId, updates);
    });

    // Outside business hours
    s.on('hours:closed', () => {
      setBusinessHoursOpen(false);
    });

    return () => {
      // Do NOT disconnect — socket is shared. Only remove listeners on strict-mode double-effect.
      s.off('ticket:created');
      s.off('ticket:created:self');
      s.off('expert:joined');
      s.off('ticket:history');
      s.off('message:new');
      s.off('ticket:closed');
      s.off('ticket:updated');
      s.off('hours:closed');
      s.off('typing:update');
      s.off('experts:online');
      s.off('agent:status');
      s.off('reaction:updated');
      s.off('rating:saved');
      listenersAttached.current = false;
    };
  }, []);

  return getSocket();
}
