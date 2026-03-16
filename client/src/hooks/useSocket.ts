import { useEffect, useRef } from 'react';
import { playChime } from '../utils/notifications';
import { io, Socket } from 'socket.io-client';
import useStore from '../store/useStore';
import { SOCKET_URL } from '../config';
import { Ticket, Message, OnlineSupport, Label } from '../types';

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
    activePartnerId,
    addTicket, 
    updateTicket, 
    addMessage, 
    setMessages, 
    setBusinessHoursOpen, 
    setTyping, 
    setOnlineSupportUsers,
    addTopicAlert,
    setActiveTicketId,
  } = useStore();
  
  const listenersAttached = useRef(false);

  // Re-identify whenever user or partner changes (e.g. after login or switch)
  useEffect(() => {
    if (!user || !activePartnerId) return;
    const s = getSocket();
    s.emit('socket:identify', { 
      userId: user.id, 
      role: user.role, 
      name: user.name,
      partnerId: activePartnerId
    });
  }, [user, activePartnerId]);

  useEffect(() => {
    const s = getSocket();

    if (listenersAttached.current) return;
    listenersAttached.current = true;

    // Connection management
    s.on('connect', () => {
      useStore.getState().setConnectionStatus('connected');
      const state = useStore.getState();
      if (state.user && state.activePartnerId) {
        s.emit('socket:identify', { 
          userId: state.user.id, 
          role: state.user.role, 
          name: state.user.name,
          partnerId: state.activePartnerId
        });
      }
    });

    s.on('disconnect', () => {
      useStore.getState().setConnectionStatus('disconnected');
    });

    s.on('connect_error', () => {
      useStore.getState().setConnectionStatus('reconnecting');
    });

    // New ticket created (broadcast to support/admins)
    s.on('ticket:created', ({ ticket }: { ticket: Ticket }) => {
      addTicket(ticket);
    });

    // Agent: own ticket confirmed
    s.on('ticket:created:self', ({ ticket, message }: { ticket: Ticket; message: Message }) => {
      addTicket(ticket);
      if (message) addMessage(ticket.id, message);
      setActiveTicketId(ticket.id);
    });

    // Support joined a ticket
    s.on('support:joined', ({ ticketId, supportName, participants }: { ticketId: string; supportName: string; participants: any[] }) => {
      updateTicket(ticketId, { supportName, status: 'active', participants: participants || [] });
    });

    // History when support joins
    s.on('ticket:history', ({ ticketId, messages, labels }: { ticketId: string; messages: Message[]; labels: string[] }) => {
      setMessages(ticketId, messages);
      if (labels) updateTicket(ticketId, { labels });
    });

    // New message in any open ticket
    s.on('message:new', (message: Message) => {
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

    // Online support/admins
    s.on('support:online', (list: OnlineSupport[]) => {
      setOnlineSupportUsers(list);
    });

    // Agent online/offline status
    s.on('agent:status', ({ ticketId, agentId: _agentId, online }: { ticketId: string; agentId: string; online: boolean }) => {
      const state = useStore.getState();
      state.setParticipantOnline(ticketId, online);
      // Add a system message to the chat
      if (!online) {
        state.addMessage(ticketId, {
          id: `system-offline-${Date.now()}`,
          ticketId,
          senderId: '__system__',
          senderName: 'System',
          senderRole: 'admin',
          senderLang: 'en',
          originalText: 'Agent has disconnected.',
          improvedText: 'Agent has disconnected.',
          processedText: 'Agent has disconnected.',
          text: 'Agent has disconnected.',
          timestamp: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          system: 1,
          whisper: 0,
          translationSkipped: 1,
          fallback: 0,
          reactions: {},
        });
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
    s.on('ticket:closed', ({ ticketId, supportId: eventSupportId, supportName: eventSupportName }: { ticketId: string; supportId?: string; supportName?: string }) => {
      updateTicket(ticketId, { status: 'closed' });
      // Trigger rating prompt for agent
      const state = useStore.getState();
      if (state.user?.role === 'agent') {
        const ticket = state.tickets.find((t) => t.id === ticketId);
        if (ticket && ticket.agentId === state.user.id) {
          // Use data from event, fall back to ticket in store
          const supportId = eventSupportId || ticket.supportId;
          const supportName = eventSupportName || ticket.supportName;

          if (supportId && supportName) {
            state.setRatingPrompt({
              ticketId,
              supportId,
              supportName,
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

    // Topic Heat Alert
    s.on('topic:alert', (alert: TopicAlert) => {
      const state = useStore.getState();
      if (state.user?.role === 'admin' || state.user?.role === 'manager') {
        addTopicAlert(alert);
        playChime();
      }
    });

    return () => {
      // Do NOT disconnect — socket is shared. Only remove listeners on strict-mode double-effect.
      s.off('connect');
      s.off('disconnect');
      s.off('connect_error');
      s.off('ticket:created');
      s.off('ticket:created:self');
      s.off('support:joined');
      s.off('ticket:history');
      s.off('message:new');
      s.off('ticket:closed');
      s.off('ticket:updated');
      s.off('ticket:labels:updated');
      s.off('hours:closed');
      s.off('typing:update');
      s.off('support:online');
      s.off('agent:status');
      s.off('reaction:updated');
      s.off('rating:saved');
      s.off('label:deleted');
      s.off('label:created');
      s.off('topic:alert');
      listenersAttached.current = false;
    };
  }, [addMessage, addTicket, setMessages, setOnlineSupportUsers, setTyping, updateTicket, setBusinessHoursOpen]);

  return getSocket();
}
