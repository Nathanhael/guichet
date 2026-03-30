import React, { useState, useRef, useEffect } from 'react';
import useStore, { useStoreShallow } from '../store/useStore';
import { getSocket } from '../hooks/useSocket';
import { useT } from '../i18n';
import MessageBubble from './MessageBubble';
import CannedResponsePicker from './CannedResponsePicker';
import { Ticket, Message } from '../types';
import { trpc } from '../utils/trpc';
import { LANG_FLAG } from '../constants';
import { isSupportLike } from '../utils/roles';
import { Eye } from 'lucide-react';
import SlaIndicator from './SlaIndicator';

interface ChatWindowProps {
  ticket?: Ticket;
  onClose?: () => void;
  onFocus?: () => void;
  focused?: boolean;
}

export default function ChatWindow({ ticket, onClose, onFocus, focused }: ChatWindowProps) {
  const { user, messages, messageCursors, setMessageLoading, participantsOnline, setParticipantOnline, tickets, allLabels, setMessages, activePartnerId, focusMode, typingUsers, onlineSupportUsers, setRatingPrompt } = useStoreShallow(s => ({
    user: s.user,
    messages: s.messages,
    messageCursors: s.messageCursors,
    setMessageLoading: s.setMessageLoading,
    participantsOnline: s.participantsOnline,
    setParticipantOnline: s.setParticipantOnline,
    tickets: s.tickets,
    allLabels: s.allLabels,
    setMessages: s.setMessages,
    activePartnerId: s.activePartnerId,
    focusMode: s.focusMode,
    typingUsers: s.typingUsers,
    onlineSupportUsers: s.onlineSupportUsers,
    setRatingPrompt: s.setRatingPrompt,
  }));
  const t = useT();
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
  // TODO: _unreadCount value is never read — only setUnreadCount is used. Wire up unread badge UI or remove.
  const [_unreadCount, setUnreadCount] = useState(0);
  const [showCannedPicker, setShowCannedPicker] = useState(false);
  const [showTransferMenu, setShowTransferMenu] = useState(false);
  const [originalText, setOriginalText] = useState<string | null>(null);
  const [improving, setImproving] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [viewers, setViewers] = useState<Array<{ userId: string; userName: string }>>([]);

  const bottomRef = useRef<HTMLDivElement>(null);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isTypingRef = useRef(false);
  const isNearBottomRef = useRef(true);
  const prevMessageCountRef = useRef(0);
  const labelsMenuRef = useRef<HTMLDivElement>(null);
  const initialScrollDoneRef = useRef<string | null>(null);

  const isSupport = isSupportLike(user?.role);
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

  // Handle outside click for labels menu
  useEffect(() => {
    function onOutsideClick(e: MouseEvent) {
      if (labelsMenuRef.current && !labelsMenuRef.current.contains(e.target as Node)) {
        // setShowLabelsMenu(false);
      }
    }
    document.addEventListener('mousedown', onOutsideClick, true);
    return () => document.removeEventListener('mousedown', onOutsideClick, true);
  }, []);

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
      const unreadIds = ticketMessages
        .filter(m => m.senderId !== user?.id && !m.readAt)
        .map(m => m.id);

      if (unreadIds.length > 0) {
        getSocket().emit('message:read', { ticketId, messageIds: unreadIds });
        setUnreadCount(0);
      }
    }
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [ticketMessages, ticketId, user?.id]);

  if (!ticket) return null;

  const liveTicket = tickets.find(t => t.id === ticket.id) || ticket;

  const getLabelInfo = (id: string) => (allLabels || []).find((l) => l.id === id);

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
    const display = finalText || '📎';

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
      mediaUrl: mediaUrl || undefined,
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
      mediaUrl,
      whisper: whisperMode,
    });
    setText('');
    setOriginalText(null);
    clearMedia();
    stopTyping();
  }

  function sendMessage(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed && !mediaUrl) return;

    // In 'forced' mode, auto-improve before sending
    if (improvementMode === 'forced' && trimmed.length >= 10 && originalText === null) {
      improveAndSend();
      return;
    }

    doSend(trimmed);
  }

  function closeTicket() {
    if (closing) return;
    setClosing(true);

    getSocket().emit('ticket:close', {
      ticketId: ticket!.id,
      closingNotes: '',
    });

    setTimeout(() => {
      setClosing(false);
    }, 10000);
  }

  function leaveTicket() {
    if (!isSupport) return;
    getSocket().emit('support:leave', { ticketId: ticket!.id, supportId: user?.id, supportName: user?.name });
    if (onClose) onClose();
  }

  function transferTicket(targetSupportId?: string) {
    getSocket().emit('ticket:transfer', { ticketId: ticket!.id, targetSupportId: targetSupportId || undefined });
    setShowTransferMenu(false);
    if (onClose) onClose();
  }

  // Other support agents available for transfer (exclude self)
  const transferTargets = (onlineSupportUsers || []).filter(s => s.userId !== user?.id);

  const canClose = isSupportLike(user?.role);
  const isClosed = ticket.status === 'closed';

  return (
    <div className={`relative flex flex-col h-full bg-bg-surface border-2 border-border-heavy flex-1 min-h-0 overflow-hidden`}>
      {/* Header */}
      <div className={`relative z-50 flex items-center justify-between px-6 border-b-2 border-border-heavy bg-bg-elevated ${focusMode ? 'py-2' : 'py-4'}`}>
        <div className="min-w-0 pr-4">
          <div className="flex items-center gap-3 flex-wrap">
            {!focusMode && (
              <span className="text-[10px] font-bold px-2.5 py-1 shrink-0 uppercase tracking-widest bg-bg-elevated text-text-primary border border-border-heavy">
                {ticket.dept}
              </span>
            )}
            <div className="flex flex-col">
              <span className={`font-bold text-text-primary truncate flex items-center gap-2 min-w-0 ${focusMode ? 'text-sm opacity-80' : 'text-base'}`}>
                {ticket.agentName}
                {isSupport && !isClosed && (
                  <span
                    title={agentIsOnline ? 'Agent online' : 'Agent offline'}
                    className={`w-2 h-2 rounded-full shrink-0 ${agentIsOnline ? 'bg-text-primary' : 'border border-border'}`}
                  />
                )}
              </span>
              {!focusMode && (ticket.references as Array<{label: string; value: string}> || []).length > 0 && (
                <span className="text-[10px] font-bold text-text-primary opacity-40 uppercase tracking-tighter">
                  {(ticket.references as Array<{label: string; value: string}> || []).map((ref) => `${ref.label}: ${ref.value}`).join(' · ')}
                </span>
              )}
            </div>
            
            {!focusMode && ticket.agentLang && (
              <span className="text-sm cursor-default" title={ticket.agentLang.toUpperCase()}>
                {LANG_FLAG[ticket.agentLang as keyof typeof LANG_FLAG]}
              </span>
            )}
            
            {/* Active Labels Display */}
            {!focusMode && liveTicket.labels && liveTicket.labels.length > 0 && (
              <div className="flex flex-wrap gap-1.5 ml-2">
                {liveTicket.labels.map(id => {
                  const info = getLabelInfo(id);
                  if (!info) return null;
                  return (
                    <span
                      key={id}
                      className={`text-[9px] font-bold px-2 py-0.5 uppercase tracking-widest bg-bg-elevated text-text-primary border border-border-heavy`}
                    >
                      {info.text}
                    </span>
                  );
                })}
              </div>
            )}

            {/* SLA Indicator — only for support, open tickets without support response */}
            {!focusMode && isSupport && !isClosed && !liveTicket.supportJoinedAt && liveTicket.slaResponseDueAt && (
              <SlaIndicator dueAt={liveTicket.slaResponseDueAt} breached={liveTicket.slaBreached} />
            )}
          </div>
        </div>

        <div className={`flex items-center gap-3 shrink-0 ${focusMode ? 'opacity-60 hover:opacity-100' : ''}`}>
          {onFocus && (
            <button
              onClick={onFocus}
              title={focused ? 'Restore split' : 'Maximize'}
              className="w-8 h-8 flex items-center justify-center hover:bg-bg-elevated text-text-primary opacity-60 hover:opacity-100"
            >
              {focused ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                </svg>
              )}
            </button>
          )}

          {/* Summarize button (support/admin only) */}
          {canSummarize && !isClosed && (
            <button
              onClick={() => handleSummarize()}
              disabled={summarizing}
              aria-label="Summarize conversation"
              title="AI: Summarize conversation"
              className={`text-xs font-bold bg-bg-elevated text-text-primary hover:bg-bg-elevated border border-border-heavy hidden sm:flex items-center gap-1.5 ${focusMode ? 'px-2.5 py-1.5' : 'px-3 py-2'}`}
            >
              {summarizing ? (
                <span className="text-[10px] font-bold opacity-40">...</span>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              )}
              {!focusMode && 'Summarize'}
            </button>
          )}

          {canClose && !isClosed && (
            <div className="flex items-center gap-2">
              {/* Transfer button */}
              <div className="relative">
                <button
                  onClick={() => setShowTransferMenu(!showTransferMenu)}
                  aria-label={t('transfer') || 'Transfer'}
                  title={t('transfer') || 'Transfer'}
                  className={`text-xs font-bold bg-bg-elevated text-text-primary hover:bg-bg-elevated border border-border-heavy hidden sm:block ${focusMode ? 'px-2.5 py-1.5' : 'px-4 py-2'}`}
                >
                  {t('transfer') || 'Transfer'}
                </button>
                {showTransferMenu && (
                  <div className="absolute right-0 top-full mt-1 bg-bg-surface border-2 border-border-heavy min-w-[200px] z-50 overflow-hidden">
                    <button
                      onClick={() => transferTicket()}
                      className="w-full text-left px-4 py-2.5 text-xs font-bold hover:bg-bg-elevated border-b border-border"
                    >
                      {t('return_to_queue') || 'Return to queue'}
                    </button>
                    {transferTargets.length > 0 && (
                      <div className="px-3 py-1.5">
                        <span className="text-[9px] font-bold uppercase tracking-widest text-text-primary opacity-40">
                          {t('transfer_to') || 'Transfer to'}
                        </span>
                      </div>
                    )}
                    {transferTargets.map((s) => (
                      <button
                        key={s.userId}
                        onClick={() => transferTicket(s.userId)}
                        className="w-full text-left px-4 py-2 text-xs hover:bg-bg-elevated flex items-center gap-2"
                      >
                        <span className="w-2 h-2 rounded-full bg-text-primary shrink-0" />
                        <span className="font-medium">{s.name}</span>
                      </button>
                    ))}
                    {transferTargets.length === 0 && (
                      <div className="px-4 py-2 text-[10px] text-text-primary opacity-40 italic">
                        {t('no_other_support_online') || 'No other support online'}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <button
                onClick={leaveTicket}
                title={t('leave')}
                className={`text-xs font-bold bg-bg-elevated text-text-primary hover:bg-bg-elevated border border-border-heavy hidden sm:block ${focusMode ? 'px-2.5 py-1.5' : 'px-4 py-2'}`}
              >
                {t('leave') || 'Leave'}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeTicket();
                }}
                disabled={closing}
                className={`text-xs font-bold bg-accent-blue text-white hover:bg-accent-blue/80 border border-border-heavy flex items-center gap-2 ${focusMode ? 'px-2.5 py-1.5' : 'px-4 py-2'}`}
              >
                {closing ? (
                  <span className="text-[10px] font-bold opacity-40 shrink-0">...</span>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                )}
                {t('close')}
              </button>
            </div>
          )}
          {onClose && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              aria-label="Close"
              className="w-8 h-8 flex items-center justify-center hover:bg-bg-elevated text-text-primary opacity-60 hover:opacity-100"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* AI Summary Card */}
      {showSummary && summary && (
        <div className="px-6 py-3 bg-bg-elevated border-b-2 border-border-heavy">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-1.5">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                </svg>
                <span className="text-[10px] font-bold uppercase tracking-widest text-text-primary">AI Summary</span>
              </div>
              <p className="text-sm text-text-primary leading-relaxed">{summary}</p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => handleSummarize(true)}
                disabled={summarizing}
                aria-label="Refresh summary"
                title="Refresh summary"
                className="w-7 h-7 flex items-center justify-center hover:bg-bg-elevated text-text-primary opacity-60 hover:opacity-100"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className={`h-3.5 w-3.5 ${summarizing ? 'opacity-40' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
              <button
                onClick={() => setShowSummary(false)}
                aria-label="Dismiss summary"
                title="Dismiss"
                className="w-7 h-7 flex items-center justify-center hover:bg-bg-elevated text-text-primary opacity-60 hover:opacity-100"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Collision Detection: who else is viewing */}
      {viewers.length > 0 && (
        <div className="bg-bg-elevated border-b-2 border-border-heavy px-4 py-2 text-sm text-text-primary flex items-center gap-2">
          <Eye className="w-4 h-4 shrink-0" />
          <span>
            {viewers.map(v => v.userName).join(' and ')} {viewers.length === 1 ? 'is' : 'are'} also viewing this ticket
          </span>
        </div>
      )}

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
          <div className="max-w-4xl mx-auto w-full">
            {whisperMode && (
            <div className="flex items-center gap-2 mb-3">
              <div className="px-2 py-0.5 bg-accent-blue text-white text-[9px] font-bold uppercase tracking-widest">Whisper</div>
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

            <div className={`flex items-end gap-3 p-1.5 border-2 ${
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
                    ? 'bg-accent-blue text-white'
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
                  accept="image/*"
                  aria-label="Attach file"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </label>
            </div>

            <div className="relative flex-1">
              {/* Canned response picker */}
              {showCannedPicker && isSupport && (
                <CannedResponsePicker
                  inputText={text}
                  dept={ticket.dept}
                  onSelect={(body) => { setText(body); setShowCannedPicker(false); }}
                  onClose={() => setShowCannedPicker(false)}
                />
              )}
              <textarea
                aria-label="Type a message"
                value={text}
                onChange={(e) => {
                  const val = e.target.value;
                  setText(val);
                  // Show canned picker when typing "/" at start
                  if (isSupport && val.startsWith('/')) {
                    setShowCannedPicker(true);
                  } else {
                    setShowCannedPicker(false);
                  }
                  emitTyping();
                }}
                onKeyDown={(e) => {
                  if (showCannedPicker) return; // Let picker handle keys
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
                }}
                onPaste={handlePaste}
                placeholder={isSupport ? (t('type_message_slash') || 'Type a message or / for quick replies') : t('type_message')}
                rows={1}
                className="w-full resize-none bg-transparent border-none py-3 px-2 text-[15px] focus:ring-0 text-text-primary placeholder:opacity-30 max-h-32 scrollbar-none"
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
              className="bg-accent-blue text-white w-10 h-10 flex items-center justify-center disabled:opacity-30"
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
}
