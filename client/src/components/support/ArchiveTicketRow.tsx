import type { Ticket } from '../../types';
import { getSmartTimestamp } from '../../utils/dateUtils';
import AgentBadges from './AgentBadges';

interface ArchiveTicketRowProps {
  ticket: Ticket;
  isActive: boolean;
  currentUserId: string;
  onClick: () => void;
}

export default function ArchiveTicketRow({
  ticket,
  isActive,
  currentUserId,
  onClick,
}: ArchiveTicketRowProps) {
  const rowClasses = [
    'px-3 py-2.5 border-b border-[var(--color-border)] cursor-pointer opacity-70 hover:opacity-100 transition-colors',
    'hover:bg-[var(--color-hover)]',
    isActive && 'border-l-[3px] border-l-[var(--color-accent)] opacity-100',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <li className={rowClasses} onClick={onClick}>
      {/* Row 1: dept + closed badge + name + time */}
      <div className="flex items-center gap-1.5 mb-1">
        <span className="inline-flex items-center rounded-[var(--radius-pill)] text-[10px] font-semibold px-1.5 py-0.5 border border-[var(--color-accent)] text-[var(--color-accent)] shrink-0 leading-none">
          {ticket.dept}
        </span>
        <span className="inline-flex items-center rounded-[var(--radius-pill)] text-[10px] font-semibold px-1.5 py-0.5 border border-[var(--color-border)] text-[var(--color-ink-muted)] shrink-0 leading-none">
          Closed
        </span>
        <span className="text-[13px] font-semibold text-[var(--color-ink)] truncate flex-1 min-w-0">
          {ticket.agentName}
        </span>
        <span className="text-[11px] font-medium tabular-nums text-[var(--color-ink-muted)] shrink-0 ml-auto">
          {getSmartTimestamp(ticket.closedAt || ticket.createdAt)}
        </span>
      </div>

      {/* Row 2: agent badges */}
      <div className="flex items-center gap-1.5">
        <AgentBadges
          participants={ticket.participants || []}
          currentUserId={currentUserId}
        />
      </div>
    </li>
  );
}
