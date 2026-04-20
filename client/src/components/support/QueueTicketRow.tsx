import { useMemo, useState, useEffect } from 'react';
import type { Ticket } from '../../types';
import { formatChatDuration, formatQueueWait } from '../../utils/dateUtils';
import useStore from '../../store/useStore';
import AgentBadges from './AgentBadges';
import LangBadge from './LangBadge';
import { useLang } from '../../i18n';

function prefetchComposeArea(): void {
  void import('../chat/ComposeArea').catch(() => {});
}

interface QueueTicketRowProps {
  ticket: Ticket;
  isActive: boolean;
  unreadCount: number;
  currentUserId: string;
  variant: 'mine' | 'other' | 'queue';
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}

export default function QueueTicketRow({
  ticket,
  isActive,
  unreadCount,
  currentUserId,
  variant,
  onClick,
  disabled = false,
  className,
}: QueueTicketRowProps) {
  const isUnread = unreadCount > 0;
  const onlineSupportUsers = useStore((s) => s.onlineSupportUsers);
  const onlineAgentIds = useStore((s) => s.onlineAgentIds);
  const agentOnline = onlineAgentIds.includes(ticket.agentId);
  const viewerLang = useLang();

  const [, setTick] = useState(0);
  useEffect(() => {
    if (variant === 'other') return;
    const timer = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(timer);
  }, [variant]);

  const liveParticipants = useMemo(() => {
    const onlineIds = new Set(onlineSupportUsers.map((u) => u.userId));
    return ticket.participants.filter(
      (p) => p.id === currentUserId || onlineIds.has(p.id),
    );
  }, [ticket.participants, onlineSupportUsers, currentUserId]);

  const rowClasses = [
    'px-3 py-2.5 border-b border-[var(--color-border)] cursor-pointer transition-colors',
    'hover:bg-[var(--color-hover)]',
    isActive && 'border-l-[3px] border-l-[var(--color-accent)] bg-[var(--color-accent-soft)]',
    !isActive && isUnread && 'bg-[var(--color-accent-soft)]',
    disabled && 'opacity-40 cursor-not-allowed',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const timerContent = variant === 'queue'
    ? (() => {
        const { text, severity } = formatQueueWait(ticket.createdAt);
        const colorClass = severity === 'red' ? 'text-[var(--color-urgent)]'
          : severity === 'amber' ? 'text-[var(--color-accent-amber)]'
          : 'text-[var(--color-ink-muted)]';
        return (
          <span className={`text-[11px] font-semibold tabular-nums ml-auto ${colorClass}`}>
            {text}
          </span>
        );
      })()
    : (
      <span className="text-[11px] font-semibold tabular-nums text-[var(--color-ink-muted)] ml-auto">
        {formatChatDuration(ticket.supportJoinedAt)}
      </span>
    );

  return (
    <li
      data-ticket-row
      data-ticket-variant={variant}
      className={rowClasses}
      onClick={disabled ? undefined : onClick}
      onMouseEnter={disabled ? undefined : prefetchComposeArea}
      onFocus={disabled ? undefined : prefetchComposeArea}
    >
      {/* Row 1: dept + customer presence + name + unread */}
      <div className="flex items-center gap-1.5 mb-1">
        <span className="inline-flex items-center rounded-[var(--radius-pill)] text-[10px] font-semibold px-1.5 py-0.5 border border-[var(--color-accent)] text-[var(--color-accent)] shrink-0 leading-none">
          {ticket.dept}
        </span>
        <LangBadge lang={ticket.agentLang} viewerLang={viewerLang} />
        {agentOnline && (
          <span
            data-agent-online
            title="Customer is online"
            className="w-1.5 h-1.5 rounded-full shrink-0 bg-[var(--color-ok)]"
          />
        )}
        <span className="text-[13px] font-semibold text-[var(--color-ink)] truncate flex-1 min-w-0">
          {ticket.agentName}
        </span>
        {isUnread && (
          <span className="inline-flex items-center justify-center rounded-[var(--radius-pill)] text-[10px] font-semibold bg-[var(--color-accent)] text-white min-w-[18px] h-[18px] px-1.5 shrink-0 leading-none">
            {unreadCount}
          </span>
        )}
      </div>

      {/* Row 2: agent badges + timer */}
      <div className="flex items-center gap-1.5">
        {variant !== 'queue' && (
          <AgentBadges
            participants={liveParticipants}
            currentUserId={currentUserId}
          />
        )}
        {timerContent}
      </div>
    </li>
  );
}
