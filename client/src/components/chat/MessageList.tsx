import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useStoreShallow } from '../../store/useStore';
import { useT } from '../../i18n';
import { ArrowDown } from 'lucide-react';
import MessageBubble from '../MessageBubble';
import SearchBar from './SearchBar';
import { Ticket, Message } from '../../types';
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

  // Reset match index when query or matches change
  useEffect(() => {
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
          className={`flex-1 overflow-y-auto p-6 scrollbar-thin relative bg-bg-surface`}
        >
          <div className="space-y-1 mb-8">
            {cursorInfo?.hasMore && (
              <div className="flex justify-center py-2">
                {cursorInfo.loading ? (
                  <span className="text-xs font-mono text-text-secondary">Loading...</span>
                ) : (
                  <button
                    onClick={onLoadOlder}
                    className="text-xs font-mono text-text-secondary hover:text-text-primary"
                  >
                    Load older messages
                  </button>
                )}
              </div>
            )}
            {ticketMessages.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 opacity-40">
                <svg className="w-12 h-12 text-text-primary opacity-40 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.855-1.246L3 20l1.226-3.746A9.233 9.233 0 013 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                <p className="text-sm font-medium tracking-wide italic">{t('no_messages')}</p>
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

              // Whisper run boundaries: a whisper that immediately follows a
              // non-whisper (or is the first message) starts a run. A whisper
              // whose next message isn't a whisper (or is the last message)
              // ends the run. Rendered as dashed purple rules to bracket the
              // run as an aside from the main agent↔support conversation.
              const isWhisperRunStart = !!msg.whisper && (!prevMsg || !prevMsg.whisper);
              const isWhisperRunEnd = !!msg.whisper && (!nextMsg || !nextMsg.whisper);

              // Date separator: show when day changes between messages
              const msgDate = new Date(msg.timestamp).toDateString();
              const prevDate = prevMsg ? new Date(prevMsg.timestamp).toDateString() : null;
              const showDateSeparator = idx === 0 || msgDate !== prevDate;

              const showDivider = firstUnreadIndex !== null && idx === firstUnreadIndex;

              return (
                <React.Fragment key={msg.id}>
                  {showDateSeparator && (
                    <div className="flex items-center gap-3 my-4 px-4">
                      <div className="flex-1 border-t border-border" />
                      <span className="font-mono text-[8px] uppercase tracking-widest text-text-secondary bg-bg-surface px-2 shrink-0">
                        {getDateLabel(msg.timestamp, t, user?.lang)}
                      </span>
                      <div className="flex-1 border-t border-border" />
                    </div>
                  )}
                  {showDivider && (
                    <div className="flex items-center gap-3 my-3 px-4">
                      <div className="flex-1 border-t border-accent-blue" />
                      <span className="font-mono text-[8px] uppercase tracking-widest text-accent-blue bg-bg-surface px-2 shrink-0">
                        {t('new_messages') || 'NEW MESSAGES'}
                      </span>
                      <div className="flex-1 border-t border-accent-blue" />
                    </div>
                  )}
                  {isWhisperRunStart && (
                    <div className="flex items-center gap-3 mt-2 mb-1 px-14 opacity-55">
                      <div className="flex-1 border-t border-dashed border-accent-purple/60" />
                      <span className="font-mono text-[8px] font-bold uppercase tracking-[0.18em] text-accent-purple shrink-0">
                        {t('whisper_run_start') || 'Whisper'}
                      </span>
                      <div className="flex-1 border-t border-dashed border-accent-purple/60" />
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
                  />
                  {isWhisperRunEnd && (
                    <div className="flex items-center gap-3 mt-1 mb-2 px-14 opacity-55">
                      <div className="flex-1 border-t border-dashed border-accent-purple/60" />
                      <span className="font-mono text-[8px] font-bold uppercase tracking-[0.18em] text-accent-purple shrink-0">
                        {t('whisper_run_end') || 'End whisper'}
                      </span>
                      <div className="flex-1 border-t border-dashed border-accent-purple/60" />
                    </div>
                  )}
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
            className="absolute bottom-20 right-4 z-40 flex items-center gap-1.5 bg-bg-elevated border border-border-heavy px-3 py-2 hover:bg-bg-surface transition-opacity duration-150"
            aria-label={t('scroll_to_bottom') || 'Scroll to bottom'}
          >
            <ArrowDown size={14} className="text-text-primary" />
            {unreadCount > 0 && (
              <span className="bg-accent-blue text-btn-text-inverse font-mono text-[9px] px-1.5 py-0.5 min-w-[18px] text-center">
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
          <div className="px-6 py-1.5 text-[11px] font-bold text-text-primary opacity-40 bg-bg-surface border-t border-border">
            <span className="inline-flex items-center gap-1.5">
              <span className="flex gap-0.5">
                <span className="w-1 h-1 bg-text-primary" />
                <span className="w-1 h-1 bg-text-primary" />
                <span className="w-1 h-1 bg-text-primary" />
              </span>
              {typers.length === 1
                ? `${typers[0]} ${t('is_typing') || 'is typing...'}`
                : `${typers.join(', ')} ${t('are_typing') || 'are typing...'}`
              }
            </span>
          </div>
        );
      })()}
    </>
  );
}
