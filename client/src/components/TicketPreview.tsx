import { useRef, useEffect } from 'react';
import { X } from 'lucide-react';
import { useT } from '../i18n';
import MessageBubble from './MessageBubble';
import { trpc } from '../utils/trpc';
import { Ticket, Message } from '../types';
import Button from './ui/Button';
import Pill from './ui/Pill';
import { getSocket } from '../hooks/useSocket';

interface TicketPreviewProps {
  ticket: Ticket;
  messages?: Message[];
  onJoin?: () => void;
  onClose: () => void;
  joinDisabled?: boolean;
  readOnly?: boolean;
  onViewAudit?: () => void;
}

export default function TicketPreview({ ticket, messages: propMessages, onJoin, onClose, joinDisabled, readOnly, onViewAudit }: TicketPreviewProps) {
  const t = useT();
  const scrollRef = useRef<HTMLDivElement>(null);

  const trpcUtils = trpc.useUtils();
  const messageQuery = trpc.message.list.useQuery(
    { ticketId: ticket.id },
    { enabled: !!ticket.id && (!propMessages || propMessages.length === 0) }
  );

  const messages = (propMessages && propMessages.length > 0) ? propMessages : ((messageQuery.data?.messages as unknown as Message[]) || []);

  useEffect(() => {
    if (messages.length > 0 && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  // Live subscription: server fans out `ticket:preview:invalidate` to a
  // read-only preview room when messages change in this ticket. We refetch
  // through tRPC so visibility rules (whisper filtering, etc.) stay
  // server-enforced — the socket payload carries no message body.
  const isStatic = !!(propMessages && propMessages.length > 0);
  useEffect(() => {
    if (!ticket.id || isStatic) return;
    const socket = getSocket();
    if (!socket) return;

    socket.emit('ticket:preview:join', { ticketId: ticket.id });

    const onInvalidate = (payload: { ticketId: string }) => {
      if (payload.ticketId === ticket.id) {
        trpcUtils.message.list.invalidate({ ticketId: ticket.id });
      }
    };
    socket.on('ticket:preview:invalidate', onInvalidate);

    return () => {
      socket.off('ticket:preview:invalidate', onInvalidate);
      socket.emit('ticket:preview:leave', { ticketId: ticket.id });
    };
  }, [ticket.id, isStatic, trpcUtils]);

  const modeLabel = readOnly ? (t('history_mode') || 'Archived') : (t('preview_mode') || 'Preview');

  return (
    <div className="h-full flex flex-col p-4">
      <div className="bg-[var(--color-bg-surface)] rounded-[var(--radius-card)] border border-[var(--color-border)] shadow-[var(--shadow-card)] flex flex-col h-full overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <Pill tone="muted">{ticket.dept}</Pill>
            <span className="text-[14px] font-semibold text-[var(--color-ink)] truncate">{ticket.agentName}</span>
            <Pill tone="accent">{modeLabel}</Pill>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {onViewAudit && (
              <Button
                variant="secondary"
                size="sm"
                onClick={onViewAudit}
                title="View audit history for this ticket"
              >
                Audit
              </Button>
            )}
            <button
              onClick={onClose}
              aria-label={t('close') || 'Close'}
              className="w-8 h-8 inline-flex items-center justify-center rounded-[var(--radius-btn)] text-[var(--color-ink-soft)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)] transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-1 bg-[var(--color-bg-base)]">
          {messageQuery.isLoading ? (
            <div className="h-full flex flex-col items-center justify-center gap-3">
              <div className="h-6 w-6 rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-accent)] animate-spin" />
              <p className="text-[12px] text-[var(--color-ink-muted)]">{t('loading') || 'Loading'}</p>
            </div>
          ) : !messages || messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center">
              <p className="text-[13px] text-[var(--color-ink-muted)]">{t('no_messages')}</p>
            </div>
          ) : (
            messages.map((msg, idx) => {
              const prevMsg = messages[idx - 1];
              const nextMsg = messages[idx + 1];
              const isSameSenderAsPrev = prevMsg && prevMsg.senderId === msg.senderId && !prevMsg.system && !msg.system;
              const isSameSenderAsNext = nextMsg && nextMsg.senderId === msg.senderId && !nextMsg.system && !msg.system;
              const msgTime = msg.timestamp || msg.createdAt || '';
              const prevTime = prevMsg?.timestamp || prevMsg?.createdAt || '';
              const nextTime = nextMsg?.timestamp || nextMsg?.createdAt || '';
              const timeDiffPrev = prevMsg ? (new Date(msgTime).getTime() - new Date(prevTime).getTime()) : 0;
              const timeDiffNext = nextMsg ? (new Date(nextTime).getTime() - new Date(msgTime).getTime()) : 0;
              return (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  ticketId={ticket.id}
                  isGroupStart={!isSameSenderAsPrev || timeDiffPrev > 120000}
                  isGroupEnd={!isSameSenderAsNext || timeDiffNext > 120000}
                  suppressActions
                />
              );
            })
          )}
        </div>

        {!readOnly && (
          <div className="px-6 py-4 border-t border-[var(--color-border)] bg-[var(--color-bg-surface)] flex items-center justify-between gap-4">
            {ticket.status === 'closed' ? (
              <p className="text-[13px] text-[var(--color-ink-muted)]">{t('conversation_closed')}</p>
            ) : (
              <>
                <p className="text-[12px] text-[var(--color-ink-muted)]">{t('waiting_for_expert')}</p>
                <Button variant="primary" size="md" onClick={onJoin} disabled={joinDisabled}>
                  {t('join')}
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
