import React, { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import useStore, { useStoreShallow } from '../store/useStore';
import { getSocket } from '../hooks/useSocket';
import { useT } from '../i18n';
import MessageBubble from './MessageBubble';
// DISABLED_FEATURE: import CannedResponsePicker from './CannedResponsePicker';
import { Ticket, Message } from '../types';
import type { ChatWindowHandle } from '../types/command';
import { trpc } from '../utils/trpc';

import { isSupportLike } from '../utils/roles';
import { usePartner } from '../hooks/usePartner';
import { ChatHeader } from './chat';

interface ChatWindowProps {
  ticket?: Ticket;
  onClose?: () => void;
  compact?: boolean;
}

const ChatWindow = forwardRef<ChatWindowHandle, ChatWindowProps>(function ChatWindow({ ticket, onClose, compact }, ref) {
  const { user, messages, messageCursors, setMessageLoading, participantsOnline, setParticipantOnline, tickets, setMessages, activePartnerId, focusMode, typingUsers, setRatingPrompt } = useStoreShallow(s => ({
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
    typingUsers: s.typingUsers,
    setRatingPrompt: s.setRatingPrompt,
  }));
  const t = useT();
  const { role: activeRole } = usePartner();
  const [text, setText] = useState('');
  const [closing, setClosing] = useState(false);
  const [whisperMode, setWhisperMode] = useState(false);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // CR-10: Revoke Object URL to prevent memory leaks
  useEffect(() => {
    return () => {
      if (mediaPreview) URL.revokeObjectURL(mediaPreview);
    };
  }, [mediaPreview]);
  // Tracks unread message count — setUnreadCount is active, value reserved for future unread badge UI
  const [_unreadCount, setUnreadCount] = useState(0);
  // DISABLED_FEATURE: const [showCannedPicker, setShowCannedPicker] = useState(false);
  const [showTransferMenu, setShowTransferMenu] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [originalText, setOriginalText] = useState<string | null>(null);
  const [improving, setImproving] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [viewers, setViewers] = useState<Array<{ userId: string; userName: string }>>([]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const autoResize = () => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
  };

  // Expose minimal imperative handle for command palette actions
  useImperativeHandle(ref, () => ({
    focusTextarea: () => textareaRef.current?.focus(),
    toggleWhisper: () => setWhisperMode((v) => !v),
    openTransferMenu: () => setShowTransferMenu(true),
    triggerCloseTicket: () => {
      if (onClose) onClose();
    },
  }), [onClose]);

  const bottomRef = useRef<HTMLDivElement>(null);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isTypingRef = useRef(false);
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

  const improveMutation = trpc.ai.improveMessage.useMutation();
  const improvementMode = aiConfig?.messageImprovement ?? 'off';

  async function handleImprove() {
    if (improving || text.trim().length < 10) return;
    setImproving(true);
    setOriginalText(text);
    try {
      const result = await improveMutation.mutateAsync({
        text: text.trim(),
        role: isSupport ? 'support' : 'agent',
      });
      setText(result.improved);
    } catch {
      // On failure, keep original text
      setOriginalText(null);
    } finally {
      setImproving(false);
    }
  }

  function revertImprove() {
    if (originalText !== null) {
      setText(originalText);
      setOriginalText(null);
    }
  }

  /** For 'forced' mode: improve text before sending, then send. */
  async function improveAndSend() {
    if (improving) return;
    const trimmed = text.trim();
    if (!trimmed && !mediaUrl) return;

    // Only improve if text is long enough and not already improved
    if (trimmed.length >= 10 && originalText === null) {
      setImproving(true);
      try {
        const result = await improveMutation.mutateAsync({
          text: trimmed,
          role: isSupport ? 'support' : 'agent',
        });
        // Send the improved version directly
        doSend(result.improved);
      } catch {
        // On AI failure, send original text (graceful degradation)
        doSend(trimmed);
      } finally {
        setImproving(false);
      }
    } else {
      doSend(trimmed);
    }
  }

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

  function emitTyping() {
    if (!isTypingRef.current) {
      isTypingRef.current = true;
      getSocket().emit('typing:start', { ticketId: ticket!.id, senderName: user?.name });
    }
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      isTypingRef.current = false;
      getSocket().emit('typing:stop', { ticketId: ticket!.id, senderName: user?.name });
    }, 2000);
  }

  function stopTyping() {
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    if (isTypingRef.current) {
      isTypingRef.current = false;
      getSocket().emit('typing:stop', { ticketId: ticket!.id, senderName: user?.name });
    }
  }

  async function uploadFile(file: File) {
    setMediaPreview(URL.createObjectURL(file));
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/v1/uploads', {
        method: 'POST',
        credentials: 'include',
        body: form
      });
      const data = await res.json();
      if (!res.ok) {
        console.error('Upload failed:', data.error || 'Unknown error');
        clearMedia();
        return;
      }
      setMediaUrl(data.url);
    } catch {
      clearMedia();
    } finally {
      setUploading(false);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    uploadFile(file);
  }

  function handlePaste(e: React.ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) uploadFile(file);
        break;
      }
    }
  }

  function clearMedia() {
    if (mediaPreview) URL.revokeObjectURL(mediaPreview);
    setMediaUrl(null);
    setMediaPreview(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  /** Core send logic — emits socket event with the given text. */
  function doSend(finalText: string) {
    // Capture mediaUrl before clearing — must be in scope for both optimistic + socket emit
    const currentMediaUrl = mediaUrl;
    const display = finalText || (currentMediaUrl ? '[attachment]' : '');

    // Don't send completely empty messages (no text, no media)
    if (!display && !currentMediaUrl) return;

    const optimisticMsg: Message = {
      id: `pending-${ticket!.id}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      ticketId: ticket!.id,
      senderId: user?.id || '',
      senderName: user?.name || '',
      senderRole: user?.role || 'agent',
      senderLang: user?.lang || 'en',
      originalText: display,
      improvedText: display,
      processedText: display,
      text: display,
      mediaUrl: currentMediaUrl || undefined,
      whisper: whisperMode,
      system: 0,
      translationSkipped: 1,
      fallback: 0,
      timestamp: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      reactions: {},
      pending: true,
    };
    useStore.getState().addMessage(ticket!.id, optimisticMsg);

    getSocket().emit('message:send', {
      ticketId: ticket!.id,
      senderLang: user?.lang,
      text: display,
      mediaUrl: currentMediaUrl,
      whisper: whisperMode,
    });
    setText('');
    setOriginalText(null);
    clearMedia();
    stopTyping();
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }

  function sendMessage(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (uploading) return; // Wait for upload to finish
    const trimmed = text.trim();
    if (!trimmed && !mediaUrl) return;

    // Prevent double-send: capture and clear media immediately
    const hasMedia = !!mediaUrl;

    // In 'forced' mode, auto-improve before sending
    if (improvementMode === 'forced' && trimmed.length >= 10 && originalText === null) {
      improveAndSend();
      return;
    }

    doSend(trimmed);
    // Guard: if we had no text and no media was captured, something went wrong
    if (!trimmed && !hasMedia) return;
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
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll} 
        className={`flex-1 overflow-y-auto p-6 scrollbar-thin relative bg-bg-surface`}
      >
        <div className="space-y-1 mb-8">
          {cursorInfo?.hasMore && (
            <div className="flex justify-center py-2">
              {cursorInfo.loading ? (
                <span className="text-xs font-mono text-text-secondary">Loading...</span>
              ) : (
                <button
                  onClick={loadOlderMessages}
                  className="text-xs font-mono text-text-secondary hover:text-text-primary transition-colors"
                >
                  Load older messages
                </button>
              )}
            </div>
          )}
          {ticketMessages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 opacity-40">
              <svg className="w-12 h-12 text-text-primary opacity-40 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.855-1.246L3 20l1.226-3.746A9.233 9.233 0 013 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              <p className="text-sm font-medium tracking-wide italic">{t('no_messages')}</p>
            </div>
          )}
          {ticketMessages.map((msg, idx) => {
            const prevMsg = ticketMessages[idx - 1];
            const nextMsg = ticketMessages[idx + 1];

            const isSameSenderAsPrev = prevMsg && prevMsg.senderId === msg.senderId && !prevMsg.system && !msg.system;
            const isSameSenderAsNext = nextMsg && nextMsg.senderId === msg.senderId && !nextMsg.system && !msg.system;

            // Grouping logic: same sender and within 2 minutes
            const timeDiffPrev = prevMsg ? (new Date(msg.timestamp).getTime() - new Date(prevMsg.timestamp).getTime()) : 0;
            const timeDiffNext = nextMsg ? (new Date(nextMsg.timestamp).getTime() - new Date(msg.timestamp).getTime()) : 0;

            const isGroupStart = !isSameSenderAsPrev || timeDiffPrev > 120000;
            const isGroupEnd = !isSameSenderAsNext || timeDiffNext > 120000;

            return (
              <MessageBubble
                key={msg.id}
                message={msg}
                ticketId={ticket.id}
                isGroupStart={isGroupStart}
                isGroupEnd={isGroupEnd}
                aiConfig={aiConfigQuery.data}
              />
            );
          })}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Typing indicator */}
      {(() => {
        const ticketTyping = typingUsers[ticket.id] || {};
        const typers = Object.keys(ticketTyping).filter(name => ticketTyping[name] && name !== user?.name);
        if (typers.length === 0) return null;
        return (
          <div className="px-6 py-1.5 text-[11px] font-bold text-text-primary opacity-40 bg-bg-surface border-t border-border">
            <span className="inline-flex items-center gap-1.5">
              <span className="flex gap-0.5">
                <span className="w-1 h-1 bg-text-primary rounded-full" style={{ animationDelay: '0ms' }} />
                <span className="w-1 h-1 bg-text-primary rounded-full" style={{ animationDelay: '150ms' }} />
                <span className="w-1 h-1 bg-text-primary rounded-full" style={{ animationDelay: '300ms' }} />
              </span>
              {typers.length === 1
                ? `${typers[0]} ${t('is_typing') || 'is typing...'}`
                : `${typers.join(', ')} ${t('are_typing') || 'are typing...'}`
              }
            </span>
          </div>
        );
      })()}

      {/* Input */}
      {!isClosed && (
        <form onSubmit={sendMessage} className={`border-t-2 p-4 pb-6 ${whisperMode
          ? 'bg-bg-elevated border-border-heavy'
          : 'bg-bg-surface border-border-heavy'
          }`}>
          <div className="w-full">
            {whisperMode && (
            <div className="flex items-center gap-2 mb-3">
              <div className="px-2 py-0.5 bg-accent-blue text-[var(--color-btn-text-inverse)] text-[9px] font-bold uppercase tracking-widest">Whisper</div>
              <p className="text-[10px] text-text-primary font-bold uppercase tracking-tight opacity-80">
                {t('whisper_hint')}
              </p>
            </div>
            )}

            {/* AI improved — revert bar */}
            {originalText !== null && (
              <div className="flex items-center justify-between mb-2 px-3 py-1.5 bg-bg-elevated border border-border-heavy">
                <span className="text-[10px] font-bold text-text-primary uppercase tracking-wider flex items-center gap-1.5">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                  </svg>
                  AI improved
                </span>
                <button
                  type="button"
                  onClick={revertImprove}
                  className="text-[10px] font-bold text-text-primary hover:opacity-60 underline underline-offset-2"
                >
                  Revert to original
                </button>
              </div>
            )}

            {/* Media preview strip */}
            {mediaPreview && (() => {
              const isImagePreview = mediaPreview.startsWith('blob:') || mediaPreview.startsWith('data:image');
              const fileName = fileRef.current?.files?.[0]?.name;
              const ext = fileName?.split('.').pop()?.toLowerCase() || '';
              const fileLabel = ext === 'pdf' ? 'PDF' : ext === 'docx' || ext === 'doc' ? 'Word' : ext === 'xlsx' || ext === 'xls' ? 'Excel' : ext === 'csv' ? 'CSV' : ext === 'txt' ? 'Text' : 'File';
              return (
              <div className="flex items-center gap-3 mb-2 p-2 bg-bg-elevated border border-border">
                <div className="relative shrink-0">
                  {isImagePreview ? (
                    <img src={mediaPreview} alt="Preview" className="h-16 w-16 object-cover border border-border" />
                  ) : (
                    <div className="h-16 w-16 flex flex-col items-center justify-center border border-border bg-bg-surface">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-accent-blue" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                      </svg>
                      <span className="text-[8px] font-mono font-bold text-text-muted mt-0.5">{ext.toUpperCase()}</span>
                    </div>
                  )}
                  {uploading && (
                    <div className="absolute inset-0 bg-bg-base/70 flex items-center justify-center">
                      <svg className="animate-spin h-4 w-4 text-text-primary" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={clearMedia}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 flex items-center justify-center bg-bg-surface border border-border text-text-muted hover:text-accent-red text-[10px]"
                    title="Remove"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-text-muted">
                    {uploading ? 'Uploading...' : fileName ? `${fileLabel} attached` : 'File attached'}
                  </span>
                  {fileName && <span className="text-[9px] font-mono text-text-muted opacity-60 truncate">{fileName}</span>}
                  <span className="text-[9px] text-text-muted opacity-40">
                    Add a message or press Enter to send
                  </span>
                </div>
              </div>);
            })()}

            <div className={`flex items-center gap-3 p-1.5 border-2 ${
              whisperMode
                ? 'bg-bg-surface border-border-heavy'
                : 'bg-bg-elevated border-border-heavy'
            }`}>
            <div className="flex items-center self-center px-1">
              {isSupport && (
                <button
                  type="button"
                  onClick={() => setWhisperMode((v) => !v)}
                  aria-label={t('whisper_mode') || 'Toggle whisper mode'}
                  title={t('whisper_mode')}
                  className={`w-10 h-10 flex items-center justify-center ${whisperMode
                    ? 'bg-accent-blue text-[var(--color-btn-text-inverse)]'
                    : 'text-text-primary opacity-40 hover:opacity-100'
                    }`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268-2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                  </svg>
                </button>
              )}

              <label className="w-10 h-10 flex items-center justify-center text-text-primary opacity-40 hover:opacity-100 cursor-pointer" title="Attach file">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
                  aria-label="Attach file"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </label>

              {/* Emoji picker */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                  className="w-10 h-10 flex items-center justify-center text-text-primary opacity-40 hover:opacity-100"
                  title="Emoji"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.182 15.182a4.5 4.5 0 01-6.364 0M21 12a9 9 0 11-18 0 9 9 0 0118 0zM9.75 9.75c0 .414-.168.75-.375.75S9 10.164 9 9.75 9.168 9 9.375 9s.375.336.375.75zm-.375 0h.008v.015h-.008V9.75zm5.625 0c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75zm-.375 0h.008v.015h-.008V9.75z" />
                  </svg>
                </button>
                {showEmojiPicker && (
                  <div className="absolute bottom-full left-0 mb-2 bg-bg-surface border-2 border-border-heavy z-50 p-2 w-[280px]">
                    <div className="grid grid-cols-8 gap-0.5">
                      {['😀','😂','🙂','😊','😍','😎','🤔','😅','😢','😤','👋','🙏','👍','👎','👏','❤️','🔥','⭐','✅','🎉','💡','⚠️','💬','📎'].map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => {
                            const ta = textareaRef.current;
                            if (ta) {
                              const start = ta.selectionStart;
                              const end = ta.selectionEnd;
                              const newText = text.slice(0, start) + emoji + text.slice(end);
                              setText(newText);
                              setShowEmojiPicker(false);
                              setTimeout(() => { ta.focus(); ta.selectionStart = ta.selectionEnd = start + emoji.length; }, 0);
                            } else {
                              setText(text + emoji);
                              setShowEmojiPicker(false);
                            }
                          }}
                          className="w-8 h-8 flex items-center justify-center text-lg hover:bg-bg-elevated"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="relative flex-1">
              {/* DISABLED_FEATURE: CannedResponsePicker removed until production-ready */}
              <textarea
                ref={textareaRef}
                aria-label="Type a message"
                value={text}
                onChange={(e) => {
                  const val = e.target.value;
                  setText(val);
                  // DISABLED_FEATURE: canned picker "/" trigger removed until production-ready
                  emitTyping();
                  autoResize();
                }}
                onKeyDown={(e) => {
                  // DISABLED_FEATURE: canned picker key guard removed until production-ready
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
                }}
                onPaste={handlePaste}
                placeholder={uploading ? 'Uploading image...' : mediaUrl ? 'Add a message or press Enter to send' : t('type_message')}
                rows={1}
                className="w-full resize-none bg-transparent border-none py-3 px-2 text-[15px] focus:ring-0 text-text-primary placeholder:opacity-30 scrollbar-none overflow-hidden"
              />
            </div>

            {/* AI Improve button — only in 'optional' mode */}
            {improvementMode === 'optional' && text.trim().length >= 10 && !originalText && (
              <button
                type="button"
                onClick={handleImprove}
                disabled={improving}
                aria-label="Improve message"
                title="AI: Improve message"
                className="w-10 h-10 flex items-center justify-center text-text-primary opacity-40 hover:opacity-100 disabled:opacity-30"
              >
                {improving ? (
                  <span className="text-[10px] font-bold opacity-40">...</span>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
                  </svg>
                )}
              </button>
            )}

            <button
              type="submit"
              disabled={uploading || improving || (!text.trim() && !mediaUrl)}
              className="bg-accent-blue text-[var(--color-btn-text-inverse)] w-10 h-10 flex items-center justify-center disabled:opacity-30"
              title={improvementMode === 'forced' ? 'AI will improve before sending' : undefined}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 rotate-90" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
              </svg>
            </button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
});

export default ChatWindow;
