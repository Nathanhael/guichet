import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import useStore, { useStoreShallow } from '../store/useStore';
import { getSocket } from '../hooks/useSocket';
import { Ticket, Message } from '../types';
import type { ChatWindowHandle } from '../types/command';
import { trpc } from '../utils/trpc';

import { isSupportLike } from '../utils/roles';
import { usePartner } from '../hooks/usePartner';
import { ChatHeader, MessageList, ComposeArea } from './chat';
import type { ComposeAreaHandle } from './chat';

interface ChatWindowProps {
  ticket?: Ticket;
  onClose?: () => void;
  compact?: boolean;
}

const ChatWindow = forwardRef<ChatWindowHandle, ChatWindowProps>(function ChatWindow({ ticket, onClose, compact }, ref) {
  const { user, messages, messageCursors, setMessageLoading, participantsOnline, setParticipantOnline, tickets, setMessages, activePartnerId, focusMode, setRatingPrompt } = useStoreShallow(s => ({
    user: s.user,
    messages: s.messages,
    messageCursors: s.messageCursors,
    setMessageLoading: s.setMessageLoading,
    participantsOnline: s.participantsOnline,
    setParticipantOnline: s.setParticipantOnline,
    tickets: s.tickets,
    setMessages: s.setMessages,
    activePartnerId: s.activePartnerId,
    focusMode: s.focusMode,
    setRatingPrompt: s.setRatingPrompt,
  }));
  const { role: activeRole } = usePartner();
  const [closing, setClosing] = useState(false);
  // Tracks unread message count — setUnreadCount is active, value reserved for future unread badge UI
  const [_unreadCount, setUnreadCount] = useState(0);
  // DISABLED_FEATURE: const [showCannedPicker, setShowCannedPicker] = useState(false);
  const [showTransferMenu, setShowTransferMenu] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [viewers, setViewers] = useState<Array<{ userId: string; userName: string }>>([]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composeRef = useRef<ComposeAreaHandle>(null);

  // Expose minimal imperative handle for command palette actions
  useImperativeHandle(ref, () => ({
    focusTextarea: () => textareaRef.current?.focus(),
    toggleWhisper: () => composeRef.current?.toggleWhisper(),
    openTransferMenu: () => setShowTransferMenu(true),
    triggerCloseTicket: () => {
      if (onClose) onClose();
    },
  }), [onClose]);

  const bottomRef = useRef<HTMLDivElement>(null);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const prevMessageCountRef = useRef(0);
  const initialScrollDoneRef = useRef<string | null>(null);

  const isSupport = isSupportLike(activeRole);
  const ticketId = ticket?.id ?? '';

  // tRPC: Message History
  const messageQuery = trpc.message.list.useQuery(
    { ticketId },
    {
      enabled: !!ticketId,
    }
  );

  useEffect(() => {
    if (messageQuery.data && ticketId) {
      // tRPC infers server mapMessageRow return type which differs slightly from client Message interface
      // (e.g. optional text field presence). Runtime data is compatible.
      setMessages(ticketId, messageQuery.data.messages as unknown as Message[]);
    }
  }, [messageQuery.data, ticketId, setMessages]);

  // tRPC: AI Config (to show/hide Improve button and pass to MessageBubble)
  const aiConfigQuery = trpc.partner.getAiConfig.useQuery(undefined, {
    enabled: !!user,
    staleTime: 60_000,
  });
  const aiConfig = aiConfigQuery.data;

  // tRPC: Chat Summarization
  const summarizeMutation = trpc.ai.summarizeChat.useMutation();
  const canSummarize = isSupport && aiConfig?.chatSummarization === true;

  async function handleSummarize(refresh = false) {
    if (summarizing || !ticketId) return;
    setSummarizing(true);
    try {
      const result = await summarizeMutation.mutateAsync({ ticketId, refresh });
      setSummary(result.summary);
      setShowSummary(true);
    } catch {
      // Silently fail
    } finally {
      setSummarizing(false);
    }
  }

  // tRPC: Agent Presence
  const presenceQuery = trpc.presence.getOnlineStatus.useQuery(
    { userId: ticket?.agentId || '', partnerId: activePartnerId || '' },
    {
      enabled: isSupport && !!ticket?.agentId && ticket?.status !== 'closed' && !!activePartnerId,
      refetchInterval: 10000, // Check every 10s
    }
  );

  useEffect(() => {
    if (presenceQuery.data && ticketId) {
      setParticipantOnline(ticketId, presenceQuery.data.online);
    }
  }, [presenceQuery.data, ticketId, setParticipantOnline]);

  // ── Collision Detection: emit viewing/left events ──────────────────────────
  useEffect(() => {
    if (!ticketId) return;
    const socket = getSocket();
    if (!socket) return;

    socket.emit('ticket:viewing', { ticketId });

    return () => {
      socket.emit('ticket:left', { ticketId });
    };
  }, [ticketId]);

  // ── Collision Detection: listen for viewer updates ────────────────────────
  useEffect(() => {
    if (!ticketId) return;
    const socket = getSocket();
    if (!socket) return;

    const currentUserId = user?.id;

    function handleViewers({ ticketId: tid, viewers: v }: { ticketId: string; viewers: Array<{ userId: string; userName: string }> }) {
      if (tid === ticketId) {
        const others = v.filter((viewer) => viewer.userId !== currentUserId);
        setViewers(others);
      }
    }

    socket.on('ticket:viewers', handleViewers);
    return () => {
      socket.off('ticket:viewers', handleViewers);
      setViewers([]);
    };
  }, [ticketId, user?.id]);

  const ticketMessages = ticket ? (messages[ticket.id] || []) : [];
  const agentIsOnline = ticket ? (participantsOnline[ticket.id] ?? true) : true;

  // Reset initial-scroll tracker when switching tickets
  useEffect(() => {
    if (!ticketId) return;
    initialScrollDoneRef.current = null;
    prevMessageCountRef.current = 0;
    setUnreadCount(0);
  }, [ticketId]);

  useEffect(() => {
    if (!ticketId) return;
    const count = ticketMessages.length;
    if (count === 0) return;

    if (initialScrollDoneRef.current !== ticketId) {
      initialScrollDoneRef.current = ticketId;
      prevMessageCountRef.current = count;
      requestAnimationFrame(() => {
        const el = scrollContainerRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
      return;
    }

    const newMessages = count - prevMessageCountRef.current;
    prevMessageCountRef.current = count;

    if (newMessages <= 0) return;

    const lastMsg = ticketMessages[count - 1];
    if (isNearBottomRef.current || lastMsg?.senderId === user?.id) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      setUnreadCount(0);

      const unreadIds = ticketMessages
        .filter(m => m.senderId !== user?.id && !m.readAt)
        .map(m => m.id);

      if (unreadIds.length > 0 && document.hasFocus()) {
        getSocket().emit('message:read', { ticketId, messageIds: unreadIds });
      }
    } else {
      setUnreadCount((prev) => prev + newMessages);
    }
  }, [ticketMessages.length, ticketId, user?.id]);

  useEffect(() => {
    if (ticket?.status === 'closed') {
      // Auto-prompt rating for agents (not support) when ticket is closed
      if (!isSupport && ticket.supportId && ticket.supportName) {
        setRatingPrompt({
          ticketId: ticket.id,
          supportId: ticket.supportId,
          supportName: ticket.supportName,
        });
      }
      if (onClose) {
        const timer = setTimeout(() => {
          onClose();
        }, 1000);
        return () => clearTimeout(timer);
      }
    }
  }, [ticket?.status, onClose, isSupport, ticket?.id, ticket?.supportId, ticket?.supportName, setRatingPrompt]);

  useEffect(() => {
    if (!ticketId) return;
    function onFocus() {
      const currentMessages = useStore.getState().messages[ticketId] || [];
      const currentUserId = useStore.getState().user?.id;
      const unreadIds = currentMessages
        .filter(m => m.senderId !== currentUserId && !m.readAt)
        .map(m => m.id);

      if (unreadIds.length > 0) {
        getSocket().emit('message:read', { ticketId, messageIds: unreadIds });
        setUnreadCount(0);
      }
    }
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [ticketId]);

  if (!ticket) return null;

  const liveTicket = tickets.find(t => t.id === ticket.id) || ticket;

  // Pagination cursor for the current ticket
  const cursorInfo = ticket ? messageCursors[ticket.id] : undefined;

  function loadOlderMessages() {
    if (!ticket || !cursorInfo?.hasMore || cursorInfo?.loading || !cursorInfo?.nextCursor) return;
    setMessageLoading(ticket.id, true);
    getSocket().emit('message:loadMore', {
      ticketId: ticket.id,
      cursor: cursorInfo.nextCursor,
    });
  }

  // Track scroll position
  function handleScroll() {
    const el = scrollContainerRef.current;
    if (!el) return;
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (isNearBottomRef.current) setUnreadCount(0);

    // Load older messages when scrolled to top
    if (el.scrollTop < 50) {
      loadOlderMessages();
    }
  }

  function closeTicket() {
    if (closing) return;
    setClosing(true);

    getSocket().emit('ticket:close', {
      ticketId: ticket!.id,
      closingNotes: '',
    });

    // Optimistically update ticket status so UI reacts immediately
    // (agent may not be in the socket room to receive ticket:closed broadcast)
    useStore.getState().updateTicket(ticket!.id, { status: 'closed' });

    // For agents: immediately navigate away so they can create a new ticket
    if (isOwnTicket && onClose) {
      onClose();
      return;
    }

    setTimeout(() => {
      setClosing(false);
    }, 10000);
  }

  function transferTicket(departmentId?: string, note?: string) {
    getSocket().emit('ticket:transfer', {
      ticketId: ticket!.id,
      departmentId: departmentId || undefined,
      note: note || undefined,
    });
    setShowTransferMenu(false);
    if (onClose) onClose();
  }

  const isOwnTicket = ticket?.agentId === user?.id;
  const canClose = isSupportLike(activeRole) || isOwnTicket;
  const isClosed = ticket.status === 'closed' || ticket.status === 'resolved';

  return (
    <div className={`relative flex flex-col h-full bg-bg-surface border-2 border-border-heavy flex-1 min-h-0 overflow-hidden`}>
      <ChatHeader
        ticket={ticket}
        liveTicket={liveTicket}
        isSupport={isSupport}
        isClosed={isClosed}
        focusMode={focusMode}
        compact={!!compact}
        onClose={onClose}
        showTransferMenu={showTransferMenu}
        setShowTransferMenu={setShowTransferMenu}
        onTransfer={transferTicket}
        summary={summary}
        showSummary={showSummary}
        summarizing={summarizing}
        onSummarize={handleSummarize}
        onDismissSummary={() => setShowSummary(false)}
        viewers={viewers}
        closing={closing}
        canClose={canClose}
        canSummarize={canSummarize}
        agentIsOnline={agentIsOnline}
        onCloseTicket={closeTicket}
      />

      {/* Messages */}
      <MessageList
        ticket={ticket}
        messages={ticketMessages}
        cursorInfo={cursorInfo}
        onLoadOlder={loadOlderMessages}
        scrollContainerRef={scrollContainerRef}
        bottomRef={bottomRef}
        onScroll={handleScroll}
        aiConfig={aiConfig}
      />

      {/* Input */}
      <ComposeArea
        ref={composeRef}
        ticket={ticket}
        isClosed={isClosed}
        isSupport={isSupport}
        textareaRef={textareaRef}
      />
    </div>
  );
});

export default ChatWindow;
