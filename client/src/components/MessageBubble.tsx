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

interface AvatarProps {
  name?: string;
  isMine: boolean;
}

function Avatar({ name, isMine }: AvatarProps) {
  const initials = name
    ? name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
    : '?';
  return (
    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 select-none shadow-sm ${isMine
        ? 'bg-gradient-to-br from-brand-500 to-brand-600 text-white'
        : 'bg-gradient-to-br from-solarized-base2 to-solarized-base1 dark:from-gray-700 dark:to-gray-800 text-solarized-base01 dark:text-gray-200'
      }`}>
      {initials}
    </div>
  );
}

interface MessageBubbleProps {
  message: Message;
  ticketId: string;
  searchQuery?: string;
}

export default function MessageBubble({ message, ticketId, searchQuery: _searchQuery = '' }: MessageBubbleProps) {
  const { user, dyslexicMode, bionicReading } = useStore();
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
        <span className="text-xs text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-3 py-1 rounded-full font-medium">
          {message.text}
        </span>
      </div>
    );
  }




  const isMine = message.senderId === user?.id;

  const isWhisper = !!message.whisper;
  const senderName = message.senderName || message.senderId;

  // AI Logic
  const hasImproved = message.improvedText && message.improvedText !== message.originalText;
  const hasTranslated = !message.translationSkipped && message.processedText !== message.improvedText;

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

  return (
    <div className={`flex w-full mb-2 px-1 animate-fade-in justify-start`}>
      {!isMine && !message.system && (
        <div className="flex flex-col justify-end pb-1 mr-1">
          <Avatar name={senderName} isMine={isMine} />
        </div>
      )}

      <div className={`relative max-w-[85%] min-w-[80px] group transition-all duration-200 ${
        isMine 
          ? 'bg-[#dcf8c6] dark:bg-[#056162] text-slate-900 dark:text-slate-100 rounded-2xl rounded-tl-none shadow-sm' 
          : isWhisper 
            ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-900 dark:text-violet-100 rounded-2xl rounded-tl-none shadow-sm border border-violet-200/50 dark:border-violet-700/50'
            : 'bg-white dark:bg-[#262d31] text-slate-900 dark:text-slate-100 rounded-2xl rounded-tl-none shadow-sm'
      } px-3 py-1.5 mb-1`}>
        

        <div className="relative pr-2">
          <p className={`text-[14px] break-words whitespace-pre-wrap leading-tight ${
            isWhisper ? 'italic opacity-90' : ''
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
                className="rounded-lg max-w-full h-auto border border-black/5 dark:border-white/5"
              />
            </a>
          )}
        </div>

        {/* Footer with AI toggles and Timestamp */}
        <div className="flex items-center justify-end gap-2 mt-1 -mr-1">
          {(!isMine && !isWhisper && (hasImproved || hasTranslated)) && (
            <button
              onClick={() => setShowOriginal((v) => !v)}
              className="text-[9px] font-bold text-brand-500/80 hover:text-brand-700 dark:hover:text-brand-300 underline uppercase transition-colors"
            >
              {showOriginal ? t('translation') : `${t('original')}${message.senderLang ? ` (${LANG_LABEL[message.senderLang] || message.senderLang.toUpperCase()})` : ''}`}
            </button>
          )}
          
          <div className="flex items-center gap-1">
            <span className={`text-[10px] select-none ${
              isMine ? 'text-slate-500 dark:text-brand-200/70' : 'text-slate-400 dark:text-slate-500'
            }`}>
              {time}
            </span>
            {isMine && (
              <svg viewBox="0 0 16 11" width="13" height="13" className={`fill-current ${message.readAt ? 'text-sky-500' : 'text-slate-400 dark:text-brand-200/50'}`}>
                <path d="M11.022 1.132L5.808 6.643 3.65 4.363l-.71.67 2.868 3.033 5.922-6.265zM14.991 1.132l-5.214 5.511-.321-.34-.71.671.677.716 5.568-5.888-.71-.67zM7.051 8.066l-.71-.67-.354.374.71.67.354-.374z" />
              </svg>
            )}
          </div>
        </div>

        {/* Integrated Reactions Display — No longer absolute overlay to avoid clipping */}
        {message.reactions && typeof message.reactions === 'object' && Object.keys(message.reactions).length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5 pt-1.5 border-t border-black/5 dark:border-white/5">
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
                      ? 'bg-brand-50 dark:bg-brand-900 border-brand-200 dark:border-brand-700'
                      : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'
                  }`}
                  title={userIds.length > 1 ? `${userIds.length} reactions` : undefined}
                >
                  <span>{emojiObj.emoji}</span>
                  {userIds.length > 1 && <span className="ml-0.5 font-bold opacity-80">{userIds.length}</span>}
                </button>
              );
            })}
          </div>
        )}

        {/* Reaction Picker — Triggered by click, horizontal layout */}
        <div className="absolute top-1/2 -translate-y-1/2 -right-10 transition-opacity z-50">
          <div className="relative" ref={pickerRef}>
            <button
              onClick={() => setShowPicker(!showPicker)}
              className="p-1.5 rounded-full bg-white/50 dark:bg-black/20 hover:bg-white dark:hover:bg-black/40 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-all shadow-sm"
              title={t('add_reaction')}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
            {showPicker && (
              <div className="absolute top-full mt-1 left-1/2 -translate-x-1/2 bg-white dark:bg-slate-800 border border-black/20 dark:border-white/20 rounded-2xl shadow-2xl flex flex-row gap-1 p-1.5 z-[100] animate-soft-bounce">
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
