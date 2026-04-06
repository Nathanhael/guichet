import React from 'react';
import { useStoreShallow } from '../../store/useStore';
import { useT } from '../../i18n';
import MessageBubble from '../MessageBubble';
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
}: MessageListProps) {
  const { user, typingUsers } = useStoreShallow(s => ({
    user: s.user,
    typingUsers: s.typingUsers,
  }));
  const t = useT();

  return (
    <>
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
                  className="text-xs font-mono text-text-secondary hover:text-text-primary transition-colors"
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

            return (
              <MessageBubble
                key={msg.id}
                message={msg}
                ticketId={ticket.id}
                isGroupStart={isGroupStart}
                isGroupEnd={isGroupEnd}
                aiConfig={aiConfig}
              />
            );
          })}

          <div ref={bottomRef} />
        </div>
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
                <span className="w-1 h-1 bg-text-primary rounded-full" style={{ animationDelay: '0ms' }} />
                <span className="w-1 h-1 bg-text-primary rounded-full" style={{ animationDelay: '150ms' }} />
                <span className="w-1 h-1 bg-text-primary rounded-full" style={{ animationDelay: '300ms' }} />
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
