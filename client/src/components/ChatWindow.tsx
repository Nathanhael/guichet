import { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
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
  const { user, messages, messageCursors, setMessageLoading, participantsOnline, setParticipantOnline, tickets, setMessages, activePartnerId, focusMode } = useStoreShallow(s => ({
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
  }));
  const { role: activeRole } = usePartner();
  const [closing, setClosing] = useState(false);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [firstUnreadIndex, setFirstUnreadIndex] = useState<number | null>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [showTransferMenu, setShowTransferMenu] = useState(false);
  const [viewers, setViewers] = useState<Array<{ userId: string; userName: string }>>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

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
  const loadingRef = useRef(false);
  const prevScrollHeightRef = useRef<number | null>(null);

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
      // Server mapMessageRow type has minor structural diffs (e.g. nullable vs optional).
      // Single-cast boundary — fix here if types diverge.
      setMessages(ticketId, messageQuery.data.messages as Message[]);
    }
  }, [messageQuery.data, ticketId, setMessages]);

  // tRPC: AI Config (to show/hide Improve button and pass to MessageBubble)
  const aiConfigQuery = trpc.partner.getAiConfig.useQuery(undefined, {
    enabled: !!user,
    staleTime: 60_000,
  });
  const aiConfig = aiConfigQuery.data;

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

    // Only emit once socket is connected (identified), otherwise collision
    // detection silently fails because the server drops unidentified events.
    function emitViewing() {
      socket!.emit('ticket:viewing', { ticketId });
    }

    if (socket.connected) {
      emitViewing();
    } else {
      socket.once('connect', emitViewing);
    }

    return () => {
      socket.off('connect', emitViewing);
      if (ticketId) {
        socket.emit('ticket:left', { ticketId });
      }
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

  // Ctrl+F to open in-conversation search
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        setSearchOpen(true);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  function closeSearch() {
    setSearchOpen(false);
    setSearchQuery('');
    textareaRef.current?.focus();
  }

  const ticketMessages = ticket ? (messages[ticket.id] || []) : [];
  const agentIsOnline = ticket ? (participantsOnline[ticket.id] ?? true) : true;

  // Reset initial-scroll tracker when switching tickets
  useEffect(() => {
    if (!ticketId) return;
    initialScrollDoneRef.current = null;
    prevMessageCountRef.current = 0;
    setUnreadCount(0);
    setFirstUnreadIndex(null);
    setShowScrollButton(false);
    setSearchOpen(false);
    setSearchQuery('');
  }, [ticketId]);

  useEffect(() => {
    if (!ticketId) return;
    // Read fresh state from store to avoid stale closure over ticketMessages/user
    const currentMessages = useStore.getState().messages[ticketId] || [];
    const currentUserId = useStore.getState().user?.id;
    const count = currentMessages.length;
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

    const lastMsg = currentMessages[count - 1];
    if (isNearBottomRef.current || lastMsg?.senderId === currentUserId) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      setUnreadCount(0);
      setFirstUnreadIndex(null);

      const unreadIds = currentMessages
        .filter(m => m.senderId !== currentUserId && !m.readAt)
        .map(m => m.id);

      if (unreadIds.length > 0 && document.hasFocus()) {
        const socket = getSocket();
        if (socket) socket.emit('message:read', { ticketId, messageIds: unreadIds });
      }
    } else {
      setUnreadCount((prev) => prev + newMessages);
      setFirstUnreadIndex((prev) => {
        if (prev !== null) return prev;
        return count - newMessages;
      });
    }
  }, [ticketMessages.length, ticketMessages[ticketMessages.length - 1]?.id, ticketId, user?.id]);

  useEffect(() => {
    if (ticket?.status === 'closed') {
      // Rating prompt is handled centrally by useSocket.ts handleTicketClosed —
      // emitting it here as well caused double-triggers of the rating modal.
      if (onClose) {
        const timer = setTimeout(() => {
          onClose();
        }, 1000);
        return () => clearTimeout(timer);
      }
    }
  }, [ticket?.status, onClose, ticket?.id]);

  useEffect(() => {
    if (!ticketId) return;
    function onFocus() {
      const socket = getSocket();
      if (!socket) return;
      const currentMessages = useStore.getState().messages[ticketId] || [];
      const currentUserId = useStore.getState().user?.id;
      const unreadIds = currentMessages
        .filter(m => m.senderId !== currentUserId && !m.readAt)
        .map(m => m.id);

      if (unreadIds.length > 0) {
        socket.emit('message:read', { ticketId, messageIds: unreadIds });
        setUnreadCount(0);
        setFirstUnreadIndex(null);
      }
    }
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [ticketId]);

  if (!ticket) return null;

  const liveTicket = tickets.find(t => t.id === ticket.id) || ticket;

  // Pagination cursor for the current ticket
  const cursorInfo = ticket ? messageCursors[ticket.id] : undefined;

  const loadOlderMessages = useCallback(() => {
    // Derive ticketId from store to avoid stale closure when ticket prop
    // changes faster than React can rebuild this callback.
    const currentTicketId = ticket?.id || '';
    const cursor = useStore.getState().messageCursors[currentTicketId];
    if (!currentTicketId || !cursor?.hasMore || loadingRef.current || !cursor?.nextCursor) return;
    const socket = getSocket();
    if (!socket) return;
    loadingRef.current = true;
    setMessageLoading(currentTicketId, true);

    // Record scroll height before prepend so we can preserve position
    const el = scrollContainerRef.current;
    if (el) prevScrollHeightRef.current = el.scrollHeight;

    socket.emit('message:loadMore', {
      ticketId: currentTicketId,
      cursor: cursor.nextCursor,
    });
  }, [ticket?.id, setMessageLoading]);

  // Reset loading ref when server responds and preserve scroll position
  useEffect(() => {
    if (!cursorInfo?.loading) {
      loadingRef.current = false;

      // Restore scroll position after older messages are prepended
      if (prevScrollHeightRef.current !== null) {
        const el = scrollContainerRef.current;
        if (el) {
          const newScrollHeight = el.scrollHeight;
          el.scrollTop += newScrollHeight - prevScrollHeightRef.current;
        }
        prevScrollHeightRef.current = null;
      }
    }
  }, [cursorInfo?.loading]);

  // Track scroll position
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    isNearBottomRef.current = nearBottom;
    setShowScrollButton(!nearBottom);
    if (nearBottom) {
      setUnreadCount(0);
      setFirstUnreadIndex(null);
    }

    // Load older messages when scrolled to top
    if (el.scrollTop < 50) {
      loadOlderMessages();
    }
  }, [loadOlderMessages]);

  function scrollToBottom() {
    const el = scrollContainerRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setUnreadCount(0);
    setFirstUnreadIndex(null);
    setShowScrollButton(false);
  }

  const isOwnTicket = ticket?.agentId === user?.id;
  const canClose = isSupportLike(activeRole) || isOwnTicket;
  const isClosed = ticket.status === 'closed' || ticket.status === 'resolved';

  function closeTicket() {
    if (closing) return;
    const socket = getSocket();
    if (!socket) return;
    setClosing(true);

    socket.emit('ticket:close', {
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
    const socket = getSocket();
    if (!socket) return;
    socket.emit('ticket:transfer', {
      ticketId: ticket!.id,
      departmentId: departmentId || undefined,
      note: note || undefined,
    });
    setShowTransferMenu(false);
    if (onClose) onClose();
  }

  return (
    <div className="relative flex flex-col h-full bg-bg-surface border-2 border-border-heavy flex-1 min-h-0 overflow-hidden">
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
        viewers={viewers}
        closing={closing}
        canClose={canClose}
        agentIsOnline={agentIsOnline}
        onCloseTicket={closeTicket}
        onOpenSearch={() => setSearchOpen(true)}
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
        unreadCount={unreadCount}
        firstUnreadIndex={firstUnreadIndex}
        showScrollButton={showScrollButton}
        onScrollToBottom={scrollToBottom}
        onReply={(msg) => setReplyingTo(msg)}
        searchOpen={searchOpen}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        onSearchClose={closeSearch}
      />

      {/* Input */}
      <ComposeArea
        ref={composeRef}
        ticket={ticket}
        isClosed={isClosed}
        isSupport={isSupport}
        textareaRef={textareaRef}
        replyingTo={replyingTo}
        onClearReply={() => setReplyingTo(null)}
      />
    </div>
  );
});

export default ChatWindow;
