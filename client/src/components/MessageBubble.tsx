import { useState, useEffect } from 'react';
import { useStoreShallow } from '../store/useStore';
import UserAvatar from './UserAvatar';
import GuestBadge from './GuestBadge';
import { getSocket } from '../hooks/useSocket';
import { useT } from '../i18n';
import { Message } from '../types';
import { DeliveryStatus, MessageContent } from './chat';
import { safeDate } from '../utils/dateUtils';
import { REACTION_EMOJIS } from '../constants';
import { CornerUpLeft, Pencil, Trash2, Loader2, Ban, Ghost } from 'lucide-react';
import ConfirmDialog from './ConfirmDialog';
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
  highlightQuery?: string;
  isSearchMatch?: boolean;
  isCurrentSearchMatch?: boolean;
  suppressActions?: boolean;
}

export default function MessageBubble({ message, ticketId, isGroupStart = true, isGroupEnd = true, aiConfig, onReply, highlightQuery, isSearchMatch, isCurrentSearchMatch, suppressActions }: MessageBubbleProps) {
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
  const [confirmDelete, setConfirmDelete] = useState(false);

  const hasContent = message.text || message.originalText || message.mediaUrl || (message.attachments && message.attachments.length > 0);
  const isDeleted = !!message.deletedAt || !hasContent;
  const isEdited = !!message.editedAt;

  if (message.system) {
    // Resolve i18n: prefixed keys to localized text at render time
    const systemText = message.text?.startsWith('i18n:')
      ? t(message.text.slice(5)) || message.text
      : message.text;
    return (
      <div className="flex justify-center py-2">
        <span className="text-[10px] uppercase tracking-widest px-4 py-1 font-bold bg-bg-elevated text-text-muted border border-border">
          {systemText}
        </span>
      </div>
    );
  }

  const isMine = message.senderId === user?.id;
  const isWhisper = !!message.whisper;

  // Server-authoritative GUEST flag — denormalized onto the message at
  // insert time (migration 0006). Works for historical senders in closed
  // tickets as well as live chats; no presence-store lookup needed.
  // See docs/superpowers/specs/partner-sso-b2b-guest.md.
  const isSenderExternal = !!message.senderIsExternal;

  const originalDisplayText = isDeleted ? (t('message_deleted') || 'This message was deleted') : (message.text || '');
  // Show translated text if available and user hasn't toggled to original
  const displayText = (!isDeleted && translated && !showOriginal) ? translated : originalDisplayText;

  const langToLocale: Record<string, string> = { nl: 'nl-BE', fr: 'fr-BE', en: 'en-GB' };
  const timeLocale = langToLocale[user?.lang || 'en'] || 'en-GB';
  const msgDate = safeDate(message.timestamp || message.createdAt);
  const time = msgDate
    ? msgDate.toLocaleTimeString(timeLocale, { hour: '2-digit', minute: '2-digit' })
    : '—';

  // Check if message is within edit window (15 min)
  const ageMs = msgDate ? Date.now() - msgDate.getTime() : Infinity;
  const canEdit = isMine && !message.system && !isDeleted && !message.mediaUrl && ageMs < 15 * 60 * 1000;
  const canDelete = (isMine || user?.role === 'admin' || user?.role === 'support' || user?.isPlatformOperator) && !message.system && !isDeleted;

  function startEdit() {
    setEditText(message.text || message.originalText || '');
    setEditing(true);
    setShowActions(false);
  }

  function submitEdit() {
    if (!editText.trim()) return;
    const socket = getSocket();
    if (!socket?.connected) return;
    socket.emit('message:edit', { ticketId, messageId: message.id, text: editText.trim() });
    setEditing(false);
  }

  function deleteMessage() {
    const socket = getSocket();
    if (!socket?.connected) return;
    socket.emit('message:delete', { ticketId, messageId: message.id });
    setShowActions(false);
    setConfirmDelete(false);
  }

  // Whisper styling must take precedence over the sent/received split:
  // a whisper from the *current* user is still a whisper (purple bg, mono
  // body, run separators) — not a regular sent bubble. The previous order
  // checked `isMine` first, so own-whispers never reached the whisper
  // branch and rendered with the blue sent-bubble style.
  const bubbleClasses = isDeleted
    ? 'bg-bg-elevated border-l-2 border-border'
    : isWhisper
      ? 'bubble-whisper'
      : isMine
        ? 'bubble-sent'
        : 'bubble-received';

  const isSupport = !isMine && (message.senderRole === 'support' || message.senderRole === 'admin');

  return (
    <div
      id={`msg-${message.id}`}
      className={`group flex w-full ${isGroupEnd ? 'mb-3' : 'mb-0.5'} px-4 flex-row${isCurrentSearchMatch ? ' bg-accent-amber/25' : isSearchMatch ? ' bg-accent-amber/10' : ''}`}
      onMouseEnter={() => !isDeleted && !suppressActions && setShowActions(true)}
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
            <GuestBadge isExternal={isSenderExternal} />
            {isSupport && (
              <span className="text-[8px] font-mono font-bold uppercase tracking-wider px-1 py-px border border-accent-blue text-accent-blue leading-none">
                {t('support') || 'SUPPORT'}
              </span>
            )}
          </div>
        )}

        {isWhisper && isGroupStart && (
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-flex items-center gap-1 text-[9px] font-mono font-bold uppercase tracking-[0.16em] text-accent-purple">
              <Ghost className="w-[10px] h-[10px]" strokeWidth={2.5} />
              {t('whisper_label') || 'Whisper'}
            </span>
            <span className="text-[10px] font-mono font-bold uppercase tracking-tight text-text-muted">
              {message.senderName}
            </span>
            <GuestBadge isExternal={isSenderExternal} />
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
          ) : isDeleted ? (
            <div className="flex items-center gap-1.5 text-[12px] text-text-muted italic opacity-60">
              <Ban size={14} strokeWidth={1.5} className="shrink-0" />
              {t('message_deleted') || 'This message was deleted'}
            </div>
          ) : (
            <MessageContent
              message={message}
              displayText={displayText}
              isDeleted={isDeleted}
              bionicReading={bionicReading}
              highlightQuery={highlightQuery}
            />
          )}
        </div>

        {/* Translation indicator */}
        {needsTranslation && !isDeleted && (
          <div className="flex items-center gap-2 mt-1.5 -mb-0.5">
            {translating ? (
              <span className="text-[9px] font-bold opacity-40 italic flex items-center gap-1">
                <Loader2 className="animate-spin" size={10} />
                {t('translating') || 'translating...'}
              </span>
            ) : translated ? (
              <button
                onClick={() => setShowOriginal(!showOriginal)}
                className="text-[9px] font-bold text-text-muted hover:text-text-secondary underline underline-offset-2"
              >
                {showOriginal ? (t('show_translation') || 'Show translation') : (t('show_original') || `Show original (${message.senderLang})`)}
              </button>
            ) : null}
          </div>
        )}

        {/* Metadata row: timestamp + status + reactions inline */}
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {/* Reaction pills — inline with metadata */}
          {Object.entries(message.reactions || {}).map(([emoji, userIds]) => {
              const count = userIds.length;
              if (count === 0) return null;
              const iReacted = userIds.includes(user?.id || '');
              return (
                <button
                  key={emoji}
                  onClick={() => { const s = getSocket(); if (s?.connected) s.emit('message:react', { ticketId, messageId: message.id, emoji }); }}
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
        <div className="flex flex-col gap-0.5 ml-1 shrink-0 self-start pt-1">
          <div className="flex items-start gap-0.5">
            {REACTION_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                onClick={() => { const s = getSocket(); if (s?.connected) s.emit('message:react', { ticketId, messageId: message.id, emoji }); }}
                disabled={isDeleted}
                title={`React with ${emoji}`}
                aria-label={`React with ${emoji}`}
                className="w-6 h-6 flex items-center justify-center bg-bg-surface border border-border text-[11px] hover:bg-bg-elevated"
              >
                {emoji}
              </button>
            ))}
          </div>
          {(onReply || canEdit || canDelete) && (
            <div className="flex items-start gap-0.5">
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
                  <Pencil size={12} />
                </button>
              )}
              {canDelete && (
                <button
                  onClick={() => { setConfirmDelete(true); setShowActions(false); }}
                  title={t('delete') || 'Delete'}
                  className="w-6 h-6 flex items-center justify-center bg-bg-surface border border-border text-text-muted hover:text-accent-red text-[10px]"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {confirmDelete && (
        <ConfirmDialog
          title={t('delete') || 'Delete'}
          message={t('confirm_delete_message') || 'Delete this message? This cannot be undone.'}
          confirmLabel={t('delete') || 'Delete'}
          onConfirm={deleteMessage}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}
