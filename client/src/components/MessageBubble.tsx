import React, { useState, useRef, useEffect } from 'react';
import useStore from '../store/useStore';
import { getSocket } from '../hooks/useSocket';
import { useT } from '../i18n';
import BionicText from './BionicText';
import { Message, UserRole, Ticket } from '../types';

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

export default function MessageBubble({ message, ticketId, searchQuery = '' }: MessageBubbleProps) {
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

  const allTickets = useStore(s => s.tickets || []);
  const allArchived = useStore(s => s.archivedTickets || []);
  const ticket = allTickets.find(t => t.id === ticketId) || allArchived.find(t => t.id === ticketId);

  const isMine = message.sender_id === user?.id;
  const isAgent = ticket && message.sender_id === ticket.agent_id;
  const isExpertParticipant = ticket && message.sender_id !== ticket.agent_id && !message.system;

  const isWhisper = !!message.whisper;
  const senderName = message.sender_name || message.sender_id;

  // AI Logic
  const hasImproved = message.improved_text && message.improved_text !== message.original_text;
  const hasTranslated = !message.translation_skipped && message.processed_text !== message.improved_text;
  const isFallback = !!message.fallback;

  // Decide what to show
  let mainText = message.processed_text || message.text || '';
  if (isMine) {
    mainText = message.original_text || message.text || '';
  } else if (showOriginal) {
    mainText = message.original_text || message.text || '';
  }

  const displayText = mainText;

  const time = new Date(message.timestamp || message.created_at).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className={`flex gap-3 px-3 py-2 -mx-1 rounded-xl group transition-all duration-200 hover:bg-solarized-base2/60 dark:hover:bg-brand-800/60 animate-fade-in ${isWhisper ? 'bg-violet-50/50 dark:bg-violet-950/20 hover:bg-violet-100/50 dark:hover:bg-violet-950/30 border border-violet-100/50 dark:border-violet-900/30' : 'border border-transparent'
      }`}>
      <Avatar name={senderName} isMine={isMine} />

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-0.5">
          <span className={`text-sm font-semibold ${isMine ? 'text-brand-600 dark:text-brand-400' : 'text-solarized-base01 dark:text-gray-100'
            }`}>
            {isMine ? `${senderName} (you)` : senderName}
          </span>
          <span className="text-xs text-solarized-base1">{time}</span>
          <div className="relative inline-flex" ref={pickerRef}>
            <button
              onClick={() => setShowPicker((v) => !v)}
              className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-solarized-base2 dark:hover:bg-gray-600 text-solarized-base1 hover:text-solarized-base01 dark:hover:text-gray-200"
              title={t('add_reaction')}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
            {showPicker && (
              <div className="absolute left-0 top-full mt-1 bg-white/95 backdrop-blur-md dark:bg-brand-800 border border-solarized-base2 dark:border-brand-600 rounded-xl shadow-xl flex gap-1 p-1.5 z-20">
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
                    className="hover:bg-solarized-base2 dark:hover:bg-brand-700 rounded-lg p-1.5 text-lg transition-transform hover:scale-125 focus:scale-125"
                  >
                    {e.emoji}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <p className={`text-sm break-words whitespace-pre-wrap leading-relaxed ${isWhisper
          ? 'text-violet-700 dark:text-violet-300 italic'
          : 'text-solarized-base00 dark:text-gray-200'
          }`}>
          {displayText}
        </p>

        {message.mediaUrl && (
          <a href={message.mediaUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block">
            <img
              src={message.mediaUrl}
              alt="screenshot"
              className="rounded-lg max-w-sm max-h-48 object-contain border border-solarized-base2 dark:border-brand-600"
            />
          </a>
        )}

        {(!isMine && !isWhisper && (hasImproved || hasTranslated)) && (
          <div className={`mt-1 flex items-center gap-2 flex-row`}>
            <button
              onClick={() => setShowOriginal((v) => !v)}
              className="text-[10px] font-bold text-brand-500 hover:text-brand-700 dark:hover:text-brand-300 underline uppercase tracking-tight"
            >
              {showOriginal ? t('translation') : `${t('original')}${message.sender_lang ? ` (${LANG_LABEL[message.sender_lang] || message.sender_lang.toUpperCase()})` : ''}`}
            </button>
          </div>
        )}

        {/* Reactions display */}
        {message.reactions && typeof message.reactions === 'object' && Object.keys(message.reactions).length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
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
                  className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs border transition-colors ${iReacted
                      ? 'bg-brand-50 dark:bg-brand-900/30 border-brand-300 dark:border-brand-700'
                      : 'bg-solarized-base3 dark:bg-gray-700 border-solarized-base2 dark:border-brand-600 hover:bg-solarized-base2 dark:hover:bg-gray-600'
                    }`}
                >
                  <span>{emojiObj.emoji}</span>
                  <span className="text-solarized-base01 dark:text-gray-300">{userIds.length}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
