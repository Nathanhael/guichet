import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import useStore from '../store/useStore';
import { getSocket } from '../hooks/useSocket';
import { useT } from '../i18n';
import BionicText from './BionicText';
import UserAvatar from './UserAvatar';
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
  isGroupStart?: boolean;
  isGroupEnd?: boolean;
}

export default function MessageBubble({ message, ticketId, searchQuery: _searchQuery = '', isGroupStart = true, isGroupEnd = true }: MessageBubbleProps) {
  const { user, dyslexicMode, bionicReading, highContrastMode, agentOnline } = useStore();
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
      <motion.div 
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex justify-center py-1.5"
      >
        <span className={`text-[10px] uppercase tracking-wider px-3 py-1 rounded-full font-bold shadow-sm ${
          highContrastMode
            ? 'bg-black text-white dark:bg-white dark:text-black border-2 border-black dark:border-white'
            : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700'
        }`}>
          {message.text}
        </span>
      </motion.div>
    );
  }

  const isMine = message.senderId === user?.id;
  const isWhisper = !!message.whisper;
  const sentiment = (message as any).sentiment;

  // Sentiment Glow logic
  let sentimentGlow = '';
  if (sentiment != null && !highContrastMode) {
    if (sentiment > 0.4) sentimentGlow = 'ring-1 ring-emerald-400/30 shadow-[0_0_10px_rgba(52,211,153,0.15)]';
    else if (sentiment < -0.4) sentimentGlow = 'ring-1 ring-rose-400/30 shadow-[0_0_10px_rgba(244,63,94,0.15)]';
  }

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

  // Premium bubble styles
  let bubbleClasses = '';
  if (highContrastMode) {
    bubbleClasses = isMine
      ? 'bg-black text-white dark:bg-white dark:text-black border-2 border-black dark:border-white'
      : isWhisper
        ? 'bg-violet-900 text-white border-2 border-violet-500'
        : 'bg-white text-black dark:bg-black dark:text-white border-2 border-black dark:border-white';
  } else {
    bubbleClasses = isMine
      ? 'bg-gradient-to-br from-brand-500 to-brand-600 text-white shadow-md'
      : isWhisper
        ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-900 dark:text-violet-100 shadow-sm border border-violet-200/50 dark:border-violet-700/50'
        : 'bg-white dark:bg-brand-800/60 backdrop-blur-xl text-slate-900 dark:text-slate-100 shadow-sm border border-black/5 dark:border-white/5';
  }

  return (
    <motion.div 
      initial={{ opacity: 0, x: isMine ? 20 : -20, scale: 0.95 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      className={`flex w-full ${isGroupEnd ? 'mb-2' : 'mb-0.5'} px-2 ${isMine ? 'flex-row-reverse' : 'flex-row'}`}
    >
      {/* Avatar Container */}
      <div className={`flex flex-col justify-end w-10 shrink-0 ${isMine ? 'ml-2' : 'mr-2'}`}>
        {!isMine && isGroupStart && !isWhisper && (
          <UserAvatar 
            userId={message.senderId} 
            name={message.senderName || 'User'} 
            size="sm" 
            showStatus 
            isOnline={agentOnline[ticketId]}
          />
        )}
      </div>

      <div className={`relative max-w-[80%] min-w-[80px] group transition-all duration-200 px-3 py-1.5 rounded-2xl ${
        isMine 
          ? (isGroupStart ? 'rounded-tr-none' : '') 
          : (isGroupStart ? 'rounded-tl-none' : '')
      } ${bubbleClasses} ${sentimentGlow}`}>
        
        {/* Bubble Tail (Only on start of group) */}
        {!highContrastMode && isGroupStart && (
          <div className={isMine ? 'bubble-tail-mine' : 'bubble-tail-other'} />
        )}

        {/* Sender Name */}
        {!isMine && !isWhisper && isGroupStart && (
          <div className={`text-[10px] font-bold mb-0.5 opacity-70 ${highContrastMode ? 'text-current' : 'text-brand-600 dark:text-brand-400'}`}>
            {message.senderName}
          </div>
        )}
        
        {/* Whisper indicator */}
        {isWhisper && isGroupStart && (
          <div className="flex items-center gap-1 mb-1 text-[9px] font-bold uppercase tracking-widest opacity-60">
            <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            Internal mode
          </div>
        )}

        <div className="relative">
          {isWhisper || showOriginal || isMine ? (
            <p className={`text-[14px] break-words whitespace-pre-wrap leading-snug ${
              isWhisper ? 'italic' : ''
            } ${dyslexicMode ? 'font-lexend' : ''}`}>
              {bionicReading ? <BionicText text={displayText} /> : displayText}
            </p>
          ) : (
            <div className="space-y-3">
              {/* Parse structured response if present */}
              {(() => {
                const text = displayText;
                const hasSteps = text.includes('[STEPS]');
                const hasScript = text.includes('[CUSTOMER_SCRIPT]');
                const hasSummary = text.includes('[SUMMARY]');

                if (!hasSteps && !hasScript && !hasSummary) {
                  return (
                    <p className={`text-[14px] break-words whitespace-pre-wrap leading-snug ${dyslexicMode ? 'font-lexend' : ''}`}>
                      {bionicReading ? <BionicText text={text} /> : text}
                    </p>
                  );
                }

                // Split by tags
                const parts = text.split(/(\[STEPS\]|\[CUSTOMER_SCRIPT\]|\[SUMMARY\])/);
                let currentTag = '';
                const sections: Record<string, string> = {};

                parts.forEach(p => {
                  if (p === '[STEPS]' || p === '[CUSTOMER_SCRIPT]' || p === '[SUMMARY]') {
                    currentTag = p;
                  } else if (currentTag && p.trim()) {
                    sections[currentTag] = p.trim();
                  }
                });

                return (
                  <div className="space-y-3 py-1">
                    {sections['[SUMMARY]'] && (
                      <p className="text-[14px] font-bold text-brand-700 dark:text-brand-300 leading-tight">
                        {sections['[SUMMARY]']}
                      </p>
                    )}
                    
                    {sections['[STEPS]'] && (
                      <div className="bg-black/5 dark:bg-white/5 rounded-xl p-3 border border-black/5 dark:border-white/5">
                        <div className="flex items-center gap-2 mb-2 text-[10px] font-black uppercase tracking-widest opacity-50">
                          <LifeBuoy size={12} />
                          Internal Procedure
                        </div>
                        <div className="text-[13px] leading-relaxed whitespace-pre-wrap">
                          {bionicReading ? <BionicText text={sections['[STEPS]']} /> : sections['[STEPS]']}
                        </div>
                      </div>
                    )}

                    {sections['[CUSTOMER_SCRIPT]'] && (
                      <div className="bg-emerald-500/10 dark:bg-emerald-500/20 rounded-xl p-3 border border-emerald-500/20 dark:border-emerald-500/30">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400">
                            <Sparkles size={12} />
                            Tell the Customer
                          </div>
                          <button 
                            onClick={() => {
                              navigator.clipboard.writeText(sections['[CUSTOMER_SCRIPT]']);
                              // We could add a "Copied!" toast here
                            }}
                            className="text-[10px] font-bold bg-emerald-500 text-white px-2 py-0.5 rounded hover:bg-emerald-600 transition-colors"
                          >
                            Copy
                          </button>
                        </div>
                        <p className="text-[13px] text-emerald-900 dark:text-emerald-100 font-medium leading-snug italic">
                          "{sections['[CUSTOMER_SCRIPT]']}"
                        </p>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}

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

        {/* Footer */}
        <div className={`flex items-center justify-end gap-2 mt-1 -mr-1 ${isMine ? 'text-white/70' : 'text-solarized-base1'}`}>
          {(!isMine && !isWhisper && (message.improvedText || !message.translationSkipped)) && (
            <div className="relative group/ai">
              <button
                onClick={() => setShowOriginal((v) => !v)}
                className={`flex items-center gap-0.5 px-1 rounded hover:bg-black/5 dark:hover:bg-white/5 transition-colors ${
                  showOriginal ? 'text-accent-500 font-bold' : 'opacity-60'
                }`}
                title={showOriginal ? t('translation') : t('original')}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className={`w-3 h-3 ${!showOriginal ? 'animate-pulse' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-7.714 2.143L11 21l-2.286-6.857L1 12l7.714-2.143L11 3z" />
                </svg>
                <span className="text-[9px] uppercase font-bold">{showOriginal ? 'ORIG' : 'AI'}</span>
              </button>
            </div>
          )}
          
          <div className="flex items-center gap-1 opacity-60">
            <span className="text-[10px] select-none font-medium">
              {time}
            </span>
            {isMine && (
              <svg viewBox="0 0 16 11" width="13" height="13" className={`fill-current ${message.readAt ? (highContrastMode ? 'text-current' : 'text-white') : 'opacity-40'}`}>
                <path d="M11.022 1.132L5.808 6.643 3.65 4.363l-.71.67 2.868 3.033 5.922-6.265zM14.991 1.132l-5.214 5.511-.321-.34-.71.671.677.716 5.568-5.888-.71-.67zM7.051 8.066l-.71-.67-.354.374.71.67.354-.374z" />
              </svg>
            )}
          </div>
        </div>

        {/* Reactions Display */}
        {message.reactions && typeof message.reactions === 'object' && Object.keys(message.reactions).length > 0 && (
          <div className={`flex flex-wrap gap-1 mt-1.5 pt-1.5 border-t ${highContrastMode ? 'border-current' : 'border-white/10 dark:border-white/10'}`}>
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
                      ? (highContrastMode ? 'bg-current text-background border-current' : 'bg-white/20 border-white/30 text-white')
                      : (highContrastMode ? 'bg-transparent border-current' : 'bg-black/5 dark:bg-white/5 border-white/10')
                  }`}
                >
                  <span>{emojiObj.emoji}</span>
                  {userIds.length > 1 && <span className="ml-0.5 font-bold opacity-80">{userIds.length}</span>}
                </button>
              );
            })}
          </div>
        )}

        {/* Reaction Picker */}
        <div className={`absolute top-1/2 -translate-y-1/2 transition-opacity z-50 ${isMine ? '-left-10' : '-right-10'} opacity-0 group-hover:opacity-100`}>
          <div className="relative" ref={pickerRef}>
            <button
              onClick={() => setShowPicker(!showPicker)}
              className={`p-1.5 rounded-full transition-all shadow-sm ${
                highContrastMode 
                  ? 'bg-white text-black border-2 border-black hover:bg-black hover:text-white dark:bg-black dark:text-white dark:border-white dark:hover:bg-white dark:hover:text-black' 
                  : 'bg-white/80 dark:bg-brand-700/80 hover:bg-white dark:hover:bg-brand-600 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 backdrop-blur-md border border-white/20'
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
                  : 'bg-white/95 dark:bg-brand-800/95 border-white/20 backdrop-blur-xl'
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
                    className="hover:bg-slate-100 dark:hover:bg-brand-700 rounded-full p-1.5 text-base transition-transform hover:scale-135"
                  >
                    {e.emoji}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
