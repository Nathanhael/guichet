import { useState, useEffect } from 'react';
import { useStoreShallow } from '../store/useStore';
import UserAvatar from './UserAvatar';
import BionicText from './BionicText';
import { getSocket } from '../hooks/useSocket';
import { useT } from '../i18n';
import { Message } from '../types';
import { AttachmentGrid, DeliveryStatus, QuoteBlock, LinkPreviewCard } from './chat';
import { safeDate } from '../utils/dateUtils';
import { hasMarkdownSyntax, renderMarkdown } from '../utils/markdown';
import { REACTION_EMOJIS } from '../constants';
import { CornerUpLeft } from 'lucide-react';
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
  onReply?: (message: Message) => void;
}

export default function MessageBubble({ message, ticketId, isGroupStart = true, isGroupEnd = true, aiConfig, onReply }: MessageBubbleProps) {
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

  const isDeleted = !!message.deletedAt || (!message.text && !message.originalText && !message.mediaUrl && (!message.attachments || message.attachments.length === 0));
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
  const canEdit = isMine && !message.system && !isDeleted && !message.mediaUrl && ageMs < 15 * 60 * 1000;
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

  const bubbleClasses = isDeleted
    ? 'bg-bg-elevated border-l-2 border-border'
    : isMine
      ? 'bubble-sent'
      : isWhisper
        ? 'bubble-whisper'
        : 'bubble-received';

  const isSupport = !isMine && (message.senderRole === 'support' || message.senderRole === 'admin');

  return (
    <div
      id={`msg-${message.id}`}
      className={`group flex w-full ${isGroupEnd ? 'mb-3' : 'mb-0.5'} px-4 flex-row transition-colors duration-150`}
      onMouseEnter={() => !isDeleted && setShowActions(true)}
      onMouseLeave={() => { setShowActions(false); }}
    >
      <div className="flex flex-col justify-end w-7 shrink-0 mr-3">
        {isGroupStart && !isWhisper && (
          <UserAvatar
            userId={message.senderId}
            name={message.senderName || 'User'}
            size="xs"
          />
        )}
      </div>

      <div className={`relative max-w-[75%] min-w-[60px] px-3 py-2 ${bubbleClasses}`}>

        {!isMine && !isWhisper && isGroupStart && (
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-[11px] font-mono font-bold uppercase tracking-tight text-text-muted">
              {message.senderName}
            </span>
            {isSupport && (
              <span className="text-[8px] font-mono font-bold uppercase tracking-wider px-1 py-px border border-accent-blue text-accent-blue leading-none">
                {t('support') || 'SUPPORT'}
              </span>
            )}
          </div>
        )}

        {isWhisper && isGroupStart && (
          <div className="flex items-center gap-1.5 mb-1 text-[10px] font-bold uppercase tracking-widest text-accent-purple">
            {t('internal_note') || 'Internal Note'}
          </div>
        )}

        {message.replyTo && (
          <QuoteBlock
            senderName={message.replyTo.senderName}
            text={message.replyTo.text}
            isDeleted={!message.replyTo.text && !message.replyTo.mediaUrl}
            onClick={() => {
              const el = document.getElementById(`msg-${message.replyTo!.id}`);
              if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                el.classList.add('bg-accent-blue/10');
                setTimeout(() => el.classList.remove('bg-accent-blue/10'), 1000);
              }
            }}
          />
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
          ) : isDeleted ? (
            <div className="flex items-center gap-1.5 text-[12px] text-text-muted italic opacity-60">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
              </svg>
              {t('message_deleted') || 'This message was deleted'}
            </div>
          ) : displayText.trim() && displayText.trim() !== '[attachment]' ? (
            !bionicReading && hasMarkdownSyntax(displayText) ? (
              <div
                className="msg-markdown text-[13px] break-words leading-snug text-left max-h-60 overflow-y-auto"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(displayText) }}
              />
            ) : (
              <div className="text-[14px] break-words whitespace-pre-wrap leading-snug text-left max-h-60 overflow-y-auto">
                {bionicReading ? (
                  <BionicText text={displayText} />
                ) : (
                  displayText
                )}
              </div>
            )
          ) : null}

          {/* Multi-file attachments */}
          {!isDeleted && message.attachments && message.attachments.length > 0 && (
            <AttachmentGrid attachments={message.attachments} />
          )}

          {/* Legacy single image — backward compat */}
          {!isDeleted && !message.attachments && message.mediaUrl && (message.mediaUrl.startsWith('/uploads/') || message.mediaUrl.startsWith('/api/v1/uploads/')) && (() => {
            const url = message.mediaUrl!;
            const filename = url.split('/').pop() || 'file';
            const ext = filename.split('.').pop()?.toLowerCase() || '';
            const isImageExt = ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext);

            if (isImageExt) {
              return (
                <div className="mt-2 border border-border">
                  <img src={url} alt="attachment" className="w-full h-auto object-cover max-h-96" referrerPolicy="no-referrer" />
                </div>
              );
            }

            const fileLabel = ext === 'pdf' ? 'PDF' : ext === 'docx' || ext === 'doc' ? 'Word' : ext === 'xlsx' || ext === 'xls' ? 'Excel' : ext === 'csv' ? 'CSV' : ext === 'txt' ? 'Text' : ext.toUpperCase();
            return (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 flex items-center gap-2.5 px-3 py-2 border border-border bg-bg-surface hover:bg-bg-elevated"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-accent-blue shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
                <div className="flex flex-col min-w-0">
                  <span className="text-[12px] font-mono font-bold text-text-primary truncate">{filename}</span>
                  <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-text-muted">{fileLabel}</span>
                </div>
              </a>
            );
          })()}

          {!isDeleted && message.linkPreviews && message.linkPreviews.length > 0 && (
            <div className="flex flex-col gap-1">
              {message.linkPreviews.map((preview) => (
                <LinkPreviewCard key={preview.url} {...preview} />
              ))}
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

        {/* Metadata row: timestamp + status + reactions inline */}
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {/* Reaction pills — inline with metadata */}
          {Object.keys(message.reactions || {}).length > 0 &&
            Object.entries(message.reactions).map(([emoji, userIds]) => {
              const count = userIds.length;
              if (count === 0) return null;
              const iReacted = userIds.includes(user?.id || '');
              return (
                <button
                  key={emoji}
                  onClick={() => getSocket().emit('message:react', { ticketId, messageId: message.id, emoji })}
                  disabled={isDeleted}
                  aria-label={`${emoji}, ${count} reaction${count !== 1 ? 's' : ''}${iReacted ? ', you reacted' : ''}`}
                  className={`inline-flex items-center gap-0.5 px-1 py-px font-mono text-[10px] font-bold border ${
                    iReacted
                      ? 'border-accent-blue text-accent-blue bg-bg-elevated'
                      : 'border-border text-text-muted hover:border-text-muted'
                  } ${isDeleted ? 'opacity-40 cursor-default' : 'cursor-pointer'}`}
                >
                  <span>{emoji}</span>
                  <span>{count}</span>
                </button>
              );
            })}

          {/* Spacer pushes timestamp to right */}
          <span className="ml-auto" />

          <span className="flex items-center gap-1.5 opacity-40 shrink-0">
            {isEdited && !isDeleted && (
              <span className="text-[9px] font-bold italic">{t('edited') || 'edited'}</span>
            )}
            <span className="mono-timestamp">{time}</span>
            {isMine && !isDeleted && !message.system && (
              <DeliveryStatus deliveredAt={message.deliveredAt} readAt={message.readAt} />
            )}
          </span>
        </div>

      </div>

      {/* Action buttons — sibling in flex row, to the right of bubble */}
      {showActions && !editing && (
        <div className="flex items-start gap-0.5 ml-1 shrink-0 self-start pt-1">
          {REACTION_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              onClick={() => getSocket().emit('message:react', { ticketId, messageId: message.id, emoji })}
              disabled={isDeleted}
              title={`React with ${emoji}`}
              aria-label={`React with ${emoji}`}
              className="w-6 h-6 flex items-center justify-center bg-bg-surface border border-border text-[11px] hover:bg-bg-elevated"
            >
              {emoji}
            </button>
          ))}
          {onReply && !isDeleted && (
            <button
              onClick={() => onReply(message)}
              title={t('reply') || 'Reply'}
              className="w-6 h-6 flex items-center justify-center bg-bg-surface border border-border text-text-muted hover:text-accent-blue text-[10px]"
            >
              <CornerUpLeft size={14} />
            </button>
          )}
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
  );
}
