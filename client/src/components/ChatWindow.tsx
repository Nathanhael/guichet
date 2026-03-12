import React, { useState, useRef, useEffect } from 'react';
import useStore from '../store/useStore';
import { getSocket } from '../hooks/useSocket';
import { useT } from '../i18n';
import MessageBubble from './MessageBubble';
import CannedResponsePicker from './CannedResponsePicker';
import { Ticket, Message, Label } from '../types';

const LANG_FLAG: Record<string, string> = { nl: '🇧🇪', fr: '🇫🇷', en: '🇬🇧' };

interface ChatWindowProps {
  ticket?: Ticket;
  onClose?: () => void;
  onFocus?: () => void;
  focused?: boolean;
}

export default function ChatWindow({ ticket, onClose, onFocus, focused }: ChatWindowProps) {
  const { user, token, messages, typingUsers, agentOnline, setAgentOnline, toggleTicketLabel, tickets, queuePosition, allLabels, darkMode } = useStore();
  const t = useT();
  const [text, setText] = useState('');
  const [closing, setClosing] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [whisperMode, setWhisperMode] = useState(false);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [blockedNotice, setBlockedNotice] = useState<string | null>(null);
  const [showLabelsMenu, setShowLabelsMenu] = useState(false);

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

  const ticketMessages = messages[ticket.id] || [];
  const whoIsTyping = Object.keys(typingUsers[ticket.id] || {});
  const isExpert = user?.role === 'expert' || user?.role === 'admin';
  const agentIsOnline = agentOnline[ticket.id] ?? true;

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

  // Fetch agent online status when expert opens ticket
  useEffect(() => {
    if (!isExpert || !ticket?.agentId) return;
    fetch(`/api/online/${ticket.agentId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then((r) => r.json())
      .then(({ online }) => setAgentOnline(ticket.id, online))
      .catch(() => { });
  }, [ticket?.id, ticket?.agentId, token, isExpert]);

  // Handle outside click for labels menu
  useEffect(() => {
    function onOutsideClick(e: MouseEvent) {
      if (labelsMenuRef.current && !labelsMenuRef.current.contains(e.target as Node)) {
        setShowLabelsMenu(false);
      }
    }
    document.addEventListener('mousedown', onOutsideClick, true);
    return () => document.removeEventListener('mousedown', onOutsideClick, true);
  }, []);

  const liveTicket = tickets.find(t => t.id === ticket.id) || ticket;

  const toggleLabel = (labelId: string) => {
    toggleTicketLabel(ticket.id, labelId);
    // Note: This is an optimistic update, we'll see the labels in the next render cycle of liveTicket
    setTimeout(() => {
       const updatedLabels = useStore.getState().tickets.find(t => t.id === ticket.id)?.labels || [];
       getSocket().emit('ticket:labels:update', { ticketId: ticket.id, labels: updatedLabels });
    }, 0);
  };

  const getLabelInfo = (id: string) => (allLabels || []).find((l: Label) => l.id === id);

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

  useEffect(() => {
    const socket = getSocket();
    function onBlocked({ code }: { code: string }) {
      setBlockedNotice(code);
      setTimeout(() => setBlockedNotice(null), 5000);
    }
    socket.on('message:blocked', onBlocked);
    return () => { socket.off('message:blocked', onBlocked); };
  }, []);



  async function uploadFile(file: File) {
    setMediaPreview(URL.createObjectURL(file));
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/uploads', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: form
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Upload failed');
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
      text: trimmed || '📎',
      mediaUrl: mediaUrl || undefined,
      whisper: whisperMode,
      pending: true,
      createdAt: new Date().toISOString(),
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

    setShowCloseConfirm(false);

    setTimeout(() => {
      setClosing(false);
    }, 10000);
  }

  function leaveTicket() {
    if (!isExpert) return;
    getSocket().emit('expert:leave', { ticketId: ticket!.id, expertId: user?.id, expertName: user?.name });
    if (onClose) onClose();
  }

  const canClose = user?.role === 'expert' || user?.role === 'admin';
  const isClosed = ticket.status === 'closed';

  return (
    <div className="relative flex flex-col h-full glass-card rounded-xl shadow-soft border-white/40 dark:border-brand-700/50 flex-1 min-h-0 animate-fade-in">
      {/* Header */}
      <div className="relative z-50 flex items-center justify-between px-4 py-3 border-b border-white/20 dark:border-brand-700/50 bg-white/30 dark:bg-brand-800/40 backdrop-blur-sm rounded-t-xl">
        <div className="min-w-0 pr-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 uppercase tracking-tighter ${
              ticket.dept === 'DSC' 
                ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' 
                : 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300'
            }`}>
              {ticket.dept}
            </span>
            <span className="text-sm font-semibold text-solarized-base01 dark:text-gray-100 truncate flex items-center gap-1.5 min-w-0 max-w-[120px]">
              {ticket.agentName}
              {isExpert && !isClosed && (
                <span
                  title={agentIsOnline ? 'Agent online' : 'Agent offline'}
                  className={`w-1.5 h-1.5 rounded-full shrink-0 animate-pulse ${agentIsOnline ? 'bg-solarized-green' : 'bg-solarized-base1 dark:bg-gray-500'}`}
                />
              )}
            </span>
            {ticket.cdbId && (
              <span className="text-[10px] font-mono bg-solarized-base2/50 dark:bg-gray-700/50 text-solarized-base1 dark:text-gray-400 px-1.5 py-0.5 rounded shrink-0 hidden sm:inline-block">
                CDBID: {ticket.cdbId}
              </span>
            )}
            {ticket.agentLang && (
              <span className="text-xs shrink-0" title={ticket.agentLang.toUpperCase()}>
                {LANG_FLAG[ticket.agentLang as keyof typeof LANG_FLAG]}
              </span>
            )}
            
            {/* Active Labels Display */}
            {liveTicket.labels && liveTicket.labels.length > 0 && (
              <div className="flex flex-wrap gap-1 focus-within:ring-0">
                {liveTicket.labels.map(id => {
                  const info = getLabelInfo(id);
                  if (!info) return null;
                  return (
                    <span
                      key={id}
                      className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider bg-${info.color}-500/10 text-${info.color}-600 dark:text-${info.color}-400 border border-${info.color}-500/20`}
                    >
                      {info.text}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {ticket.participants && (Array.isArray(ticket.participants) ? ticket.participants.length > 0 : false) ? (
              <span className="text-xs text-solarized-base1 dark:text-gray-400">
                {(ticket.participants as any[]).map((p) => (typeof p === 'object' && p !== null ? p.name : p)).join(', ')}
              </span>
            ) : (
              <span className="text-xs text-solarized-base1">{t('waiting_for_expert')}</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Labels Menu Button */}
          {isExpert && !isClosed && (
            <div className="relative" ref={labelsMenuRef}>
              <button
                onClick={() => setShowLabelsMenu(!showLabelsMenu)}
                title="Manage Labels"
                className={`p-2 rounded-xl transition-all shadow-sm ${showLabelsMenu ? 'bg-brand-500 text-white shadow-brand-500/20' : 'bg-solarized-base2 dark:bg-brand-900/50 text-solarized-base01 dark:text-gray-400 hover:text-brand-500 hover:bg-solarized-base3 dark:hover:bg-brand-850 hover:shadow-md'} active:scale-95`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                </svg>
              </button>
              {showLabelsMenu && (
                <div className="absolute right-0 top-full mt-2 w-48 bg-solarized-base3 dark:bg-brand-800 border border-solarized-base2 dark:border-brand-700 rounded-xl shadow-2xl z-50 overflow-hidden animate-slide-up">
                  <div className="px-3 py-2 border-b border-solarized-base2 dark:border-brand-700 bg-solarized-base2/50 dark:bg-brand-900/30">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-solarized-base1">Labels</span>
                  </div>
                   <div className="max-h-60 overflow-y-auto p-1">
                    {allLabels.length === 0 ? (
                      <p className="text-[10px] text-solarized-base1 px-3 py-4 text-center">No labels defined</p>
                    ) : (
                      allLabels.map(l => (
                        <button
                          key={l.id}
                          type="button"
                          onClick={() => toggleLabel(l.id)}
                          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium hover:bg-solarized-base2 dark:hover:bg-brand-700 transition-colors group"
                        >
                          <div className={`w-2.5 h-2.5 rounded-full bg-${l.color}-500 shrink-0`} />
                          <span className="flex-1 text-left text-solarized-base1 dark:text-gray-200">{l.text}</span>
                          {(liveTicket.labels || []).includes(l.id) && (
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-brand-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
          {onFocus && (
            <button
              onClick={onFocus}
              title={focused ? 'Restore split' : 'Maximize'}
              className="text-solarized-base1 hover:text-solarized-base01 dark:hover:text-gray-200 transition-colors"
            >
              {focused ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                </svg>
              )}
            </button>
          )}
          {/* Search Toggle */}
          <button
            onClick={() => setShowSearch(!showSearch)}
            title="Search in chat"
            className={`p-1.5 rounded-lg transition-colors shrink-0 ${showSearch
              ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400'
              : 'text-gray-400 hover:text-blue-500 hover:bg-gray-100 dark:hover:bg-brand-700'
              }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </button>

          {canClose && !isClosed && (
            <div className="flex items-center gap-1.5">
              <button
                onClick={leaveTicket}
                title={t('leave')}
                className="text-xs bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/40 px-3 py-2 rounded-xl font-bold transition-all border border-amber-200 dark:border-amber-800 shadow-sm active:scale-95 whitespace-nowrap hidden sm:block"
              >
                {t('leave') || 'Leave'}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeTicket();
                }}
                disabled={closing}
                className="text-xs bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 px-3 py-2 rounded-xl font-bold transition-all border border-red-200 dark:border-red-800 shadow-sm active:scale-95 flex items-center gap-2 whitespace-nowrap"
              >
                {closing && (
                  <svg className="animate-spin h-3 w-3 shrink-0" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
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
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-solarized-base2 dark:hover:bg-brand-700 text-solarized-base1 hover:text-solarized-base01 dark:hover:text-gray-200 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {(user?.role === 'agent' || user?.role === 'admin') && !ticket.expertName && !isClosed && queuePosition && (
        <div className="bg-gradient-to-r from-blue-500/10 to-brand-500/10 border-b border-blue-200 dark:border-blue-900/50 px-4 py-2.5 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-2 text-blue-800 dark:text-blue-300">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm font-semibold tracking-wide">
              Position #{queuePosition.position} in queue
            </span>
          </div>
          <div className="text-xs font-medium text-blue-600 dark:text-blue-400 bg-white/50 dark:bg-black/20 px-2 py-1 rounded-md">
            ~{queuePosition.etaMins} min ETA
          </div>
        </div>
      )}

      {showSearch && (
        <div className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-brand-700 px-4 py-2 flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
          </svg>
          <input
            type="text"
            autoFocus
            placeholder="Search messages..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 bg-transparent text-sm text-gray-800 dark:text-gray-200 focus:outline-none placeholder-gray-400"
          />
          {searchQuery && (
            <span className="text-xs text-brand-500 font-medium px-2 py-0.5 bg-brand-50 dark:bg-brand-900/30 rounded mr-2">
              {ticketMessages.filter(m => (m.processedText || m.text || '').toLowerCase().includes(searchQuery.toLowerCase())).length} matches
            </span>
          )}
          <button onClick={() => { setShowSearch(false); setSearchQuery(''); }} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      )}

      {/* Messages */}
      <div 
        ref={scrollContainerRef} 
        onScroll={handleScroll} 
        className={`flex-1 overflow-y-auto p-4 scrollbar-thin relative transition-colors duration-500 ${
          darkMode 
            ? 'whatsapp-bg bg-[#0d1418]' 
            : 'bg-solarized-base3/20'
        }`}
      >
        <div className="space-y-2 mb-4">
          {ticketMessages.length === 0 && (
            <p className="text-center text-solarized-base1 text-sm mt-8">{t('no_messages')}</p>
          )}
          {ticketMessages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} ticketId={ticket.id} searchQuery={searchQuery} />
          ))}

          {!ticket.expertName && !isClosed && (
            <div className="flex items-center justify-center gap-2 py-4 text-sm text-solarized-base1">
              <span className="animate-spin text-brand-400">⟳</span>
              {t('waiting_for_expert')}
            </div>
          )}

          {isClosed && (
            <div className="text-center py-3 text-sm text-solarized-base1 bg-solarized-base2 dark:bg-gray-700/50 rounded-lg mt-2">
              {t('ticket_closed_notice')}
            </div>
          )}

          {whoIsTyping.length > 0 && (
            <div className="flex items-center gap-2 px-2 py-1 text-xs text-solarized-base1 dark:text-gray-500">
              <span className="flex gap-0.5 items-center">
                <span className="w-1.5 h-1.5 bg-solarized-base1 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 bg-solarized-base1 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 bg-solarized-base1 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </span>
              <span>
                {whoIsTyping.length === 1
                  ? `${whoIsTyping[0]} is typing…`
                  : `${whoIsTyping.join(', ')} are typing…`}
              </span>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Unread messages badge */}
      {unreadCount > 0 && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-20 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 bg-gradient-to-r from-brand-500 to-brand-600 text-white pl-4 pr-4 py-2 rounded-full shadow-lg shadow-brand-500/30 hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300 text-xs font-semibold tracking-wide border border-brand-400/30"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
          {unreadCount} new {unreadCount === 1 ? 'message' : 'messages'}
        </button>
      )}

      {/* Blocked Notice */}
      {blockedNotice && (
        <div className="absolute top-16 left-4 right-4 z-[60] animate-slide-up">
          <div className="bg-red-50 dark:bg-red-900/80 border border-red-200 dark:border-red-800 p-3 rounded-xl shadow-xl flex items-start gap-3">
            <div className="p-1.5 bg-red-100 dark:bg-red-900 rounded-lg text-red-600 dark:text-red-400">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="flex-1">
              <h4 className="text-sm font-bold text-red-800 dark:text-red-200">{t('guard_blocked_title')}</h4>
              <p className="text-xs text-red-700 dark:text-red-300 mt-0.5">{t(blockedNotice)}</p>
            </div>
            <button onClick={() => setBlockedNotice(null)} className="text-red-400 hover:text-red-600 transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Close confirmation overlay */}
      {showCloseConfirm && (
        <div className="absolute inset-0 bg-black/50 rounded-xl flex items-center justify-center z-10">
          <div className="bg-solarized-base3 dark:bg-brand-800 rounded-2xl shadow-xl p-6 mx-4 max-w-sm w-full border border-solarized-base2 dark:border-brand-700">
            <h3 className="text-base font-semibold text-solarized-base01 dark:text-white mb-1">{t('close_ticket_title')}</h3>
            <p className="text-sm text-solarized-base00 dark:text-gray-400 mb-5">{t('close_ticket_body')}</p>
            <div className="flex gap-3">
              <button onClick={closeTicket} className="flex-1 bg-solarized-red text-white py-2 rounded-lg text-sm font-medium hover:bg-red-700 transition-colors">
                {t('yes_close')}
              </button>
              <button onClick={() => setShowCloseConfirm(false)} className="flex-1 border border-solarized-base2 dark:border-brand-600 text-solarized-base01 dark:text-gray-300 py-2 rounded-lg text-sm font-medium hover:bg-solarized-base2 dark:hover:bg-brand-700 transition-colors">
                {t('cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Input */}
      {!isClosed && (
        <form onSubmit={sendMessage} className={`border-t p-3 backdrop-blur-md transition-colors duration-300 ${whisperMode
          ? 'border-solarized-violet/20 dark:border-solarized-violet/50 bg-solarized-violet/5 dark:bg-solarized-violet/10'
          : 'border-solarized-base2 dark:border-brand-700/50 bg-solarized-base3/60 dark:bg-brand-800/60'
          }`}>
          {mediaPreview && (
          <div className="relative inline-block mb-2">
            <img src={mediaPreview} alt="preview" className="h-20 rounded-lg object-contain border border-solarized-base2 dark:border-brand-600" />
            <button
              type="button"
              onClick={clearMedia}
              className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-5 h-5 text-xs flex items-center justify-center"
            >×</button>
            {uploading && (
              <div className="absolute inset-0 bg-solarized-base3/70 dark:bg-brand-800/70 flex items-center justify-center rounded-lg text-xs text-solarized-base1">
                {t('uploading')}
              </div>
            )}
          </div>
          )}

          {whisperMode && (
          <p className="text-xs text-violet-500 dark:text-violet-400 mb-2 font-medium">
            Whisper — {t('whisper_hint')}
          </p>
          )}

          <div className="flex items-end gap-2">
          {(user?.role === 'expert' || user?.role === 'admin') && (
            <button
              type="button"
              onClick={() => setWhisperMode((v) => !v)}
              title={t('whisper_mode')}
              className={`p-1.5 rounded-lg transition-colors shrink-0 ${whisperMode
                ? 'bg-violet-100 dark:bg-violet-900/50 text-violet-600 dark:text-violet-400'
                : 'text-solarized-base1 dark:text-gray-400 hover:text-violet-500 hover:bg-solarized-base2 dark:hover:bg-brand-700'
                }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268-2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
              </svg>
            </button>
          )}
          {isExpert && (
            <CannedResponsePicker onSelect={(val) => setText((prev) => prev ? `${prev} ${val}` : val)} />
          )}

          <label className="cursor-pointer text-solarized-base1 dark:text-gray-400 hover:text-brand-500 dark:hover:text-brand-400 transition-colors p-1.5 rounded-lg hover:bg-solarized-base2 dark:hover:bg-brand-700 shrink-0" title="Screenshot (Ctrl+V)">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={handleFileChange}
            />
          </label>

          <textarea
            value={text}
            onChange={(e) => { setText(e.target.value); emitTyping(); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
            }}
            onPaste={handlePaste}
            placeholder={t('type_message')}
            rows={1}
            className="flex-1 resize-none rounded-xl border border-solarized-base2 dark:border-brand-600/50 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/50 bg-solarized-base3/80 dark:bg-brand-800/80 backdrop-blur-sm text-solarized-base00 dark:text-gray-100 placeholder-solarized-base1 dark:placeholder-gray-500 shadow-sm transition-all duration-200"
          />

          <button
            type="submit"
            onClick={() => sendMessage()}
            disabled={uploading || (!text.trim() && !mediaUrl)}
            className="bg-gradient-to-r from-brand-500 to-brand-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold shadow-sm hover:shadow-md hover:-translate-y-[1px] disabled:opacity-50 disabled:transform-none disabled:shadow-sm transition-all duration-200 shrink-0"
          >
            {t('send')}
          </button>
          </div>
        </form>
      )}
    </div>
  );
}
