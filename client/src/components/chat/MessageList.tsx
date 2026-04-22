import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useStoreShallow } from '../../store/useStore';
import { useT } from '../../i18n';
import { ArrowDown } from 'lucide-react';
import MessageBubble from '../MessageBubble';
import SearchBar from './SearchBar';
import { Ticket, Message } from '../../types';
import { formatDate } from '../../utils/dateUtils';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../../../../server/trpc/router';

type AiConfig = inferRouterOutputs<AppRouter>['partner']['getAiConfig'];

interface CursorInfo {
  hasMore: boolean;
  nextCursor?: string;
  loading: boolean;
}

interface MessageListProps {
  ticket: Ticket;
  messages: Message[];
  cursorInfo?: CursorInfo;
  onLoadOlder: () => void;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  bottomRef: React.RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  aiConfig?: AiConfig;
  unreadCount: number;
  firstUnreadIndex: number | null;
  showScrollButton: boolean;
  onScrollToBottom: () => void;
  onReply?: (message: Message) => void;
  searchOpen?: boolean;
  searchQuery?: string;
  onSearchQueryChange?: (q: string) => void;
  onSearchClose?: () => void;
  suppressActions?: boolean;
}

const langToLocale: Record<string, string> = { nl: 'nl-BE', fr: 'fr-BE', en: 'en-GB' };

function getDateLabel(dateStr: string, t: (key: string) => string, userLang?: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msgDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.floor((today.getTime() - msgDate.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return t('today') || 'Today';
  if (diffDays === 1) return t('yesterday') || 'Yesterday';
  const locale = langToLocale[userLang || 'en'] || 'en-GB';
  return date.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

export default function MessageList({
  ticket,
  messages: ticketMessages,
  cursorInfo,
  onLoadOlder,
  scrollContainerRef,
  bottomRef,
  onScroll,
  aiConfig,
  unreadCount,
  firstUnreadIndex,
  showScrollButton,
  onScrollToBottom,
  onReply,
  searchOpen,
  searchQuery,
  onSearchQueryChange,
  onSearchClose,
  suppressActions,
}: MessageListProps) {
  const { user, typingUsers } = useStoreShallow(s => ({
    user: s.user,
    typingUsers: s.typingUsers,
  }));
  const t = useT();

  // ── Search: compute matched message IDs ──────────────────────────
  const matchedMessageIds = useMemo(() => {
    if (!searchQuery?.trim()) return [] as string[];
    const q = searchQuery.toLowerCase();
    return ticketMessages
      .filter(m => !m.system && !m.deletedAt && m.text && m.text.toLowerCase().includes(q))
      .map(m => m.id);
  }, [ticketMessages, searchQuery]);

  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);

  // Reset match index when query or matches change; index is independently
  // advanced by next/prev navigation.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCurrentMatchIndex(0);
  }, [searchQuery, matchedMessageIds.length]);

  const navigateMatch = useCallback((direction: 'next' | 'prev') => {
    if (matchedMessageIds.length === 0) return;
    const newIndex = direction === 'next'
      ? (currentMatchIndex + 1) % matchedMessageIds.length
      : (currentMatchIndex - 1 + matchedMessageIds.length) % matchedMessageIds.length;
    setCurrentMatchIndex(newIndex);
    const targetId = matchedMessageIds[newIndex];
    const el = document.getElementById(`msg-${targetId}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [matchedMessageIds, currentMatchIndex]);

  const matchedSet = useMemo(() => new Set(matchedMessageIds), [matchedMessageIds]);
  const currentMatchId = matchedMessageIds[currentMatchIndex] ?? null;

  return (
    <>
      <div className="relative flex-1 min-h-0 flex flex-col">
        {searchOpen && onSearchQueryChange && onSearchClose && (
          <SearchBar
            query={searchQuery || ''}
            onQueryChange={onSearchQueryChange}
            matchCount={matchedMessageIds.length}
            currentMatchIndex={currentMatchIndex}
            onNext={() => navigateMatch('next')}
            onPrev={() => navigateMatch('prev')}
            onClose={onSearchClose}
          />
        )}
        <div
          ref={scrollContainerRef}
          onScroll={onScroll}
          className="flex-1 overflow-y-auto p-6 scrollbar-thin relative bg-[var(--color-bg-surface)]"
        >
          <div className="space-y-1 mb-8">
            {cursorInfo?.hasMore && (
              <div className="flex justify-center py-2">
                {cursorInfo.loading ? (
                  <span className="text-xs text-[var(--color-ink-muted)]">{t('loading')}</span>
                ) : (
                  <button
                    onClick={onLoadOlder}
                    className="text-xs text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] underline underline-offset-2"
                  >
                    {t('load_older')}
                  </button>
                )}
              </div>
            )}
            {ticketMessages.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20">
                <svg className="w-12 h-12 text-[var(--color-ink-muted)] mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.855-1.246L3 20l1.226-3.746A9.233 9.233 0 013 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                <p className="text-sm text-[var(--color-ink-muted)]">{t('no_messages')}</p>
              </div>
            )}
            {ticketMessages.map((msg, idx) => {
              const prevMsg = ticketMessages[idx - 1];
              const nextMsg = ticketMessages[idx + 1];

              const isSameSenderAsPrev = prevMsg && prevMsg.senderId === msg.senderId && !prevMsg.system && !msg.system;
              const isSameSenderAsNext = nextMsg && nextMsg.senderId === msg.senderId && !nextMsg.system && !msg.system;

              // Grouping logic: same sender and within 2 minutes
              const timeDiffPrev = prevMsg ? (new Date(msg.timestamp).getTime() - new Date(prevMsg.timestamp).getTime()) : 0;
              const timeDiffNext = nextMsg ? (new Date(nextMsg.timestamp).getTime() - new Date(msg.timestamp).getTime()) : 0;

              const isGroupStart = !isSameSenderAsPrev || timeDiffPrev > 120000;
              const isGroupEnd = !isSameSenderAsNext || timeDiffNext > 120000;

              // Whisper run start: a whisper that immediately follows a
              // non-whisper (or is the first message). Rendered as a dashed
              // purple rule to open an aside from the main agent↔support
              // conversation. The matching END marker was dropped — the rule
              // felt redundant once the next non-whisper bubble naturally
              // closes the aside by virtue of changing alignment/colour.
              const isWhisperRunStart = !!msg.whisper && (!prevMsg || !prevMsg.whisper);

              // Date separator: show when day changes between messages
              const msgDate = new Date(msg.timestamp).toDateString();
              const prevDate = prevMsg ? new Date(prevMsg.timestamp).toDateString() : null;
              const showDateSeparator = idx === 0 || msgDate !== prevDate;

              // Time gap separator: render a small time pill when the gap
              // from the previous message exceeds 15 minutes within the same
              // day. Suppressed on date boundaries (date pill already shown)
              // and at whisper-run starts (whisper marker already breaks the
              // visual flow). Gives the reader a cheap chronological anchor
              // during long same-day conversations without spamming pills.
              const showTimeGap = !!prevMsg && !showDateSeparator && !isWhisperRunStart && timeDiffPrev > 15 * 60 * 1000;

              const showDivider = firstUnreadIndex !== null && idx === firstUnreadIndex;

              return (
                <React.Fragment key={msg.id}>
                  {showDateSeparator && (
                    <div className="flex justify-center my-4">
                      <span className="text-[11px] font-medium text-[var(--color-ink-muted)] bg-[var(--color-bg-elevated)] px-3 py-1 rounded-[var(--radius-pill)] shrink-0">
                        {getDateLabel(msg.timestamp, t, user?.lang)}
                      </span>
                    </div>
                  )}
                  {showTimeGap && (
                    <div className="flex justify-center my-3">
                      <span className="text-[10px] font-medium text-[var(--color-ink-muted)] opacity-70 shrink-0">
                        {formatDate(msg.timestamp)}
                      </span>
                    </div>
                  )}
                  {showDivider && (
                    <div className="flex items-center gap-3 my-3 px-4">
                      <div className="flex-1 h-px bg-[var(--color-accent)] opacity-30" />
                      <span className="text-[11px] font-semibold text-[var(--color-accent)] bg-[var(--color-accent-soft)] px-3 py-1 rounded-[var(--radius-pill)] shrink-0">
                        {t('new_messages')}
                      </span>
                      <div className="flex-1 h-px bg-[var(--color-accent)] opacity-30" />
                    </div>
                  )}
                  {isWhisperRunStart && (
                    <div className="flex items-center gap-3 mt-2 mb-1 px-14">
                      <div className="flex-1 border-t border-dashed border-[var(--color-whisper-ink)] opacity-40" />
                      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-whisper-ink)] shrink-0">
                        {t('whisper_run_start')}
                      </span>
                      <div className="flex-1 border-t border-dashed border-[var(--color-whisper-ink)] opacity-40" />
                    </div>
                  )}
                  <MessageBubble
                    message={msg}
                    ticketId={ticket.id}
                    isGroupStart={isGroupStart}
                    isGroupEnd={isGroupEnd}
                    aiConfig={aiConfig}
                    onReply={onReply}
                    highlightQuery={searchOpen && searchQuery ? searchQuery : undefined}
                    isSearchMatch={matchedSet.has(msg.id)}
                    isCurrentSearchMatch={msg.id === currentMatchId}
                    suppressActions={suppressActions}
                  />
                </React.Fragment>
              );
            })}

            <div ref={bottomRef} />
          </div>
        </div>

        {/* Jump-to-bottom FAB */}
        {showScrollButton && (
          <button
            onClick={onScrollToBottom}
            className="absolute bottom-20 right-4 z-40 flex items-center gap-1.5 bg-[var(--color-bg-surface)] px-3 py-2 rounded-[var(--radius-pill)] shadow-[var(--shadow-card)] hover:bg-[var(--color-hover)] transition-colors"
            aria-label={t('scroll_to_bottom')}
          >
            <ArrowDown size={14} className="text-[var(--color-ink)]" />
            {unreadCount > 0 && (
              <span className="bg-[var(--color-accent)] text-white text-[10px] font-semibold tabular-nums px-1.5 py-0.5 min-w-[18px] text-center rounded-[var(--radius-pill)]">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>
        )}
      </div>

      {/* Typing indicator */}
      {(() => {
        const ticketTyping = typingUsers[ticket.id] || {};
        const typers = Object.keys(ticketTyping).filter(name => ticketTyping[name] && name !== user?.name);
        if (typers.length === 0) return null;
        return (
          <div className="px-6 py-2 text-[12px] text-[var(--color-ink-muted)] bg-[var(--color-bg-surface)] border-t border-[var(--color-border)]">
            <span className="inline-flex items-center gap-2">
              <span className="inline-flex gap-1" aria-hidden="true">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-ink-muted)] animate-[v2p-dot_1s_ease-in-out_infinite]" />
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-ink-muted)] animate-[v2p-dot_1s_ease-in-out_infinite] [animation-delay:120ms]" />
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-ink-muted)] animate-[v2p-dot_1s_ease-in-out_infinite] [animation-delay:240ms]" />
              </span>
              {typers.length === 1
                ? `${typers[0]} ${t('is_typing')}`
                : `${typers.join(', ')} ${t('are_typing')}`
              }
            </span>
          </div>
        );
      })()}
    </>
  );
}
