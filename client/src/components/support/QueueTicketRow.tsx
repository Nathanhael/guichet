import type { Ticket } from '../../types';
import { getSmartTimestamp } from '../../utils/dateUtils';
import AgentBadges from './AgentBadges';

interface QueueTicketRowProps {
  ticket: Ticket;
  isActive: boolean;
  unreadCount: number;
  currentUserId: string;
  onClick: () => void;
  disabled?: boolean;
}

const STATUS_DOT_COLORS: Record<string, string> = {
  open: 'bg-[var(--color-accent-green)]',
  pending: 'bg-[var(--color-accent-purple)]',
};

export default function QueueTicketRow({
  ticket,
  isActive,
  unreadCount,
  currentUserId,
  onClick,
  disabled = false,
}: QueueTicketRowProps) {
  const isUnread = unreadCount > 0;

  const rowClasses = [
    'px-3 py-2.5 border-b border-[var(--color-border)] cursor-pointer',
    'hover:bg-[var(--color-bg-elevated)]',
    isActive && 'border-l-[3px] border-l-[var(--color-accent-blue)] bg-[rgba(59,130,246,0.06)]',
    !isActive && isUnread && 'bg-[rgba(59,130,246,0.04)]',
    isActive && isUnread && 'bg-[rgba(59,130,246,0.08)]',
    disabled && 'opacity-40 cursor-not-allowed',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <li
      className={rowClasses}
      onClick={disabled ? undefined : onClick}
    >
      {/* Row 1: dept + status + name + time */}
      <div className="flex items-center gap-1.5 mb-1">
        <span className="font-mono text-[7px] font-bold uppercase tracking-[0.5px] px-[5px] py-px border border-[var(--color-accent-blue)] text-[var(--color-accent-blue)] shrink-0">
          {ticket.dept}
        </span>
        <span
          data-status-dot
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT_COLORS[ticket.status] || 'bg-[var(--color-text-muted)]'}`}
        />
        <span className="text-[13px] font-semibold text-[var(--color-text-primary)] truncate flex-1 min-w-0">
          {ticket.agentName}
        </span>
        <span className="font-mono text-[9px] text-[var(--color-text-muted)] shrink-0 ml-auto">
          {getSmartTimestamp(ticket.createdAt)}
        </span>
      </div>

      {/* Row 2: agent badges + unread count */}
      <div className="flex items-center gap-1.5">
        <AgentBadges
          participants={ticket.participants}
          currentUserId={currentUserId}
        />
        {isUnread && (
          <span className="font-mono text-[8px] font-bold bg-[var(--color-accent-blue)] text-white min-w-[16px] h-4 flex items-center justify-center px-1 shrink-0 ml-auto">
            {unreadCount}
          </span>
        )}
      </div>
    </li>
  );
}
