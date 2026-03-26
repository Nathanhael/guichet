import { useEffect, useRef } from 'react';
import { notify, updateTitleBadge } from '../utils/notifications';
import { io, Socket } from 'socket.io-client';
import useStore from '../store/useStore';
import { SOCKET_URL } from '../config';
import { Ticket, Message, OnlineSupport, Label, BusinessHoursStatus, TopicAlert } from '../types';
import { isTenantAdmin } from '../utils/roles';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(SOCKET_URL, {
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      withCredentials: true,
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
    setBusinessHoursStatus,
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

    s.on('error', (err: { message?: string }) => {
      console.error('[socket] Server error:', err?.message || err);
    });

    // New ticket created (broadcast to support/admins)
    s.on('ticket:created', ({ ticket }: { ticket: Ticket }) => {
      addTicket(ticket);
      const state = useStore.getState();
      if (state.notificationsEnabled && state.user?.role !== 'agent') {
        notify(`New ticket: ${ticket.agentName}`, {
          body: `${ticket.dept} — ${ticket.agentName}`,
          tag: `ticket-${ticket.id}`,
        });
      }
      updateTitleBadge();
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
      // Mark unread, notify, and play sound if not the sender's own message
      const state = useStore.getState();
      if (message.senderId !== state.user?.id) {
        state.markUnread(message.ticketId);
        if (state.notificationsEnabled) {
          notify(message.senderName || 'New message', {
            body: message.text || message.originalText || '',
            tag: `msg-${message.ticketId}`, // Collapse multiple from same ticket
          });
        }
        updateTitleBadge();
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

    // Message edited
    s.on('message:edited', ({ ticketId, messageId, text, editedAt }: { ticketId: string; messageId: string; text: string; editedAt: string }) => {
      useStore.getState().updateMessageState(ticketId, messageId, { text, originalText: text, editedAt } as any);
    });

    // Message deleted
    s.on('message:deleted', ({ ticketId, messageId, deletedAt }: { ticketId: string; messageId: string; deletedAt: string }) => {
      useStore.getState().updateMessageState(ticketId, messageId, { text: '', deletedAt } as any);
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

    // Ticket transferred
    s.on('ticket:transferred', ({ ticketId, toId, toName }: { ticketId: string; fromId: string; fromName: string; toId: string | null; toName: string | null }) => {
      if (toId) {
        updateTicket(ticketId, { supportId: toId, supportName: toName || undefined });
      } else {
        updateTicket(ticketId, { supportId: null as any, supportName: undefined, status: 'open' });
      }
    });

    // Ticket assigned to a support agent (used for transfer notifications)
    s.on('ticket:assigned', ({ ticketId, supportId, supportName }: { ticketId: string; supportId: string; supportName: string }) => {
      const state = useStore.getState();
      if (supportId === state.user?.id && state.notificationsEnabled) {
        notify(`Ticket assigned to you`, {
          body: `${supportName} — you have a new ticket`,
          tag: `assign-${ticketId}`,
        });
      }
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
    s.on('hours:closed', (payload?: { status?: BusinessHoursStatus }) => {
      if (payload?.status) {
        setBusinessHoursStatus(payload.status);
      } else {
        setBusinessHoursStatus({
          isOpen: false,
          timezone: 'Europe/Brussels',
          source: 'default',
          evaluatedAt: new Date().toISOString(),
          message: 'Support is currently closed.',
        });
      }
    });

    // Topic Heat Alert
    s.on('topic:alert', (alert: TopicAlert) => {
      const state = useStore.getState();
      if (isTenantAdmin(state.user?.role)) {
        addTopicAlert(alert);
        if (state.notificationsEnabled) {
          notify(`Topic alert: ${alert.topic || 'Trending'}`, {
            body: alert.summary || '',
            tag: `alert-${alert.id}`,
          });
        }
      }
    });

    s.on('partner:deactivated', ({ partnerId }: { partnerId: string }) => {
      const state = useStore.getState();
      const updatedMemberships = state.memberships.map(m => 
        m.partnerId === partnerId ? { ...m, status: 'inactive' as const } : m
      );
      state.setMemberships(updatedMemberships);
    });

    s.on('user:deactivated', ({ userId }: { userId: string }) => {
      const state = useStore.getState();
      if (state.user?.id === userId) {
        state.logout();
        window.location.href = '/'; // Force reload to clear all state
      }
    });

    // Token expired — reconnect to trigger a fresh handshake with current cookie
    s.on('auth:expired', () => {
      const state = useStore.getState();
      if (state.user) {
        // User still logged in — reconnect with cookie
        s.disconnect();
        s.connect();
      } else {
        // No session — truly gone
        state.logout();
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
      s.off('support:left');
      s.off('message:status');
      s.off('queue:position');
      s.off('partner:deactivated');
      s.off('user:deactivated');
      s.off('auth:expired');
      s.off('queue:update');
      s.off('ticket:transferred');
      s.off('ticket:assigned');
      s.off('message:edited');
      s.off('message:deleted');
      listenersAttached.current = false;
    };
  }, [addMessage, addTicket, setMessages, setOnlineSupportUsers, setTyping, updateTicket, setBusinessHoursStatus]);

  return getSocket();
}
