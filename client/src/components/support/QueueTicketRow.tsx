import { useMemo, useState, useEffect } from 'react';
import type { Ticket } from '../../types';
import { formatChatDuration, formatQueueWait } from '../../utils/dateUtils';
import useStore from '../../store/useStore';
import AgentBadges from './AgentBadges';

/**
 * Warm the lazy-loaded ComposeArea chunk before the user clicks. The dynamic
 * import is module-cached after the first call, so repeated hovers are no-ops
 * and a network failure is silently ignored (the real load will retry on
 * click). Cuts ~50–100 ms off the perceived chat-open latency on first use.
 */
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

  // Tick timers every 30s so durations update while the sidebar is visible.
  // Skip for "other agents" rows — those timestamps are low-value and the
  // intervals add up on busy queues.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (variant === 'other') return;
    const timer = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(timer);
  }, [variant]);

  // Soft-filter participants by live presence: ticket.participants is sticky in
  // the DB (audit/history record) but the queue row should only show supports
  // who are actually around right now. Self is always kept as a safety net.
  const liveParticipants = useMemo(() => {
    const onlineIds = new Set(onlineSupportUsers.map((u) => u.userId));
    return ticket.participants.filter(
      (p) => p.id === currentUserId || onlineIds.has(p.id),
    );
  }, [ticket.participants, onlineSupportUsers, currentUserId]);

  const rowClasses = [
    'px-3 py-2.5 border-b border-[var(--color-border)] cursor-pointer',
    'hover:bg-[var(--color-bg-elevated)]',
    isActive && 'border-l-[3px] border-l-[var(--color-accent-blue)] bg-[rgba(59,130,246,0.06)]',
    !isActive && isUnread && 'bg-[rgba(59,130,246,0.04)]',
    isActive && isUnread && 'bg-[rgba(59,130,246,0.08)]',
    disabled && 'opacity-40 cursor-not-allowed',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  // Timer for row 2
  const timerContent = variant === 'queue'
    ? (() => {
        const { text, severity } = formatQueueWait(ticket.createdAt);
        const colorClass = severity === 'red' ? 'text-[var(--color-accent-red)]'
          : severity === 'amber' ? 'text-[var(--color-accent-amber)]'
          : 'text-[var(--color-text-muted)]';
        return (
          <span className={`font-mono text-[9px] font-bold tracking-wide ml-auto ${colorClass}`}>
            {text}
          </span>
        );
      })()
    : (
      <span className="font-mono text-[9px] font-bold tracking-wide text-[var(--color-text-muted)] ml-auto">
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
        <span className="font-mono text-[7px] font-bold uppercase tracking-[0.5px] px-[5px] py-px border border-[var(--color-accent-blue)] text-[var(--color-accent-blue)] shrink-0">
          {ticket.dept}
        </span>
        {agentOnline && (
          <span
            data-agent-online
            title="Customer is online"
            className="w-1.5 h-1.5 rounded-full shrink-0 bg-[var(--color-accent-green)]"
          />
        )}
        <span className="text-[13px] font-semibold text-[var(--color-text-primary)] truncate flex-1 min-w-0">
          {ticket.agentName}
        </span>
        {isUnread && (
          <span className="font-mono text-[8px] font-bold bg-[var(--color-accent-blue)] text-white min-w-[16px] h-4 flex items-center justify-center px-1 shrink-0">
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
