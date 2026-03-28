import { useEffect, useRef } from 'react';
import { notify, updateTitleBadge } from '../utils/notifications';
import { io, Socket } from 'socket.io-client';
import useStore from '../store/useStore';
import { SOCKET_URL } from '../config';
import { Ticket, Message, OnlineSupport, Label, BusinessHoursStatus, TopicAlert, Participant } from '../types';
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

    // Named handlers — passed to both s.on() and s.off() so cleanup only removes our listeners
    const handleConnect = () => {
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
    };

    const handleDisconnect = () => {
      useStore.getState().setConnectionStatus('disconnected');
    };

    const handleConnectError = () => {
      useStore.getState().setConnectionStatus('reconnecting');
    };

    const handleError = (err: { message?: string }) => {
      console.error('[socket] Server error:', err?.message || err);
    };

    const handleTicketCreated = ({ ticket }: { ticket: Ticket }) => {
      addTicket(ticket);
      const state = useStore.getState();
      if (state.notificationsEnabled && state.user?.role !== 'agent') {
        notify(`New ticket: ${ticket.agentName}`, {
          body: `${ticket.dept} — ${ticket.agentName}`,
          tag: `ticket-${ticket.id}`,
        });
      }
      updateTitleBadge();
    };

    const handleTicketCreatedSelf = ({ ticket, message }: { ticket: Ticket; message: Message }) => {
      addTicket(ticket);
      if (message) addMessage(ticket.id, message);
      setActiveTicketId(ticket.id);
    };

    const handleSupportJoined = ({ ticketId, supportName, participants }: { ticketId: string; supportName: string; participants: Participant[] }) => {
      updateTicket(ticketId, { supportName, status: 'active', participants: participants || [] });
    };

    const handleTicketHistory = ({ ticketId, messages, labels }: { ticketId: string; messages: Message[]; labels: string[] }) => {
      setMessages(ticketId, messages);
      if (labels) updateTicket(ticketId, { labels });
    };

    const handleMessageNew = (message: Message) => {
      addMessage(message.ticketId, message);
      const state = useStore.getState();
      if (message.senderId !== state.user?.id) {
        state.markUnread(message.ticketId);
        if (state.notificationsEnabled) {
          notify(message.senderName || 'New message', {
            body: message.text || message.originalText || '',
            tag: `msg-${message.ticketId}`,
          });
        }
        updateTitleBadge();
        s.emit('message:delivered', { ticketId: message.ticketId, messageId: message.id });
      }
    };

    const handleMessageStatus = ({ ticketId, messageId, status, timestamp }: { ticketId: string; messageId: string; status: string; timestamp: string }) => {
      const field = status === 'read' ? 'readAt' : 'deliveredAt';
      useStore.getState().updateMessageState(ticketId, messageId, { [field]: timestamp });
    };

    const handleTypingUpdate = ({ ticketId, senderName, typing }: { ticketId: string; senderName: string; typing: boolean }) => {
      setTyping(ticketId, senderName, typing);
    };

    const handleSupportOnline = (list: OnlineSupport[]) => {
      setOnlineSupportUsers(list);
    };

    const handleAgentStatus = ({ ticketId, agentId: _agentId, online }: { ticketId: string; agentId: string; online: boolean }) => {
      const state = useStore.getState();
      state.setParticipantOnline(ticketId, online);
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
    };

    const handleMessageEdited = ({ ticketId, messageId, text, editedAt }: { ticketId: string; messageId: string; text: string; editedAt: string }) => {
      useStore.getState().updateMessageState(ticketId, messageId, { text, originalText: text, editedAt });
    };

    const handleMessageDeleted = ({ ticketId, messageId, deletedAt }: { ticketId: string; messageId: string; deletedAt: string }) => {
      useStore.getState().updateMessageState(ticketId, messageId, { text: '', deletedAt });
    };

    const handleReactionUpdated = ({ ticketId, messageId, reactions }: { ticketId: string; messageId: string; reactions: Record<string, string[]> }) => {
      useStore.getState().updateMessageReaction(ticketId, messageId, reactions);
    };

    const handleRatingSaved = () => {
      useStore.getState().clearRatingPrompt();
    };

    const handleQueuePosition = ({ position, etaMins }: { position: number; etaMins: number }) => {
      useStore.getState().setQueuePosition({ position, etaMins });
    };

    const handleTicketClosed = ({ ticketId, supportId: eventSupportId, supportName: eventSupportName }: { ticketId: string; supportId?: string; supportName?: string }) => {
      updateTicket(ticketId, { status: 'closed' });
      const state = useStore.getState();
      if (state.user?.role === 'agent') {
        const ticket = state.tickets.find((t) => t.id === ticketId);
        if (ticket && ticket.agentId === state.user.id) {
          const supportId = eventSupportId || ticket.supportId;
          const supportName = eventSupportName || ticket.supportName;
          if (supportId && supportName) {
            state.setRatingPrompt({ ticketId, supportId, supportName });
          }
        }
      }
    };

    const handleTicketUpdated = ({ ticketId, ...updates }: { ticketId: string; [key: string]: unknown }) => {
      const allowed: (keyof Ticket)[] = ['status', 'agentId', 'department', 'closedAt', 'participants', 'slaBreached', 'priority', 'subject'];
      const safeUpdates: Partial<Ticket> = {};
      for (const key of allowed) {
        if (key in updates) {
          (safeUpdates as Record<string, unknown>)[key] = updates[key];
        }
      }
      updateTicket(ticketId, safeUpdates);
    };

    const handleTicketTransferred = ({ ticketId, toId, toName }: { ticketId: string; fromId: string; fromName: string; toId: string | null; toName: string | null }) => {
      if (toId) {
        updateTicket(ticketId, { supportId: toId, supportName: toName || undefined });
      } else {
        updateTicket(ticketId, { supportId: null as any, supportName: undefined, status: 'open' });
      }
    };

    const handleTicketAssigned = ({ ticketId, supportId, supportName }: { ticketId: string; supportId: string; supportName: string }) => {
      const state = useStore.getState();
      if (supportId === state.user?.id && state.notificationsEnabled) {
        notify(`Ticket assigned to you`, {
          body: `${supportName} — you have a new ticket`,
          tag: `assign-${ticketId}`,
        });
      }
    };

    const handleTicketLabelsUpdated = ({ ticketId, labels }: { ticketId: string; labels: string[] }) => {
      updateTicket(ticketId, { labels });
    };

    const handleLabelDeleted = ({ id }: { id: string }) => {
      useStore.getState().removeLabelGlobally(id);
    };

    const handleLabelCreated = (label: Label) => {
      useStore.getState().addLabelGlobally(label);
    };

    const handleHoursClosed = (payload?: { status?: BusinessHoursStatus }) => {
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
    };

    const handleTopicAlert = (alert: TopicAlert) => {
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
    };

    const handlePartnerDeactivated = ({ partnerId }: { partnerId: string }) => {
      const state = useStore.getState();
      const updatedMemberships = state.memberships.map(m =>
        m.partnerId === partnerId ? { ...m, status: 'inactive' as const } : m
      );
      state.setMemberships(updatedMemberships);
    };

    const handleUserDeactivated = ({ userId }: { userId: string }) => {
      const state = useStore.getState();
      if (state.user?.id === userId) {
        state.logout();
        window.location.href = '/';
      }
    };

    const handleAuthExpired = () => {
      const state = useStore.getState();
      if (state.user) {
        s.disconnect();
        s.connect();
      } else {
        state.logout();
      }
    };

    // Attach all listeners
    s.on('connect', handleConnect);
    s.on('disconnect', handleDisconnect);
    s.on('connect_error', handleConnectError);
    s.on('error', handleError);
    s.on('ticket:created', handleTicketCreated);
    s.on('ticket:created:self', handleTicketCreatedSelf);
    s.on('support:joined', handleSupportJoined);
    s.on('ticket:history', handleTicketHistory);
    s.on('message:new', handleMessageNew);
    s.on('message:status', handleMessageStatus);
    s.on('typing:update', handleTypingUpdate);
    s.on('support:online', handleSupportOnline);
    s.on('agent:status', handleAgentStatus);
    s.on('message:edited', handleMessageEdited);
    s.on('message:deleted', handleMessageDeleted);
    s.on('reaction:updated', handleReactionUpdated);
    s.on('rating:saved', handleRatingSaved);
    s.on('queue:position', handleQueuePosition);
    s.on('ticket:closed', handleTicketClosed);
    s.on('ticket:updated', handleTicketUpdated);
    s.on('ticket:transferred', handleTicketTransferred);
    s.on('ticket:assigned', handleTicketAssigned);
    s.on('ticket:labels:updated', handleTicketLabelsUpdated);
    s.on('label:deleted', handleLabelDeleted);
    s.on('label:created', handleLabelCreated);
    s.on('hours:closed', handleHoursClosed);
    s.on('topic:alert', handleTopicAlert);
    s.on('partner:deactivated', handlePartnerDeactivated);
    s.on('user:deactivated', handleUserDeactivated);
    s.on('auth:expired', handleAuthExpired);

    return () => {
      // Do NOT disconnect — socket is shared. Only remove our specific listeners.
      s.off('connect', handleConnect);
      s.off('disconnect', handleDisconnect);
      s.off('connect_error', handleConnectError);
      s.off('error', handleError);
      s.off('ticket:created', handleTicketCreated);
      s.off('ticket:created:self', handleTicketCreatedSelf);
      s.off('support:joined', handleSupportJoined);
      s.off('ticket:history', handleTicketHistory);
      s.off('message:new', handleMessageNew);
      s.off('message:status', handleMessageStatus);
      s.off('typing:update', handleTypingUpdate);
      s.off('support:online', handleSupportOnline);
      s.off('agent:status', handleAgentStatus);
      s.off('message:edited', handleMessageEdited);
      s.off('message:deleted', handleMessageDeleted);
      s.off('reaction:updated', handleReactionUpdated);
      s.off('rating:saved', handleRatingSaved);
      s.off('queue:position', handleQueuePosition);
      s.off('ticket:closed', handleTicketClosed);
      s.off('ticket:updated', handleTicketUpdated);
      s.off('ticket:transferred', handleTicketTransferred);
      s.off('ticket:assigned', handleTicketAssigned);
      s.off('ticket:labels:updated', handleTicketLabelsUpdated);
      s.off('label:deleted', handleLabelDeleted);
      s.off('label:created', handleLabelCreated);
      s.off('hours:closed', handleHoursClosed);
      s.off('topic:alert', handleTopicAlert);
      s.off('partner:deactivated', handlePartnerDeactivated);
      s.off('user:deactivated', handleUserDeactivated);
      s.off('auth:expired', handleAuthExpired);
      listenersAttached.current = false;
    };
  }, [addMessage, addTicket, setMessages, setOnlineSupportUsers, setTyping, updateTicket, setBusinessHoursStatus]);

  return getSocket();
}
