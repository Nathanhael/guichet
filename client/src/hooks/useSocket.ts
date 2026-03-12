import { useEffect, useRef } from 'react';
import { playChime } from '../utils/notifications';
import { io, Socket } from 'socket.io-client';
import useStore from '../store/useStore';
import { SOCKET_URL } from '../config';
import { Ticket, Message, OnlineExpert, Label } from '../types';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(SOCKET_URL, {
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
  }
  return socket;
}

export function useSocket(): Socket {
  const { 
    user, 
    addTicket, 
    updateTicket, 
    addMessage, 
    setMessages, 
    setBusinessHoursOpen, 
    setTyping, 
    setOnlineExperts,
    addLabelGlobally,
  } = useStore();
  
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

    // Connection management
    s.on('connect', () => {
      useStore.getState().setConnectionStatus('connected');
      const state = useStore.getState();
      if (state.user) {
        s.emit('socket:identify', { userId: state.user.id, role: state.user.role, name: state.user.name });
      }
    });

    s.on('disconnect', () => {
      useStore.getState().setConnectionStatus('disconnected');
    });

    s.on('connect_error', () => {
      useStore.getState().setConnectionStatus('reconnecting');
    });

    // New ticket created (broadcast to experts/admins)
    s.on('ticket:created', ({ ticket }: { ticket: Ticket }) => {
      addTicket(ticket);
    });

    // Agent: own ticket confirmed
    s.on('ticket:created:self', ({ ticket, message }: { ticket: Ticket; message: Message }) => {
      addTicket(ticket);
      if (message) addMessage(ticket.id, message);
    });

    // Expert joined a ticket
    s.on('expert:joined', ({ ticketId, expertName, participants }: { ticketId: string; expertName: string; participants: any[] }) => {
      updateTicket(ticketId, { expertName, status: 'active', participants: participants || [] });
    });

    // History when expert joins
    s.on('ticket:history', ({ ticketId, messages, labels }: { ticketId: string; messages: Message[]; labels: string[] }) => {
      setMessages(ticketId, messages);
      if (labels) updateTicket(ticketId, { labels });
    });

    // New message in any open ticket
    s.on('message:new', ({ message }: { message: Message }) => {
      addMessage(message.ticketId, message);
      // Mark unread and play sound if not the sender's own message
      const state = useStore.getState();
      if (message.senderId !== state.user?.id) {
        state.markUnread(message.ticketId);
        playChime();
        // Automatically mark as delivered since client received it
        s.emit('message:delivered', { ticketId: message.ticketId, messageId: message.id });
      }
    });

    // Message status update (delivered / read)
    s.on('message:status', ({ ticketId, messageId, status, timestamp }: { ticketId: string; messageId: string; status: string; timestamp: string }) => {
      const field = status === 'read' ? 'readAt' : 'deliveredAt';
      useStore.getState().updateMessageState(ticketId, messageId, { [field]: timestamp });
    });

    // Typing indicators
    s.on('typing:update', ({ ticketId, senderName, typing }: { ticketId: string; senderName: string; typing: boolean }) => {
      setTyping(ticketId, senderName, typing);
    });

    // Online experts/admins
    s.on('experts:online', (list: OnlineExpert[]) => {
      setOnlineExperts(list);
    });

    // Agent online/offline status
    s.on('agent:status', ({ ticketId, agentId: _agentId, online }: { ticketId: string; agentId: string; online: boolean }) => {
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
          translatedText: undefined,
          mediaUrl: undefined,
          system: true,
          createdAt: new Date().toISOString(),
        } as Message);
      }
    });

    // Reaction updated
    s.on('reaction:updated', ({ ticketId, messageId, reactions }: { ticketId: string; messageId: string; reactions: any }) => {
      useStore.getState().updateMessageReaction(ticketId, messageId, reactions);
    });

    // Rating saved confirmation
    s.on('rating:saved', () => {
      useStore.getState().clearRatingPrompt();
    });

    // Queue Position updates
    s.on('queue:position', ({ position, etaMins }: { position: number; etaMins: number }) => {
      useStore.getState().setQueuePosition({ position, etaMins });
    });

    // Ticket closed
    s.on('ticket:closed', ({ ticketId, expertId: eventExpertId, expertName: eventExpertName }: { ticketId: string; expertId?: string; expertName?: string }) => {
      updateTicket(ticketId, { status: 'closed' });
      // Trigger rating prompt for agent
      const state = useStore.getState();
      if (state.user?.role === 'agent') {
        const ticket = state.tickets.find((t) => t.id === ticketId);
        if (ticket && ticket.agentId === state.user.id) {
          // Use data from event, fall back to ticket in store
          const expertId = eventExpertId || ticket.expertId;
          const expertName = eventExpertName || ticket.expertName;

          if (expertId && expertName) {
            state.setRatingPrompt({
              ticketId,
              expertId,
              expertName,
            });
          }
        }
      }
    });

    // Ticket updated (status change broadcast)
    s.on('ticket:updated', ({ ticketId, ...updates }: { ticketId: string; [key: string]: any }) => {
      updateTicket(ticketId, updates);
    });

    // Room-specific label update
    s.on('ticket:labels:updated', ({ ticketId, labels }: { ticketId: string; labels: string[] }) => {
      updateTicket(ticketId, { labels });
    });

    s.on('label:deleted', ({ id }: { id: string }) => {
      useStore.getState().removeLabelGlobally(id);
    });

    s.on('label:created', (label: Label) => {
      useStore.getState().addLabelGlobally(label);
    });

    // Outside business hours
    s.on('hours:closed', () => {
      setBusinessHoursOpen(false);
    });

    return () => {
      // Do NOT disconnect — socket is shared. Only remove listeners on strict-mode double-effect.
      s.off('connect');
      s.off('disconnect');
      s.off('connect_error');
      s.off('ticket:created');
      s.off('ticket:created:self');
      s.off('expert:joined');
      s.off('ticket:history');
      s.off('message:new');
      s.off('ticket:closed');
      s.off('ticket:updated');
      s.off('ticket:labels:updated');
      s.off('hours:closed');
      s.off('typing:update');
      s.off('experts:online');
      s.off('agent:status');
      s.off('reaction:updated');
      s.off('rating:saved');
      s.off('label:deleted');
      s.off('label:created');
      listenersAttached.current = false;
    };
  }, [addMessage, addTicket, setMessages, setOnlineExperts, setTyping, updateTicket, setBusinessHoursOpen]);

  return getSocket();
}
