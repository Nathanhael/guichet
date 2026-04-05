import { useState, useEffect } from 'react';
import { useStoreShallow } from '../store/useStore';
import UserAvatar from './UserAvatar';
import BionicText from './BionicText';
import { getSocket } from '../hooks/useSocket';
import { useT } from '../i18n';
import { Message } from '../types';
import { safeDate } from '../utils/dateUtils';
import { useAutoTranslation } from '../hooks/useTranslation';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../../../server/trpc/router';

type AiConfig = inferRouterOutputs<AppRouter>['partner']['getAiConfig'];

interface MessageBubbleProps {
  message: Message;
  ticketId: string;
  isGroupStart?: boolean;
  isGroupEnd?: boolean;
  aiConfig?: AiConfig;
}

export default function MessageBubble({ message, ticketId, isGroupStart = true, isGroupEnd = true, aiConfig }: MessageBubbleProps) {
  const { user, bionicReading } = useStoreShallow(s => ({
    user: s.user,
    bionicReading: s.bionicReading,
  }));
  const t = useT();

  const translationEnabled = aiConfig?.translation === true;

  // Auto-translate if senderLang !== viewerLang (lazy — queued via concurrency limiter)
  const { translated, loading: translating, translate, showOriginal, setShowOriginal, needsTranslation } = useAutoTranslation({
    messageId: message.id,
    text: message.text || message.originalText || '',
    senderLang: message.senderLang || '',
    viewerLang: user?.lang || 'en',
    enabled: translationEnabled && !message.system && !message.whisper,
  });

  // Trigger translation on first render — concurrency limiter in the hook prevents N simultaneous API calls
  useEffect(() => {
    if (needsTranslation) translate();
  }, [needsTranslation, translate]);
  const [showActions, setShowActions] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');

  const isDeleted = !!message.deletedAt;
  const isEdited = !!message.editedAt;

  if (message.system) {
    return (
      <div className="flex justify-center py-2">
        <span className="text-[10px] uppercase tracking-widest px-4 py-1 font-bold bg-bg-elevated text-text-muted border border-border">
          {message.text}
        </span>
      </div>
    );
  }

  const isMine = message.senderId === user?.id;
  const isWhisper = !!message.whisper;

  const originalDisplayText = isDeleted ? (t('message_deleted') || 'This message was deleted') : (message.text || '');
  // Show translated text if available and user hasn't toggled to original
  const displayText = (!isDeleted && translated && !showOriginal) ? translated : originalDisplayText;

  const msgDate = safeDate(message.timestamp || message.createdAt);
  const time = msgDate
    ? msgDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : '—';

  // Check if message is within edit window (15 min)
  const ageMs = msgDate ? Date.now() - msgDate.getTime() : Infinity;
  const canEdit = isMine && !message.system && !isDeleted && ageMs < 15 * 60 * 1000;
  const canDelete = (isMine || user?.role === 'admin' || user?.isPlatformOperator) && !message.system && !isDeleted;

  function startEdit() {
    setEditText(message.text || message.originalText || '');
    setEditing(true);
    setShowActions(false);
  }

  function submitEdit() {
    if (!editText.trim()) return;
    getSocket().emit('message:edit', { ticketId, messageId: message.id, text: editText.trim() });
    setEditing(false);
  }

  function deleteMessage() {
    getSocket().emit('message:delete', { ticketId, messageId: message.id });
    setShowActions(false);
  }

  const bubbleClasses = isMine
    ? 'bubble-sent'
    : isWhisper
      ? 'bubble-whisper'
      : 'bubble-received';

  return (
    <div
      className={`group flex w-full ${isGroupEnd ? 'mb-4' : 'mb-1'} px-4 ${isMine ? 'flex-row-reverse' : 'flex-row'}`}
      onMouseEnter={() => !isDeleted && setShowActions(true)}
      onMouseLeave={() => { setShowActions(false); }}
    >
      <div className={`flex flex-col justify-end w-6 shrink-0 ${isMine ? 'ml-3' : 'mr-3'}`}>
        {!isMine && isGroupStart && !isWhisper && (
          <UserAvatar
            userId={message.senderId}
            name={message.senderName || 'User'}
            size="xs"
          />
        )}
      </div>

      <div className={`relative max-w-[75%] min-w-[60px] px-4 py-2.5 ${bubbleClasses} ${isDeleted ? 'opacity-50 italic' : ''}`}>

        {!isMine && !isWhisper && isGroupStart && (
          <div className="text-[11px] font-mono font-bold mb-1 uppercase tracking-tight text-text-muted">
            {message.senderName}
          </div>
        )}

        {isWhisper && isGroupStart && (
          <div className="flex items-center gap-1.5 mb-1 text-[10px] font-bold uppercase tracking-widest text-accent-purple">
            {t('internal_note') || 'Internal Note'}
          </div>
        )}

        <div className="relative">
          {editing ? (
            <div className="flex flex-col gap-2">
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitEdit(); }
                  if (e.key === 'Escape') setEditing(false);
                }}
                className="w-full resize-none bg-bg-surface border border-border px-2 py-1 text-sm"
                rows={2}
                autoFocus
              />
              <div className="flex gap-1 justify-end">
                <button onClick={() => setEditing(false)} className="text-[9px] font-bold uppercase px-2 py-0.5 text-text-muted hover:text-text-primary">
                  {t('cancel') || 'Cancel'}
                </button>
                <button onClick={submitEdit} className="text-[9px] font-bold uppercase px-2 py-0.5 bg-accent-blue text-[var(--color-btn-text-inverse)]">
                  {t('save') || 'Save'}
                </button>
              </div>
            </div>
          ) : (
            <div className="text-[15px] break-words whitespace-pre-wrap leading-normal font-medium tracking-tight uppercase">
              {bionicReading && !isDeleted ? (
                <BionicText text={displayText} />
              ) : (
                displayText
              )}
            </div>
          )}

          {message.mediaUrl && !isDeleted && message.mediaUrl.startsWith('/api/v1/uploads/') && (
            <div className="mt-3 border border-border">
              <img
                src={message.mediaUrl}
                alt="attachment"
                className="w-full h-auto object-cover max-h-96"
                referrerPolicy="no-referrer"
              />
            </div>
          )}
        </div>

        {/* Translation indicator */}
        {needsTranslation && !isDeleted && (
          <div className="flex items-center gap-2 mt-1.5 -mb-0.5">
            {translating ? (
              <span className="text-[9px] font-bold opacity-40 italic flex items-center gap-1">
                <svg className="animate-spin h-2.5 w-2.5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                translating...
              </span>
            ) : translated ? (
              <button
                onClick={() => setShowOriginal(!showOriginal)}
                className="text-[9px] font-bold text-text-muted hover:text-text-secondary underline underline-offset-2"
              >
                {showOriginal ? 'Show translation' : `Show original (${message.senderLang})`}
              </button>
            ) : null}
          </div>
        )}

        <div className={`flex items-center justify-end gap-2 mt-2 -mr-1 opacity-40`}>
          {isEdited && !isDeleted && (
            <span className="text-[9px] font-bold italic">{t('edited') || 'edited'}</span>
          )}
          <span className="mono-timestamp">
            {time}
          </span>
          {isMine && !isDeleted && (
            <span className="text-[10px] font-bold">{message.readAt ? 'R' : 'D'}</span>
          )}
        </div>

        {/* Action buttons (hover) */}
        {showActions && !editing && (canEdit || canDelete) && (
          <div className={`absolute top-0 ${isMine ? 'left-0 -translate-x-full pl-1' : 'right-0 translate-x-full pr-1'} flex gap-0.5 opacity-0 group-hover:opacity-100`}>
            {canEdit && (
              <button
                onClick={startEdit}
                title={t('edit') || 'Edit'}
                className="w-6 h-6 flex items-center justify-center bg-bg-surface border border-border text-text-muted hover:text-accent-blue text-[10px]"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
              </button>
            )}
            {canDelete && (
              <button
                onClick={deleteMessage}
                title={t('delete') || 'Delete'}
                className="w-6 h-6 flex items-center justify-center bg-bg-surface border border-border text-text-muted hover:text-accent-red text-[10px]"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
