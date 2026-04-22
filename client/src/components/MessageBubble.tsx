import { useState, useEffect } from 'react';
import { useStoreShallow } from '../store/useStore';
import Avatar from './ui/Avatar';
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
    prewarmed: message.translations?.[user?.lang || 'en'],
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
        <span className="text-[11px] font-medium px-3 py-1 rounded-[var(--radius-pill)] bg-[var(--color-bg-elevated)] text-[var(--color-ink-muted)]">
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

  // Check if message is within edit window (15 min). Date.now() in render is
  // flagged impure; acceptable here — UI gating by wall-clock age, and the
  // worst case is showing Edit ~1s past the boundary until the next render.
  // Server enforces the window on submit.
  // eslint-disable-next-line react-hooks/purity
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
  // a whisper from the *current* user is still a whisper — dashed amber
  // border, amber tint — not a regular sent bubble. The previous order
  // checked `isMine` first, so own-whispers never reached the whisper
  // branch and rendered with the sent-bubble style.
  const bubbleClasses = isDeleted
    ? 'bg-[var(--color-bg-elevated)] rounded-[var(--radius-bubble)] text-[var(--color-ink-muted)]'
    : isWhisper
      ? 'bubble-whisper'
      : isMine
        ? 'bubble-sent'
        : 'bubble-received';

  const isSupport = !isMine && (message.senderRole === 'support' || message.senderRole === 'admin');

  return (
    <div
      id={`msg-${message.id}`}
      className={`group flex w-full ${isGroupEnd ? 'mb-3' : 'mb-0.5'} px-4 flex-row rounded-[var(--radius-btn)] ${
        isCurrentSearchMatch ? 'bg-[var(--color-accent-soft)]' : isSearchMatch ? 'bg-[var(--color-bg-elevated)]' : ''
      }`}
      onMouseEnter={() => !isDeleted && !suppressActions && setShowActions(true)}
      onMouseLeave={() => { setShowActions(false); }}
    >
      <div className="flex flex-col justify-end w-7 shrink-0 mr-3">
        {isGroupStart && !isWhisper && (
          <Avatar
            name={message.senderName || 'User'}
            src={message.senderAvatarUrl ?? null}
            size={24}
            isExternal={!!message.senderIsExternal}
          />
        )}
      </div>

      <div className={`relative max-w-[75%] min-w-[60px] px-3 py-2 ${bubbleClasses}`}>

        {!isMine && !isWhisper && isGroupStart && (
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[12px] font-semibold text-[var(--color-ink)]">
              {message.senderName}
            </span>
            <GuestBadge isExternal={isSenderExternal} />
            {isSupport && (
              <span className="text-[10px] font-semibold uppercase tracking-[0.04em] px-1.5 py-0.5 rounded-[var(--radius-pill)] bg-[var(--color-accent-soft)] text-[var(--color-accent)] leading-none">
                {t('support') || 'Support'}
              </span>
            )}
          </div>
        )}

        {isWhisper && isGroupStart && (
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--color-whisper-ink)]">
              <Ghost className="w-[11px] h-[11px]" strokeWidth={2} />
              {t('whisper_label') || 'Whisper'}
            </span>
            <span className="text-[12px] font-medium text-[var(--color-ink-soft)]">
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
                className="w-full resize-none bg-[var(--color-bg-surface)] border border-[var(--color-border-strong)] rounded-[var(--radius-btn)] px-2.5 py-1.5 text-[13px] text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)]"
                rows={2}
                autoFocus
              />
              <div className="flex gap-1.5 justify-end">
                <button
                  onClick={() => setEditing(false)}
                  className="text-[12px] font-medium px-2.5 py-1 rounded-[var(--radius-btn)] text-[var(--color-ink-soft)] hover:bg-[var(--color-hover)]"
                >
                  {t('cancel') || 'Cancel'}
                </button>
                <button
                  onClick={submitEdit}
                  className="text-[12px] font-medium px-2.5 py-1 rounded-[var(--radius-btn)] bg-[var(--color-accent)] text-white hover:opacity-90"
                >
                  {t('save') || 'Save'}
                </button>
              </div>
            </div>
          ) : isDeleted ? (
            <div className="flex items-center gap-1.5 text-[12px] text-[var(--color-ink-muted)] italic">
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
              <span className="text-[11px] text-[var(--color-ink-muted)] italic flex items-center gap-1">
                <Loader2 className="animate-spin" size={10} />
                {t('translating') || 'translating...'}
              </span>
            ) : translated ? (
              <button
                onClick={() => setShowOriginal(!showOriginal)}
                className="text-[11px] text-[var(--color-ink-muted)] hover:text-[var(--color-ink-soft)] underline underline-offset-2"
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
                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-medium rounded-[var(--radius-pill)] ${
                    iReacted
                      ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                      : 'bg-[var(--color-bg-elevated)] text-[var(--color-ink-soft)] hover:bg-[var(--color-hover)]'
                  } ${isDeleted ? 'opacity-40 cursor-default' : 'cursor-pointer'}`}
                >
                  <span>{emoji}</span>
                  <span className="tabular-nums">{count}</span>
                </button>
              );
            })}

          {/* Spacer pushes timestamp to right */}
          <span className="ml-auto" />

          <span className="flex items-center gap-1.5 text-[11px] text-[var(--color-ink-muted)] shrink-0">
            {isEdited && !isDeleted && (
              <span className="italic">{t('edited') || 'edited'}</span>
            )}
            <span className="tabular-nums">{time}</span>
            {isMine && !isDeleted && !message.system && (
              <DeliveryStatus deliveredAt={message.deliveredAt} readAt={message.readAt} />
            )}
          </span>
        </div>

        {/* Floating action bar — absolutely positioned above the bubble on
            hover. `bottom-full` anchors the pill's bottom to the bubble's
            top so it always sits fully above regardless of pill height;
            `mb-1` leaves a small gap. Always anchored `left-0` because
            this chat renders every bubble (mine + received) with the
            avatar on the left — no row-reverse alignment. Pill grows
            rightward into the empty space after the bubble, which is the
            only free area. Anchoring `right-0` on short own-messages
            clipped the pill's left portion off-screen. */}
        {showActions && !editing && (
          <div
            className="absolute bottom-full mb-1 left-0 z-10 flex items-center flex-nowrap whitespace-nowrap w-max bg-[var(--color-bg-surface)] rounded-[var(--radius-pill)] shadow-[var(--shadow-card)] border border-[var(--color-border)] px-1.5 py-1 gap-0.5 animate-[v2p-pop_180ms_ease-out]"
            onMouseEnter={() => setShowActions(true)}
          >
            {REACTION_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                onClick={() => { const s = getSocket(); if (s?.connected) s.emit('message:react', { ticketId, messageId: message.id, emoji }); }}
                disabled={isDeleted}
                title={`React with ${emoji}`}
                aria-label={`React with ${emoji}`}
                className="w-8 h-8 shrink-0 flex items-center justify-center rounded-full text-[16px] leading-none hover:bg-[var(--color-hover)] transition-transform hover:scale-110"
              >
                {emoji}
              </button>
            ))}
            {(onReply || canEdit || canDelete) && (
              <>
                <span className="mx-1 h-5 w-px bg-[var(--color-border)] shrink-0" aria-hidden="true" />
                {onReply && !isDeleted && (
                  <button
                    onClick={() => onReply(message)}
                    title={t('reply') || 'Reply'}
                    aria-label={t('reply') || 'Reply'}
                    className="w-8 h-8 shrink-0 flex items-center justify-center rounded-full text-[var(--color-ink-soft)] hover:text-[var(--color-accent)] hover:bg-[var(--color-hover)]"
                  >
                    <CornerUpLeft size={15} />
                  </button>
                )}
                {canEdit && (
                  <button
                    onClick={startEdit}
                    title={t('edit') || 'Edit'}
                    aria-label={t('edit') || 'Edit'}
                    className="w-8 h-8 shrink-0 flex items-center justify-center rounded-full text-[var(--color-ink-soft)] hover:text-[var(--color-accent)] hover:bg-[var(--color-hover)]"
                  >
                    <Pencil size={14} />
                  </button>
                )}
                {canDelete && (
                  <button
                    onClick={() => { setConfirmDelete(true); setShowActions(false); }}
                    title={t('delete') || 'Delete'}
                    aria-label={t('delete') || 'Delete'}
                    className="w-8 h-8 shrink-0 flex items-center justify-center rounded-full text-[var(--color-ink-soft)] hover:text-[var(--color-urgent)] hover:bg-[var(--color-urgent-soft)]"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>

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
