import React, { useState, useRef, useEffect } from 'react';
import useStore from '../store/useStore';
import { getSocket } from '../hooks/useSocket';
import { useT } from '../i18n';
import BionicText from './BionicText';

const LANG_LABEL = { nl: 'NL', fr: 'FR', en: 'EN' };

const REACTION_EMOJIS = [
  { key: 'thumbsUp', emoji: '\uD83D\uDC4D' },
  { key: 'heart', emoji: '\u2764\uFE0F' },
  { key: 'laugh', emoji: '\uD83D\uDE02' },
  { key: 'surprise', emoji: '\uD83D\uDE2E' },
  { key: 'sad', emoji: '\uD83D\uDE22' },
  { key: 'check', emoji: '\u2705' },
];

function Avatar({ name, isMine }) {
  const initials = name
    ? name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
    : '?';
  return (
    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 select-none shadow-sm ${isMine
      ? 'bg-gradient-to-br from-brand-500 to-brand-600 text-white'
      : 'bg-gradient-to-br from-slate-200 to-slate-300 dark:from-gray-700 dark:to-gray-800 text-gray-700 dark:text-gray-200'
      }`}>
      {initials}
    </div>
  );
}

export default function MessageBubble({ message, ticketId, searchQuery = '' }) {
  const { user, dyslexicMode, bionicReading } = useStore();
  const t = useT();
  const [showOriginal, setShowOriginal] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const pickerRef = useRef(null);

  useEffect(() => {
    if (!showPicker) return;
    function onOutside(e) {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) setShowPicker(false);
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [showPicker]);

  // System messages (e.g. agent disconnected)
  if (message.system) {
    return (
      <div className="flex justify-center py-1.5">
        <span className="text-xs text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-3 py-1 rounded-full font-medium">
          {message.text}
        </span>
      </div>
    );
  }

  const allTickets = useStore(s => s.tickets || []);
  const allArchived = useStore(s => s.archivedTickets || []);
  const ticket = allTickets.find(t => t.id === ticketId) || allArchived.find(t => t.id === ticketId);

  const isMine = message.senderId === user.id;
  const isAgent = ticket && message.senderId === ticket.agentId;
  const isExpertParticipant = ticket && message.senderId !== ticket.agentId && !message.system;

  const isWhisper = message.whisper;
  const senderName = message.senderName || message.senderId;

  // AI Logic
  const hasImproved = message.improvedText && message.improvedText !== message.originalText;
  const hasTranslated = !message.translationSkipped && message.processedText !== message.improvedText;
  const isFallback = !!message.fallback;

  // Decide what to show
  let mainText = message.processedText || message.text || '';
  if (isMine) {
    mainText = message.originalText || message.text || '';
  } else if (showOriginal) {
    mainText = message.originalText || message.text || '';
  }

  const displayText = mainText;

  const time = new Date(message.timestamp || message.createdAt).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });

  // Highlight search matching
  const highlightText = (text, query) => {
    if (!text) return '';
    if (typeof text !== 'string') return text;
    if (!query) return text;
    const regex = new RegExp(`(${query})`, 'gi');
    const parts = text.split(regex);
    return parts.map((part, i) =>
      regex.test(part) ? <mark key={i} className="bg-yellow-200 dark:bg-yellow-900/60 text-inherit rounded px-0.5 font-medium">{part}</mark> : part
    );
  };

  let nameColorClass = 'text-gray-500 dark:text-gray-400';
  if (isMine) {
    nameColorClass = 'text-brand-600 dark:text-brand-400';
  } else if (isAgent) {
    nameColorClass = 'text-teal-600 dark:text-teal-400';
  } else if (isExpertParticipant) {
    nameColorClass = 'text-violet-600 dark:text-violet-400';
  }

  return (
    <div className={`flex gap-3 px-3 py-1 items-start animate-fade-in flex-row`}>
      <Avatar name={senderName} isMine={isMine} />

      <div className={`flex flex-col max-w-[85%] items-start`}>
        <div className={`flex items-baseline gap-2 mb-1 flex-row`}>
          <span className={`text-[10px] font-bold uppercase tracking-wider ${nameColorClass}`}>
            {isMine ? t('you') || 'You' : senderName}
          </span>
          <span className="text-[10px] text-gray-400 flex items-center gap-1">
            {time}
            {isMine && !isWhisper && (
              <span className="flex items-center" title={
                message.readAt ? `Read ${new Date(message.readAt).toLocaleTimeString()}` :
                  message.deliveredAt ? `Delivered ${new Date(message.deliveredAt).toLocaleTimeString()}` :
                    message.pending ? 'Sending...' : 'Sent'
              }>
                {message.pending ? (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-gray-400 animate-spin-slow" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                ) : message.readAt ? (
                  <div className="flex -space-x-1.5 translate-y-[0.5px]">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-blue-500 animate-fade-in" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-blue-500 animate-fade-in" viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ animationDelay: '100ms' }}>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                ) : message.deliveredAt ? (
                  <div className="flex -space-x-1.5 translate-y-[0.5px]">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </span>
            )}
          </span>
        </div>

        <div className={`relative group p-3 rounded-2xl shadow-sm transition-all duration-200 rounded-tl-none ${dyslexicMode
          ? isWhisper
            ? 'bg-amber-100 dark:bg-slate-900 border-2 border-violet-400 dark:border-violet-500 text-slate-900 dark:text-slate-100 shadow-none bubble-dyslexic'
            : isMine
              ? 'bg-amber-100 dark:bg-slate-900 border-2 border-brand-500 dark:border-brand-400 text-slate-900 dark:text-slate-100 shadow-none bubble-dyslexic'
              : 'bg-amber-50 dark:bg-slate-900 border-2 border-slate-400 dark:border-slate-500 text-slate-900 dark:text-slate-100 shadow-none bubble-dyslexic'
          : isWhisper
            ? 'glass-bubble bg-violet-100/40 dark:bg-violet-900/40 text-violet-900 dark:text-violet-100'
            : isMine
              ? 'glass-bubble bg-brand-50/40 dark:bg-brand-900/30 text-brand-900 dark:text-brand-100'
              : 'glass-bubble bg-white/40 dark:bg-brand-800/40 text-gray-800 dark:text-gray-100'
          }`}>
          
          <p className="text-sm break-words whitespace-pre-wrap leading-relaxed">
            {bionicReading ? (
              <BionicText text={highlightText(displayText, searchQuery)} />
            ) : (
              highlightText(displayText, searchQuery)
            )}
            
            {/* AI Indicators */}
            {!isMine && !isWhisper && !showOriginal && (hasImproved || hasTranslated) && (
              <span className="ml-1 text-xs text-brand-500/60 select-none" title={hasTranslated ? t('translated_for_recipient') : 'Improved by AI'}>✦</span>
            )}
            {isFallback && !isMine && !isWhisper && !showOriginal && (
              <span className="ml-1 text-xs text-amber-500/60 select-none" title="AI processing unavailable - showing raw text">⚠</span>
            )}
          </p>

          {message.mediaUrl && (
            <a href={message.mediaUrl} target="_blank" rel="noopener noreferrer" className="mt-2 block">
              <img
                src={message.mediaUrl}
                alt="screenshot"
                className="rounded-lg max-w-full max-h-64 object-contain"
              />
            </a>
          )}

          {message.reactions && Object.keys(message.reactions).length > 0 && (
            <div className={`flex flex-wrap gap-1 mt-2 justify-start`}>
              {Object.entries(message.reactions).map(([key, userIds]) => {
                const emojiObj = REACTION_EMOJIS.find((e) => e.key === key);
                if (!emojiObj || userIds.length === 0) return null;
                const iReacted = userIds.includes(user.id);
                return (
                  <button
                    key={key}
                    onClick={() => {
                      getSocket().emit('reaction:toggle', {
                        ticketId,
                        messageId: message.id,
                        emoji: key,
                        userId: user.id,
                      });
                    }}
                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] border transition-colors ${iReacted
                      ? 'bg-brand-400/30 border-brand-400/40 text-brand-700 dark:text-brand-300'
                      : 'bg-gray-100 dark:bg-gray-700 border-gray-200 dark:border-brand-600 text-gray-600 dark:text-gray-300'
                      }`}
                  >
                    <span>{emojiObj.emoji}</span>
                    <span>{userIds.length}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Reaction Picker Button */}
          <div className={`absolute top-0 -right-10 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col gap-1`} ref={pickerRef}>
            <button
              onClick={() => setShowPicker((v) => !v)}
              className="p-1.5 rounded-full bg-white dark:bg-brand-800 shadow-md border border-gray-100 dark:border-brand-700 text-gray-400 hover:text-brand-500 transition-colors"
              title={t('add_reaction')}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
            {showPicker && (
              <div className={`absolute left-0 top-full mt-1 bg-white/95 backdrop-blur-md dark:bg-brand-800 border border-gray-200 dark:border-brand-600 rounded-xl shadow-xl flex gap-1 p-1.5 z-20`}>
                {REACTION_EMOJIS.map((e) => (
                  <button
                    key={e.key}
                    onClick={() => {
                      getSocket().emit('reaction:toggle', {
                        ticketId,
                        messageId: message.id,
                        emoji: e.key,
                        userId: user.id,
                      });
                      setShowPicker(false);
                    }}
                    className="hover:bg-gray-100 dark:hover:bg-brand-700 rounded-lg p-1.5 text-lg transition-transform hover:scale-125 focus:scale-125"
                  >
                    {e.emoji}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {(!isMine && !isWhisper && (hasImproved || hasTranslated)) && (
          <div className={`mt-1 flex items-center gap-2 flex-row`}>
            <button
              onClick={() => setShowOriginal((v) => !v)}
              className="text-[10px] font-bold text-brand-500 hover:text-brand-700 dark:hover:text-brand-300 underline uppercase tracking-tight"
            >
              {showOriginal ? t('translation') : `${t('original')}${message.senderLang ? ` (${LANG_LABEL[message.senderLang] || message.senderLang.toUpperCase()})` : ''}`}
            </button>
            
            {isWhisper && (
              <span className="text-[10px] text-violet-500 dark:text-violet-400 font-bold uppercase tracking-wider flex items-center gap-1">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268-2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                </svg>
                {t('whisper_label')}
              </span>
            )}
          </div>
        )}
        {isMine && !isWhisper && (hasImproved || hasTranslated) && (
          <div className="mt-1">
             <span className="text-[10px] text-gray-400 italic">
               {hasTranslated ? t('translated_for_recipient') : 'Clarified for recipient'}
             </span>
          </div>
        )}
      </div>
    </div>
  );
}
