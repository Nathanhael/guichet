import { useState, useRef, useEffect } from 'react';
import useStore from '../store/useStore';
import { getSocket } from '../hooks/useSocket';
import { useT } from '../i18n';
import BionicText from './BionicText';
import { Message } from '../types';

const LANG_LABEL: Record<string, string> = { nl: 'NL', fr: 'FR', en: 'EN' };

const REACTION_EMOJIS = [
  { key: 'thumbsUp', emoji: '\uD83D\uDC4D' },
  { key: 'heart', emoji: '\u2764\uFE0F' },
  { key: 'laugh', emoji: '\uD83D\uDE02' },
  { key: 'surprise', emoji: '\uD83D\uDE2E' },
  { key: 'sad', emoji: '\uD83D\uDE22' },
  { key: 'check', emoji: '\u2705' },
];

interface MessageBubbleProps {
  message: Message;
  ticketId: string;
  searchQuery?: string;
}

export default function MessageBubble({ message, ticketId, searchQuery: _searchQuery = '' }: MessageBubbleProps) {
  const { user, dyslexicMode, bionicReading, highContrastMode } = useStore();
  const t = useT();
  const [showOriginal, setShowOriginal] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showPicker) return;
    function onOutside(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setShowPicker(false);
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [showPicker]);

  // System messages
  if (message.system) {
    return (
      <div className="flex justify-center py-1.5">
        <span className={`text-[10px] uppercase tracking-wider px-3 py-1 rounded-full font-bold shadow-sm ${
          highContrastMode
            ? 'bg-black text-white dark:bg-white dark:text-black border-2 border-black dark:border-white'
            : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700'
        }`}>
          {message.text}
        </span>
      </div>
    );
  }

  const isMine = message.senderId === user?.id;
  const isWhisper = !!message.whisper;

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

  // Decide bubble colors based on role and contrast mode
  let bubbleClasses = '';
  if (highContrastMode) {
    bubbleClasses = isMine
      ? 'bg-black text-white dark:bg-white dark:text-black border-2 border-black dark:border-white'
      : isWhisper
        ? 'bg-violet-900 text-white border-2 border-violet-500'
        : 'bg-white text-black dark:bg-black dark:text-white border-2 border-black dark:border-white';
  } else {
    bubbleClasses = isMine
      ? 'bg-[#dcf8c6] dark:bg-[#056162] text-slate-900 dark:text-slate-100 shadow-sm'
      : isWhisper
        ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-900 dark:text-violet-100 shadow-sm border border-violet-200/50 dark:border-violet-700/50'
        : 'bg-white dark:bg-[#262d31] text-slate-900 dark:text-slate-100 shadow-sm';
  }

  return (
    <div className={`flex w-full mb-1.5 px-2 animate-fade-in ${isMine ? 'justify-end' : 'justify-start'}`}>
      <div className={`relative max-w-[85%] min-w-[100px] group transition-all duration-200 px-3 py-1.5 rounded-2xl ${
        isMine ? 'rounded-tr-none ml-12' : 'rounded-tl-none mr-12'
      } ${bubbleClasses}`}>
        
        {/* Bubble Tail */}
        {!highContrastMode && (
          <div className={isMine ? 'bubble-tail-mine' : 'bubble-tail-other'} />
        )}

        {/* Sender Name (Only for others, and only if not whisper) */}
        {!isMine && !isWhisper && (
          <div className={`text-[10px] font-bold mb-0.5 opacity-70 ${highContrastMode ? 'text-current' : 'text-brand-600 dark:text-brand-400'}`}>
            {message.senderName || 'Expert'}
          </div>
        )}
        
        {/* Whisper indicator */}
        {isWhisper && (
          <div className="flex items-center gap-1 mb-1 text-[9px] font-bold uppercase tracking-widest opacity-60">
            <svg size={10} className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            Internal Whisper
          </div>
        )}

        <div className="relative">
          <p className={`text-[14px] break-words whitespace-pre-wrap leading-snug ${
            isWhisper ? 'italic' : ''
          } ${dyslexicMode ? 'font-lexend' : ''}`}>
            {bionicReading ? (
              <BionicText text={displayText} />
            ) : (
              displayText
            )}
          </p>

          {message.mediaUrl && (
            <a href={message.mediaUrl} target="_blank" rel="noopener noreferrer" className="mt-2 block">
              <img
                src={message.mediaUrl}
                alt="screenshot"
                className={`rounded-lg max-w-full h-auto ${highContrastMode ? 'border-2 border-current' : 'border border-black/5 dark:border-white/5'}`}
              />
            </a>
          )}
        </div>

        {/* Footer with AI toggles and Timestamp */}
        <div className="flex items-center justify-end gap-2 mt-1 -mr-1">
          {(!isMine && !isWhisper && (message.improvedText || !message.translationSkipped)) && (
            <button
              onClick={() => setShowOriginal((v) => !v)}
              className={`text-[9px] font-bold hover:underline uppercase transition-colors ${
                highContrastMode ? 'text-current underline' : 'text-brand-500/80'
              }`}
            >
              {showOriginal ? t('translation') : `${t('original')}${message.senderLang ? ` (${LANG_LABEL[message.senderLang] || message.senderLang.toUpperCase()})` : ''}`}
            </button>
          )}
          
          <div className="flex items-center gap-1 opacity-60">
            <span className="text-[10px] select-none font-medium">
              {time}
            </span>
            {isMine && (
              <svg viewBox="0 0 16 11" width="13" height="13" className={`fill-current ${message.readAt ? (highContrastMode ? 'text-current' : 'text-sky-500') : 'text-current'}`}>
                <path d="M11.022 1.132L5.808 6.643 3.65 4.363l-.71.67 2.868 3.033 5.922-6.265zM14.991 1.132l-5.214 5.511-.321-.34-.71.671.677.716 5.568-5.888-.71-.67zM7.051 8.066l-.71-.67-.354.374.71.67.354-.374z" />
              </svg>
            )}
          </div>
        </div>

        {/* Integrated Reactions Display */}
        {message.reactions && typeof message.reactions === 'object' && Object.keys(message.reactions).length > 0 && (
          <div className={`flex flex-wrap gap-1 mt-1.5 pt-1.5 border-t ${highContrastMode ? 'border-current' : 'border-black/5 dark:border-white/5'}`}>
            {Object.entries(message.reactions as Record<string, string[]>).map(([key, userIds]) => {
              const emojiObj = REACTION_EMOJIS.find((e) => e.key === key);
              if (!emojiObj || userIds.length === 0) return null;
              const iReacted = userIds.includes(user?.id || '');
              return (
                <button
                  key={key}
                  onClick={() => {
                    getSocket().emit('reaction:toggle', {
                      ticketId,
                      messageId: message.id,
                      emoji: key,
                      userId: user?.id,
                    });
                  }}
                  className={`flex items-center px-1.5 py-0.5 rounded-full text-[10px] border shadow-xs transition-all ${
                    iReacted
                      ? (highContrastMode ? 'bg-current text-background border-current' : 'bg-brand-50 dark:bg-brand-900 border-brand-200 dark:border-brand-700')
                      : (highContrastMode ? 'bg-transparent border-current' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700')
                  }`}
                >
                  <span>{emojiObj.emoji}</span>
                  {userIds.length > 1 && <span className="ml-0.5 font-bold opacity-80">{userIds.length}</span>}
                </button>
              );
            })}
          </div>
        )}

        {/* Reaction Picker — Positioned based on side */}
        <div className={`absolute top-1/2 -translate-y-1/2 transition-opacity z-50 ${isMine ? '-left-10' : '-right-10'}`}>
          <div className="relative" ref={pickerRef}>
            <button
              onClick={() => setShowPicker(!showPicker)}
              className={`p-1.5 rounded-full transition-all shadow-sm ${
                highContrastMode 
                  ? 'bg-white text-black border-2 border-black hover:bg-black hover:text-white dark:bg-black dark:text-white dark:border-white dark:hover:bg-white dark:hover:text-black' 
                  : 'bg-white/50 dark:bg-black/20 hover:bg-white dark:hover:bg-black/40 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'
              }`}
              title={t('add_reaction')}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={highContrastMode ? 3 : 2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
            {showPicker && (
              <div className={`absolute top-full mt-1 left-1/2 -translate-x-1/2 rounded-2xl shadow-2xl flex flex-row gap-1 p-1.5 z-[100] animate-soft-bounce border ${
                highContrastMode 
                  ? 'bg-black text-white border-2 border-white dark:bg-white dark:text-black dark:border-2 dark:border-black' 
                  : 'bg-white dark:bg-slate-800 border-black/20 dark:border-white/20'
              }`}>
                {REACTION_EMOJIS.map((e) => (
                  <button
                    key={e.key}
                    onClick={() => {
                      getSocket().emit('reaction:toggle', {
                        ticketId,
                        messageId: message.id,
                        emoji: e.key,
                        userId: user?.id,
                      });
                      setShowPicker(false);
                    }}
                    className="hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full p-1.5 text-base transition-transform hover:scale-135"
                  >
                    {e.emoji}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
