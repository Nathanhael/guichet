import React, { useState, useRef, useEffect } from 'react';
import useStore from '../store/useStore';
import { getSocket } from '../hooks/useSocket';
import { usePartner } from '../hooks/usePartner';
import { useT } from '../i18n';
import MessageBubble from './MessageBubble';
import { Ticket, Message } from '../types';
import { trpc } from '../utils/trpc';

const LANG_FLAG: Record<string, string> = { nl: '🇧🇪', fr: '🇫🇷', en: '🇬🇧' };

interface ChatWindowProps {
  ticket?: Ticket;
  onClose?: () => void;
  onFocus?: () => void;
  focused?: boolean;
}

export default function ChatWindow({ ticket, onClose, onFocus, focused }: ChatWindowProps) {
  const { user, messages, typingUsers, participantsOnline, setParticipantOnline, toggleTicketLabel, tickets, queuePosition, allLabels, darkMode, setMessages, activePartnerId, focusMode } = useStore();
  const { manifest } = usePartner();
  const t = useT();
  const [text, setText] = useState('');
  const [closing, setClosing] = useState(false);
  const [whisperMode, setWhisperMode] = useState(false);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const bottomRef = useRef<HTMLDivElement>(null);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isTypingRef = useRef(false);
  const isNearBottomRef = useRef(true);
  const prevMessageCountRef = useRef(0);
  const labelsMenuRef = useRef<HTMLDivElement>(null);
  const initialScrollDoneRef = useRef<string | null>(null);

  if (!ticket) return null;

  // tRPC: Message History
  const messageQuery = trpc.message.list.useQuery(
    { ticketId: ticket.id },
    { 
      enabled: !!ticket.id,
    }
  );

  useEffect(() => {
    if (messageQuery.data) {
      setMessages(ticket.id, messageQuery.data as any);
    }
  }, [messageQuery.data, ticket.id, setMessages]);

  const isSupport = user?.role === 'support' || user?.role === 'admin';

  // tRPC: Agent Presence
  const presenceQuery = trpc.presence.getOnlineStatus.useQuery(
    { userId: ticket.agentId || '', partnerId: activePartnerId || '' },
    {
      enabled: isSupport && !!ticket.agentId && ticket.status !== 'closed' && !!activePartnerId,
      refetchInterval: 10000, // Check every 10s
    }
  );

  useEffect(() => {
    if (presenceQuery.data) {
      setParticipantOnline(ticket.id, presenceQuery.data.online);
    }
  }, [presenceQuery.data, ticket.id, setParticipantOnline]);

  const ticketMessages = messages[ticket.id] || [];
  const whoIsTyping = Object.keys(typingUsers[ticket.id] || {});
  const agentIsOnline = participantsOnline[ticket.id] ?? true;

  // Track scroll position
  function handleScroll() {
    const el = scrollContainerRef.current;
    if (!el) return;
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (isNearBottomRef.current) setUnreadCount(0);
  }

  function scrollToBottom() {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    setUnreadCount(0);
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

  // Reset initial-scroll tracker when switching tickets
  useEffect(() => {
    initialScrollDoneRef.current = null;
    prevMessageCountRef.current = 0;
    setUnreadCount(0);
  }, [ticket.id]);

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

  const liveTicket = tickets.find(t => t.id === ticket.id) || ticket;

  const toggleLabel = (labelId: string) => {
    toggleTicketLabel(ticket.id, labelId);
    setTimeout(() => {
       const updatedLabels = useStore.getState().tickets.find(t => t.id === ticket.id)?.labels || [];
       getSocket().emit('ticket:labels:update', { ticketId: ticket.id, labels: updatedLabels });
    }, 0);
  };

  const getLabelInfo = (id: string) => (allLabels || []).find((l) => l.id === id);

  useEffect(() => {
    const count = ticketMessages.length;
    if (count === 0) return;

    if (initialScrollDoneRef.current !== ticket.id) {
      initialScrollDoneRef.current = ticket.id;
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
        getSocket().emit('message:read', { ticketId: ticket.id, messageIds: unreadIds });
      }
    } else {
      setUnreadCount((prev) => prev + newMessages);
    }
  }, [ticketMessages.length, ticket.id, user?.id]);

  useEffect(() => {
    if (ticket.status === 'closed' && onClose) {
      const timer = setTimeout(() => {
        onClose();
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [ticket.status, onClose]);

  useEffect(() => {
    function onFocus() {
      const unreadIds = ticketMessages
        .filter(m => m.senderId !== user?.id && !m.readAt)
        .map(m => m.id);

      if (unreadIds.length > 0) {
        getSocket().emit('message:read', { ticketId: ticket!.id, messageIds: unreadIds });
        setUnreadCount(0);
      }
    }
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [ticketMessages, ticket.id, user?.id]);

  async function uploadFile(file: File) {
    const { token } = useStore.getState();
    setMediaPreview(URL.createObjectURL(file));
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/v1/uploads', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: form
      });
      const data = await res.json();
      if (!res.ok) {
        console.error('Upload failed:', data.error || 'Unknown error');
        setMediaPreview(null);
        return;
      }
      setMediaUrl(data.url);
    } catch {
      setMediaPreview(null);
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
    setMediaUrl(null);
    setMediaPreview(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  function sendMessage(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed && !mediaUrl) return;

    const optimisticMsg: Message = {
      id: `pending-${Object.keys(messages).length}-${Date.now()}`,
      ticketId: ticket!.id,
      senderId: user?.id || '',
      senderName: user?.name || '',
      senderRole: user?.role || 'agent',
      senderLang: user?.lang || 'en',
      originalText: trimmed || '📎',
      improvedText: trimmed || '📎',
      processedText: trimmed || '📎',
      text: trimmed || '📎',
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
      senderId: user?.id,
      senderLang: user?.lang,
      text: trimmed || '📎',
      mediaUrl,
      whisper: whisperMode,
    });
    setText('');
    clearMedia();
    stopTyping();
  }

  function closeTicket() {
    if (closing) return;
    setClosing(true);

    getSocket().emit('ticket:close', {
      ticketId: ticket!.id,
      closingNotes: '',
      closedBy: user?.name
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

  const canClose = user?.role === 'support' || user?.role === 'admin';
  const isClosed = ticket.status === 'closed';

  return (
    <div className={`relative flex flex-col h-full bg-white dark:bg-slate-900 rounded-[1.5rem] shadow-xl border border-slate-200 dark:border-slate-800 flex-1 min-h-0 animate-fade-in overflow-hidden transition-all duration-500 ${focusMode ? 'scale-[0.99] border-blue-500/20' : ''}`}>
      {/* Header */}
      <div className={`relative z-50 flex items-center justify-between px-6 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 transition-all duration-500 ${focusMode ? 'py-2' : 'py-4'}`}>
        <div className="min-w-0 pr-4">
          <div className="flex items-center gap-3 flex-wrap">
            {!focusMode && (
              <span className={`text-[10px] font-black px-2.5 py-1 rounded-lg shrink-0 uppercase tracking-widest shadow-sm ${
                ticket.dept === 'DSC' || ticket.dept === 'dsc'
                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' 
                  : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
              }`}>
                {ticket.dept}
              </span>
            )}
            <div className="flex flex-col">
              <span className={`font-bold text-slate-900 dark:text-white truncate flex items-center gap-2 min-w-0 ${focusMode ? 'text-sm opacity-80' : 'text-base'}`}>
                {ticket.agentName}
                {isSupport && !isClosed && (
                  <span
                    title={agentIsOnline ? 'Agent online' : 'Agent offline'}
                    className={`w-2 h-2 rounded-full shrink-0 transition-all duration-500 ${agentIsOnline ? 'bg-green-500 shadow-lg shadow-green-500/50 scale-110' : 'bg-slate-300 dark:bg-slate-600'}`}
                  />
                )}
              </span>
              {!focusMode && (ticket.ref1 || (ticket as any).cdbId) && (
                <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-tighter">
                  {ticket.dept === 'FOT' || ticket.dept === 'fot' ? manifest.ref2Label : manifest.ref1Label}: {ticket.ref1 || (ticket as any).cdbId}
                </span>
              )}
            </div>
            
            {!focusMode && ticket.agentLang && (
              <span className="text-sm grayscale-[0.2] hover:grayscale-0 transition-all cursor-default" title={ticket.agentLang.toUpperCase()}>
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
                      className={`text-[9px] font-black px-2 py-0.5 rounded-md uppercase tracking-widest bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-300 dark:border-slate-700 shadow-sm`}
                    >
                      {info.text}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className={`flex items-center gap-3 shrink-0 ${focusMode ? 'scale-90 opacity-60 hover:opacity-100 transition-opacity' : ''}`}>
          {onFocus && (
            <button
              onClick={onFocus}
              title={focused ? 'Restore split' : 'Maximize'}
              className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-all duration-300"
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

          {canClose && !isClosed && (
            <div className="flex items-center gap-2">
              <button
                onClick={leaveTicket}
                title={t('leave')}
                className={`text-xs font-bold transition-all duration-300 bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-amber-100 dark:hover:bg-amber-900/30 hover:text-amber-700 dark:hover:text-amber-300 border border-slate-300 dark:border-slate-700 rounded-xl active:scale-95 hidden sm:block ${focusMode ? 'px-2.5 py-1.5' : 'px-4 py-2'}`}
              >
                {t('leave') || 'Leave'}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeTicket();
                }}
                disabled={closing}
                className={`text-xs font-black transition-all duration-300 bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500 hover:text-white border border-red-500/20 rounded-xl shadow-lg shadow-red-500/5 active:scale-95 flex items-center gap-2 ${focusMode ? 'px-2.5 py-1.5' : 'px-4 py-2'}`}
              >
                {closing ? (
                  <svg className="animate-spin h-3 w-3 shrink-0" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
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
              className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-red-500/10 text-slate-400 hover:text-red-500 transition-all duration-300"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div 
        ref={scrollContainerRef} 
        onScroll={handleScroll} 
        className={`flex-1 overflow-y-auto p-6 scrollbar-thin relative transition-all duration-700 bg-slate-50 dark:bg-black`}
      >
        <div className="space-y-1 mb-8">
          {ticketMessages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 opacity-40">
              <svg className="w-12 h-12 text-slate-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
              />
            );
          })}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input */}
      {!isClosed && (
        <form onSubmit={sendMessage} className={`border-t p-4 pb-6 transition-all duration-500 ${whisperMode
          ? 'bg-amber-100 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900'
          : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800'
          }`}>
          <div className="max-w-4xl mx-auto w-full">
            {whisperMode && (
            <div className="flex items-center gap-2 mb-3 animate-in fade-in slide-in-from-left-2">
              <div className="px-2 py-0.5 rounded bg-amber-500 text-white text-[9px] font-black uppercase tracking-widest shadow-sm">Whisper</div>
              <p className="text-[10px] text-amber-700 dark:text-amber-400 font-bold uppercase tracking-tight opacity-80">
                {t('whisper_hint')}
              </p>
            </div>
            )}

            <div className={`flex items-end gap-3 p-1.5 rounded-[1.25rem] border transition-colors duration-300 ${
              whisperMode 
                ? 'bg-white/50 dark:bg-black/20 border-amber-300 dark:border-amber-800' 
                : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700'
            }`}>
            <div className="flex items-center self-center px-1">
              {isSupport && (
                <button
                  type="button"
                  onClick={() => setWhisperMode((v) => !v)}
                  title={t('whisper_mode')}
                  className={`w-10 h-10 rounded-xl transition-all duration-300 flex items-center justify-center ${whisperMode
                    ? 'bg-amber-500 text-white shadow-md'
                    : 'text-slate-400 hover:text-amber-500 hover:bg-amber-500/10'
                    }`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268-2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                  </svg>
                </button>
              )}

              <label className="w-10 h-10 rounded-xl transition-all duration-300 flex items-center justify-center text-slate-400 hover:text-blue-500 hover:bg-blue-500/10 cursor-pointer" title="Attach file">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </label>
            </div>

            <textarea
              value={text}
              onChange={(e) => { setText(e.target.value); emitTyping(); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
              }}
              onPaste={handlePaste}
              placeholder={t('type_message')}
              rows={1}
              className="flex-1 resize-none bg-transparent border-none py-3 px-2 text-[15px] focus:ring-0 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 max-h-32 scrollbar-none"
            />

            <button
              type="submit"
              disabled={uploading || (!text.trim() && !mediaUrl)}
              className="bg-blue-600 hover:bg-blue-500 text-white w-10 h-10 rounded-xl flex items-center justify-center shadow-md transition-all duration-300 disabled:opacity-30 disabled:grayscale active:scale-90"
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
