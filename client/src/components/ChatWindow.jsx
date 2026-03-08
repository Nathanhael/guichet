import React, { useState, useRef, useEffect } from 'react';
import useStore from '../store/useStore';
import { getSocket } from '../hooks/useSocket';
import { useT } from '../i18n';
import MessageBubble from './MessageBubble';

export default function ChatWindow({ ticket, onClose, onFocus, focused }) {
  const { user, messages, typingUsers, agentOnline, setAgentOnline } = useStore();
  const t = useT();
  const [text, setText] = useState('');
  const [closing, setClosing] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [whisperMode, setWhisperMode] = useState(false);
  const [mediaUrl, setMediaUrl] = useState(null);
  const [mediaPreview, setMediaPreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const bottomRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const fileRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const isTypingRef = useRef(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const isNearBottomRef = useRef(true);
  const prevMessageCountRef = useRef(0);
  const [allLabels, setAllLabels] = useState([]);
  const [ticketLabels, setTicketLabels] = useState(ticket.labels || []);
  const [showLabelsMenu, setShowLabelsMenu] = useState(false);
  const labelsMenuRef = useRef(null);

  const ticketMessages = messages[ticket.id] || [];
  const whoIsTyping = Object.keys(typingUsers[ticket.id] || {});
  const isExpert = user.role === 'expert' || user.role === 'manager';
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
      getSocket().emit('typing:start', { ticketId: ticket.id, senderName: user.name });
    }
    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      isTypingRef.current = false;
      getSocket().emit('typing:stop', { ticketId: ticket.id, senderName: user.name });
    }, 2000);
  }

  function stopTyping() {
    clearTimeout(typingTimeoutRef.current);
    if (isTypingRef.current) {
      isTypingRef.current = false;
      getSocket().emit('typing:stop', { ticketId: ticket.id, senderName: user.name });
    }
  }

  const initialScrollDoneRef = useRef(null);

  // Reset initial-scroll tracker when switching tickets
  useEffect(() => {
    initialScrollDoneRef.current = null;
    prevMessageCountRef.current = 0;
    setUnreadCount(0);
  }, [ticket.id]);

  // Fetch agent online status when expert opens ticket
  useEffect(() => {
    if (!isExpert || !ticket.agentId) return;
    fetch(`/api/online/${ticket.agentId}`)
      .then((r) => r.json())
      .then(({ online }) => setAgentOnline(ticket.id, online))
      .catch(() => { });

    // Fetch all available labels
    fetch('/api/labels')
      .then(r => r.json())
      .then(setAllLabels)
      .catch(console.error);

    // Sync ticket labels
    setTicketLabels(ticket.labels || []);
  }, [ticket.id, ticket.labels]);

  // Handle outside click for labels menu
  useEffect(() => {
    function onOutsideClick(e) {
      if (labelsMenuRef.current && !labelsMenuRef.current.contains(e.target)) {
        setShowLabelsMenu(false);
      }
    }
    document.addEventListener('mousedown', onOutsideClick);
    return () => document.removeEventListener('mousedown', onOutsideClick);
  }, []);

  const toggleLabel = (labelId) => {
    const next = ticketLabels.includes(labelId)
      ? ticketLabels.filter(id => id !== labelId)
      : [...ticketLabels, labelId];
    setTicketLabels(next);
    getSocket().emit('ticket:labels:update', { ticketId: ticket.id, labels: next });
  };

  const getLabelInfo = (id) => allLabels.find(l => l.id === id);

  useEffect(() => {
    const count = ticketMessages.length;
    if (count === 0) return;

    // First batch of messages for this ticket → instant scroll to bottom
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

    // Auto-scroll if near bottom or if the current user sent the message
    const lastMsg = ticketMessages[count - 1];
    if (isNearBottomRef.current || lastMsg?.senderId === user.id) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      setUnreadCount(0);
    } else {
      setUnreadCount((prev) => prev + newMessages);
    }
  }, [ticketMessages.length]);

  async function uploadFile(file) {
    setMediaPreview(URL.createObjectURL(file));
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/uploads', { method: 'POST', body: form });
      const data = await res.json();
      setMediaUrl(data.url);
    } catch {
      setMediaPreview(null);
    } finally {
      setUploading(false);
    }
  }

  function handleFileChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    uploadFile(file);
  }

  function handlePaste(e) {
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

  function sendMessage(e) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed && !mediaUrl) return;

    getSocket().emit('message:send', {
      ticketId: ticket.id,
      senderId: user.id,
      senderLang: user.lang,
      text: trimmed || '📎',
      mediaUrl,
      whisper: whisperMode,
    });
    setText('');
    clearMedia();
    stopTyping();
  }

  function closeTicket() {
    setClosing(true);
    getSocket().emit('ticket:close', { ticketId: ticket.id });
    setShowCloseConfirm(false);
  }

  const canClose = user.role === 'expert' || user.role === 'manager';
  const isClosed = ticket.status === 'closed';

  return (
    <div className="relative flex flex-col h-full glass-card rounded-xl shadow-soft border-white/40 dark:border-brand-700/50 overflow-hidden animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/20 dark:border-brand-700/50 bg-white/40 dark:bg-brand-800/40 backdrop-blur-sm">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${ticket.dept === 'DSC' ? 'bg-purple-100 text-purple-700' : 'bg-teal-100 text-teal-700'
              }`}>
              {ticket.dept}
            </span>
            <span className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate flex items-center gap-1.5">
              {ticket.agentName}
              {isExpert && !isClosed && (
                <span
                  title={agentIsOnline ? 'Agent online' : 'Agent offline'}
                  className={`w-2 h-2 rounded-full shrink-0 animate-pulse ${agentIsOnline ? 'bg-green-400' : 'bg-gray-400 dark:bg-gray-500'}`}
                />
              )}
            </span>
            {ticket.cdbId && (
              <span className="text-xs font-mono bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded shrink-0">
                CDBID: {ticket.cdbId}
              </span>
            )}
            {ticket.dareRef && (
              <span className="text-xs font-mono bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded shrink-0">
                Dare Ref: {ticket.dareRef}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {ticket.participants && ticket.participants.length > 0 ? (
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {ticket.participants.map((p) => p.name).join(', ')}
              </span>
            ) : (
              <span className="text-xs text-gray-400">{t('waiting_for_expert')}</span>
            )}
            {ticket.agentLang && (
              <span className="text-xs text-gray-400">· Agent: {ticket.agentLang.toUpperCase()}</span>
            )}
          </div>
          {/* Active Labels Display */}
          {ticketLabels.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5 focus-within:ring-0">
              {ticketLabels.map(id => {
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

        <div className="flex items-center gap-2">
          {/* Labels Menu Button */}
          {isExpert && !isClosed && (
            <div className="relative" ref={labelsMenuRef}>
              <button
                onClick={() => setShowLabelsMenu(!showLabelsMenu)}
                title="Manage Labels"
                className={`p-2 rounded-xl transition-all shadow-sm ${showLabelsMenu ? 'bg-brand-500 text-white shadow-brand-500/20' : 'bg-white/50 dark:bg-brand-900/50 text-gray-500 dark:text-gray-400 hover:text-brand-500 hover:bg-white dark:hover:bg-brand-850 hover:shadow-md'} active:scale-95`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                </svg>
              </button>
              {showLabelsMenu && (
                <div className="absolute right-0 top-full mt-2 w-48 bg-white dark:bg-brand-800 border border-gray-100 dark:border-brand-700 rounded-xl shadow-2xl z-50 overflow-hidden animate-slide-up">
                  <div className="px-3 py-2 border-b border-gray-50 dark:border-brand-700 bg-gray-50/50 dark:bg-brand-900/30">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Labels</span>
                  </div>
                  <div className="max-h-60 overflow-y-auto p-1">
                    {allLabels.length === 0 ? (
                      <p className="text-[10px] text-gray-400 px-3 py-4 text-center">No labels defined</p>
                    ) : (
                      allLabels.map(l => (
                        <button
                          key={l.id}
                          onClick={() => toggleLabel(l.id)}
                          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium hover:bg-gray-50 dark:hover:bg-brand-700 transition-colors group"
                        >
                          <div className={`w-2.5 h-2.5 rounded-full bg-${l.color}-500 shrink-0`} />
                          <span className="flex-1 text-left dark:text-gray-200">{l.text}</span>
                          {ticketLabels.includes(l.id) && (
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
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
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
          {canClose && !isClosed && (
            <button
              onClick={() => setShowCloseConfirm(true)}
              disabled={closing}
              className="text-sm bg-red-50/80 dark:bg-red-900/40 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/60 px-4 py-2 rounded-xl font-bold transition-all border border-red-100 dark:border-red-900 shadow-sm hover:shadow-md active:scale-95"
            >
              {t('close')}
            </button>
          )}
          {onClose && (
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-lg leading-none">
              ×
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollContainerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-4 scrollbar-thin relative">
        <div className="space-y-1">
          {ticketMessages.length === 0 && (
            <p className="text-center text-gray-400 text-sm mt-8">{t('no_messages')}</p>
          )}
          {ticketMessages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} ticketId={ticket.id} />
          ))}

          {!ticket.expertName && !isClosed && (
            <div className="flex items-center justify-center gap-2 py-4 text-sm text-gray-400">
              <span className="animate-spin text-brand-400">⟳</span>
              {t('waiting_for_expert')}
            </div>
          )}

          {isClosed && (
            <div className="text-center py-3 text-sm text-gray-400 bg-gray-50 dark:bg-gray-700/50 rounded-lg mt-2">
              {t('ticket_closed_notice')}
            </div>
          )}

          {whoIsTyping.length > 0 && (
            <div className="flex items-center gap-2 px-2 py-1 text-xs text-gray-400 dark:text-gray-500">
              <span className="flex gap-0.5 items-center">
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
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

      {/* Close confirmation overlay */}
      {showCloseConfirm && (
        <div className="absolute inset-0 bg-black/50 rounded-xl flex items-center justify-center z-10">
          <div className="bg-white dark:bg-brand-800 rounded-2xl shadow-xl p-6 mx-4 max-w-sm w-full border border-gray-200 dark:border-brand-700">
            <h3 className="text-base font-semibold text-gray-800 dark:text-white mb-1">{t('close_ticket_title')}</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">{t('close_ticket_body')}</p>
            <div className="flex gap-3">
              <button onClick={closeTicket} className="flex-1 bg-red-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-red-700 transition-colors">
                {t('yes_close')}
              </button>
              <button onClick={() => setShowCloseConfirm(false)} className="flex-1 border border-gray-200 dark:border-brand-600 text-gray-600 dark:text-gray-300 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-brand-700 transition-colors">
                {t('cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Input */}
      {!isClosed && (
        <form onSubmit={sendMessage} className={`border-t p-3 backdrop-blur-md transition-colors duration-300 ${whisperMode
          ? 'border-violet-200/50 dark:border-violet-800/50 bg-violet-50/80 dark:bg-violet-950/40'
          : 'border-white/20 dark:border-brand-700/50 bg-white/60 dark:bg-brand-800/60'
          }`}>
          {mediaPreview && (
            <div className="relative inline-block mb-2">
              <img src={mediaPreview} alt="preview" className="h-20 rounded-lg object-contain border border-gray-200 dark:border-brand-600" />
              <button
                type="button"
                onClick={clearMedia}
                className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-5 h-5 text-xs flex items-center justify-center"
              >×</button>
              {uploading && (
                <div className="absolute inset-0 bg-white/70 dark:bg-brand-800/70 flex items-center justify-center rounded-lg text-xs text-gray-500">
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
            {(user.role === 'expert' || user.role === 'manager') && (
              <button
                type="button"
                onClick={() => setWhisperMode((v) => !v)}
                title={t('whisper_mode')}
                className={`p-1.5 rounded-lg transition-colors shrink-0 ${whisperMode
                  ? 'bg-violet-100 dark:bg-violet-900/50 text-violet-600 dark:text-violet-400'
                  : 'text-gray-500 dark:text-gray-400 hover:text-violet-500 hover:bg-gray-100 dark:hover:bg-brand-700'
                  }`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                </svg>
              </button>
            )}
            <label className="cursor-pointer text-gray-500 dark:text-gray-400 hover:text-brand-500 dark:hover:text-brand-400 transition-colors p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-brand-700 shrink-0" title="Screenshot (Ctrl+V)">
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
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(e); }
              }}
              onPaste={handlePaste}
              placeholder={t('type_message')}
              rows={1}
              className="flex-1 resize-none rounded-xl border border-white/40 dark:border-brand-600/50 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/50 bg-white/80 dark:bg-brand-800/80 backdrop-blur-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 shadow-sm transition-all duration-200"
            />

            <button
              type="submit"
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
