// Public chat-message API. Bundle C slice 3 (#78): inlines the legacy
// MessageBubble body directly. The lazy boundary for AttachmentGrid /
// QuoteBlock / LinkPreviewCard lives one level deeper in MessageContent
// (which Message renders); plain-text messages pay zero parse cost for
// the three fragments.

import { memo, useState, useEffect, useRef, useCallback } from 'react';
import { CornerUpLeft, Pencil, Trash2, Loader2, Ban, Ghost, Sparkles } from 'lucide-react';
import { useStoreShallow } from '../../store/useStore';
import Avatar from '../ui/Avatar';
import ConfirmDialog from '../ConfirmDialog';
import DeliveryStatus from './DeliveryStatus';
import MessageContent from './MessageContent';
import { getSocket } from '../../hooks/useSocket';
import { useT } from '../../i18n';
import { useAutoTranslation } from '../../hooks/useTranslation';
import { safeDate } from '../../utils/dateUtils';
import { REACTION_EMOJIS } from '../../constants';
import type { Message as MessageType } from '../../types';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../../../../server/trpc/router';

type AiConfig = inferRouterOutputs<AppRouter>['partner']['getAiConfig'];

export interface MessageProps {
  message: MessageType;
  ticketId?: string;
  isGroupStart?: boolean;
  isGroupEnd?: boolean;
  onReply?: (message: MessageType) => void;
  suppressActions?: boolean;
  highlightQuery?: string;
  isSearchMatch?: boolean;
  isCurrentSearchMatch?: boolean;
  aiConfig?: AiConfig;
}

function MessageInner({
  message,
  ticketId,
  isGroupStart = true,
  isGroupEnd = true,
  aiConfig,
  onReply,
  highlightQuery,
  isSearchMatch,
  isCurrentSearchMatch,
  suppressActions,
}: MessageProps) {
  const { user, bionicReading } = useStoreShallow(s => ({
    user: s.user,
    bionicReading: s.bionicReading,
  }));
  const t = useT();

  // ticketId fallback: callers that haven't yet threaded it through can
  // omit; we source from message.ticketId.
  const resolvedTicketId = ticketId ?? message.ticketId;

  const translationEnabled = aiConfig?.translation === true;

  // Auto-translate if senderLang !== viewerLang (lazy — queued via concurrency limiter).
  const { translated, loading: translating, translate, showOriginal, setShowOriginal, needsTranslation } = useAutoTranslation({
    messageId: message.id,
    text: message.text || message.originalText || '',
    senderLang: message.senderLang || '',
    viewerLang: user?.lang || 'en',
    enabled: translationEnabled && !message.system,
    prewarmed: message.translations?.[user?.lang || 'en'],
  });

  // Trigger translation on first render — concurrency limiter in the hook prevents N simultaneous API calls.
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

  // Hover intent: keep the floating action bar visible through the 4px
  // gap between bubble-top and pill-bottom (the `mb-1` spacer). Without
  // a grace window, mouseleave fires the moment the cursor crosses the
  // gap and the bar vanishes mid-reach. 220ms is long enough to bridge
  // the gap at normal pointer speed but short enough not to feel sticky.
  const hideTimeoutRef = useRef<number | null>(null);
  const clearHideTimer = () => {
    if (hideTimeoutRef.current != null) {
      window.clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  };
  const scheduleHide = useCallback(() => {
    clearHideTimer();
    hideTimeoutRef.current = window.setTimeout(() => {
      setShowActions(false);
      hideTimeoutRef.current = null;
    }, 220);
  }, []);
  const cancelHideAndShow = useCallback(() => {
    clearHideTimer();
    if (!isDeleted && !suppressActions) setShowActions(true);
  }, [isDeleted, suppressActions]);
  useEffect(() => () => clearHideTimer(), []);

  if (message.system) {
    // Resolve i18n: prefixed keys to localized text at render time.
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

  const originalDisplayText = isDeleted ? (t('message_deleted')) : (message.text || '');
  // Translated text is always primary when available — UX decision 2026-05-03:
  // monolingual support staff couldn't read the original after the legacy
  // toggle, so "Show original" now reveals the source text underneath the
  // bubble instead of swapping the bubble's contents.
  const displayText = (!isDeleted && translated) ? translated : originalDisplayText;
  const showOriginalReveal = !isDeleted && !!translated && showOriginal;

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
    socket.emit('message:edit', { ticketId: resolvedTicketId, messageId: message.id, text: editText.trim() });
    setEditing(false);
  }

  function deleteMessage() {
    const socket = getSocket();
    if (!socket?.connected) return;
    socket.emit('message:delete', { ticketId: resolvedTicketId, messageId: message.id });
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
      onMouseEnter={cancelHideAndShow}
      onMouseLeave={scheduleHide}
    >
      <div className="flex flex-col justify-end w-7 shrink-0 mr-3">
        {isGroupStart && !isWhisper && (
          <Avatar
            name={message.senderName || 'User'}
            src={message.senderAvatarUrl ?? null}
            size={24}
          />
        )}
      </div>

      <div className={`relative max-w-[75%] min-w-[60px] px-3 py-2 ${bubbleClasses}`}>

        {!isMine && !isWhisper && isGroupStart && (
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[12px] font-semibold text-[var(--color-ink)]">
              {message.senderName}
            </span>
            {isSupport && (
              <span className="text-[10px] font-semibold uppercase tracking-[0.04em] px-1.5 py-0.5 rounded-[var(--radius-pill)] bg-[var(--color-accent-soft)] text-[var(--color-accent)] leading-none">
                {t('support')}
              </span>
            )}
          </div>
        )}

        {isWhisper && isGroupStart && (
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--color-whisper-ink)]">
              <Ghost className="w-[11px] h-[11px]" strokeWidth={2} />
              {t('whisper_label')}
            </span>
            <span className="text-[12px] font-medium text-[var(--color-ink-soft)]">
              {message.senderName}
            </span>
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
                  className="text-[12px] font-medium px-2.5 py-1 rounded-[var(--radius-btn)] text-[var(--color-ink-soft)] hover:bg-[var(--color-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
                >
                  {t('cancel')}
                </button>
                <button
                  onClick={submitEdit}
                  className="text-[12px] font-medium px-2.5 py-1 rounded-[var(--radius-btn)] bg-[var(--color-accent)] text-[var(--color-btn-text-inverse)] hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
                >
                  {t('save')}
                </button>
              </div>
            </div>
          ) : isDeleted ? (
            <div className="flex items-center gap-1.5 text-[12px] text-[var(--color-ink-muted)] italic">
              <Ban size={14} strokeWidth={1.5} className="shrink-0" />
              {t('message_deleted')}
            </div>
          ) : (
            <MessageContent
              message={message}
              displayText={displayText}
              isDeleted={isDeleted}
              bionicReading={bionicReading}
              highlightQuery={highlightQuery}
              viewerLang={user?.lang || 'en'}
              translationEnabled={translationEnabled}
            />
          )}
        </div>

        {/* Original text reveal: when the viewer asks to see the source,
            we expand it under the translated bubble instead of swapping —
            monolingual viewers always keep the readable translation in
            front of them. */}
        {showOriginalReveal && (
          <div className="mt-1.5 px-3 py-1.5 rounded-[var(--radius-bubble)] bg-[var(--color-bg-elevated)] border border-[var(--color-border)] text-[12px] text-[var(--color-ink-soft)] italic whitespace-pre-wrap break-words">
            <span className="not-italic font-mono text-[10px] uppercase tracking-wide text-[var(--color-ink-muted)] mr-1.5">
              {message.senderLang}
            </span>
            {originalDisplayText}
          </div>
        )}

        {/* Translation indicator */}
        {needsTranslation && !isDeleted && (
          <div className="flex items-center gap-2 mt-1.5 -mb-0.5">
            {translating ? (
              <span className="text-[11px] text-[var(--color-ink-muted)] italic flex items-center gap-1">
                <Loader2 className="animate-spin" size={10} />
                {t('translating')}
              </span>
            ) : translated ? (
              <button
                onClick={() => setShowOriginal(!showOriginal)}
                className="text-[11px] text-[var(--color-ink-muted)] hover:text-[var(--color-ink-soft)] underline underline-offset-2"
              >
                {showOriginal
                  ? (t('hide_original'))
                  : (t('show_original'))}
              </button>
            ) : null}
          </div>
        )}

        {/* Metadata row: timestamp + status + reactions inline. Timestamp
            only renders on the last bubble in a cluster (isGroupEnd) to
            avoid repeating the same minute across every message — Slack /
            iMessage pattern. Reactions + "edited" tag still render on any
            bubble that has them. */}
        {(() => {
          const hasReactions = Object.values(message.reactions || {}).some((ids) => ids.length > 0);
          const showMeta = isGroupEnd || hasReactions || (isEdited && !isDeleted);
          // Slice 6: ✨ AI badge — visible when the message was AI-improved
          // (server stamps `improvedAt`, slice 7) and/or when the viewer is
          // currently looking at a machine translation rather than the
          // original. Both signals collapse into one badge with a combined
          // tooltip so the metadata row stays compact.
          const isImproved = !!message.improvedAt && !isDeleted;
          const isShowingTranslation = !!translated && !showOriginal && !isDeleted;
          let badgeTitle: string | null = null;
          if (isImproved && isShowingTranslation) {
            badgeTitle = `${t('ai_badge_translated')} · ${t('ai_badge_improved')}`;
          } else if (isImproved) {
            badgeTitle = t('ai_badge_improved');
          } else if (isShowingTranslation) {
            badgeTitle = t('ai_badge_translated');
          }
          if (!showMeta) return null;
          return (
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {Object.entries(message.reactions || {}).map(([emoji, userIds]) => {
                const count = userIds.length;
                if (count === 0) return null;
                const iReacted = userIds.includes(user?.id || '');
                return (
                  <button
                    key={emoji}
                    onClick={() => { const s = getSocket(); if (s?.connected) s.emit('message:react', { ticketId: resolvedTicketId, messageId: message.id, emoji }); }}
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

              <span className="ml-auto" />

              <span className="flex items-center gap-1.5 text-[11px] text-[var(--color-ink-muted)] shrink-0">
                {isEdited && !isDeleted && (
                  <span className="italic">{t('edited')}</span>
                )}
                {badgeTitle && (
                  <span
                    data-testid="ai-badge"
                    title={badgeTitle}
                    aria-label={badgeTitle}
                    className="inline-flex items-center text-[var(--color-accent)]"
                  >
                    <Sparkles size={12} strokeWidth={2} aria-hidden="true" />
                  </span>
                )}
                {isGroupEnd && <span className="tabular-nums">{time}</span>}
                {isGroupEnd && isMine && !isDeleted && !message.system && (
                  <DeliveryStatus deliveredAt={message.deliveredAt} readAt={message.readAt} />
                )}
              </span>
            </div>
          );
        })()}

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
            onMouseEnter={cancelHideAndShow}
            onMouseLeave={scheduleHide}
          >
            {/* Reactions on own messages are noise in a B2B support tool
                — self-liking rarely helps an agent or supporter. Peers
                can still react to your bubble; those pills render inline
                in the metadata row regardless of ownership. */}
            {!isMine && REACTION_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                onClick={() => { const s = getSocket(); if (s?.connected) s.emit('message:react', { ticketId: resolvedTicketId, messageId: message.id, emoji }); }}
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
                {!isMine && <span className="mx-1 h-5 w-px bg-[var(--color-border)] shrink-0" aria-hidden="true" />}
                {onReply && !isDeleted && (
                  <button
                    onClick={() => onReply(message)}
                    title={t('reply')}
                    aria-label={t('reply')}
                    className="w-8 h-8 shrink-0 flex items-center justify-center rounded-full text-[var(--color-ink-soft)] hover:text-[var(--color-accent)] hover:bg-[var(--color-hover)]"
                  >
                    <CornerUpLeft size={15} />
                  </button>
                )}
                {canEdit && (
                  <button
                    onClick={startEdit}
                    title={t('edit')}
                    aria-label={t('edit')}
                    className="w-8 h-8 shrink-0 flex items-center justify-center rounded-full text-[var(--color-ink-soft)] hover:text-[var(--color-accent)] hover:bg-[var(--color-hover)]"
                  >
                    <Pencil size={14} />
                  </button>
                )}
                {canDelete && (
                  <button
                    onClick={() => { setConfirmDelete(true); setShowActions(false); }}
                    title={t('delete')}
                    aria-label={t('delete')}
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
          title={t('delete')}
          message={t('confirm_delete_message')}
          confirmLabel={t('delete')}
          onConfirm={deleteMessage}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}

// React.memo with default shallow equality. Skips re-renders when parent
// re-renders with the same prop refs — e.g. typing indicator ticks on
// MessageList don't re-render every bubble in a long thread. The `message`
// ref is stable per-id from the upstream ticketMessages array; other props
// are primitives or stable callbacks from MessageList. If a future caller
// passes a callback that changes identity each render, wrap it in
// `useCallback` upstream or this memo is silently inert.
export default memo(MessageInner);
