import React, { useState, useRef, useEffect } from 'react';
import useStore from '../store/useStore';
import { getSocket } from '../hooks/useSocket';
import { useT } from '../i18n';

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

export default function MessageBubble({ message, ticketId }) {
  const { user } = useStore();
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

  const isMine = message.senderId === user.id;
  const hasTranslation = message.translatedText && message.translatedText !== message.text;
  const isWhisper = message.whisper;
  const senderName = message.senderName || message.senderId;

  const displayText =
    isMine || !hasTranslation
      ? message.text
      : showOriginal
        ? message.text
        : message.translatedText;

  const time = new Date(message.createdAt).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className={`flex gap-3 px-3 py-2 -mx-1 rounded-xl group transition-all duration-200 hover:bg-white/60 dark:hover:bg-brand-800/60 animate-fade-in ${isWhisper ? 'bg-violet-50/50 dark:bg-violet-950/20 hover:bg-violet-100/50 dark:hover:bg-violet-950/30 border border-violet-100/50 dark:border-violet-900/30' : 'border border-transparent'
      }`}>
      <Avatar name={senderName} isMine={isMine} />

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-0.5">
          <span className={`text-sm font-semibold ${isMine ? 'text-brand-600 dark:text-brand-400' : 'text-gray-800 dark:text-gray-100'
            }`}>
            {isMine ? `${senderName} (you)` : senderName}
          </span>
          <span className="text-xs text-gray-400">{time}</span>
          <div className="relative inline-flex" ref={pickerRef}>
            <button
              onClick={() => setShowPicker((v) => !v)}
              className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              title={t('add_reaction')}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
            {showPicker && (
              <div className="absolute left-0 top-full mt-1 bg-white dark:bg-brand-800 border border-gray-200 dark:border-brand-600 rounded-lg shadow-lg flex gap-0.5 p-1 z-20">
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
                    className="hover:bg-gray-100 dark:hover:bg-brand-700 rounded p-1 text-base transition-colors"
                  >
                    {e.emoji}
                  </button>
                ))}
              </div>
            )}
          </div>
          {isWhisper && (
            <span className="text-xs text-violet-500 dark:text-violet-400 font-medium flex items-center gap-0.5">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
              </svg>
              {t('whisper_label')}
            </span>
          )}
        </div>

        <p className={`text-sm break-words whitespace-pre-wrap leading-relaxed ${isWhisper
            ? 'text-violet-700 dark:text-violet-300 italic'
            : 'text-gray-700 dark:text-gray-200'
          }`}>
          {displayText}
        </p>

        {message.mediaUrl && (
          <a href={message.mediaUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block">
            <img
              src={message.mediaUrl}
              alt="screenshot"
              className="rounded-lg max-w-sm max-h-48 object-contain border border-gray-200 dark:border-brand-600"
            />
          </a>
        )}

        {(hasTranslation) && (
          <div className="mt-1">
            <button
              onClick={() => setShowOriginal((v) => !v)}
              className="text-xs text-brand-500 hover:text-brand-700 dark:hover:text-brand-300 underline"
            >
              {showOriginal ? t('translation') : `${t('original')} (${LANG_LABEL[message.senderLang]})`}
            </button>
            {isMine && (
              <span className="text-xs text-gray-400 ml-2">{t('translated_for_recipient')}</span>
            )}
          </div>
        )}

        {/* Reactions display */}
        {message.reactions && Object.keys(message.reactions).length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
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
                  className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs border transition-colors ${iReacted
                      ? 'bg-brand-50 dark:bg-brand-900/30 border-brand-300 dark:border-brand-700'
                      : 'bg-gray-100 dark:bg-gray-700 border-gray-200 dark:border-brand-600 hover:bg-gray-200 dark:hover:bg-gray-600'
                    }`}
                >
                  <span>{emojiObj.emoji}</span>
                  <span className="text-gray-600 dark:text-gray-300">{userIds.length}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
}
