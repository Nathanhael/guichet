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
    'px-3 py-2.5 border-b border-[var(--color-border)] cursor-pointer opacity-70 hover:opacity-100',
    'hover:bg-[var(--color-bg-elevated)]',
    isActive && 'border-l-[3px] border-l-[var(--color-accent-blue)] opacity-100',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <li className={rowClasses} onClick={onClick}>
      {/* Row 1: dept + closed badge + name + time */}
      <div className="flex items-center gap-1.5 mb-1">
        <span className="font-mono text-[7px] font-bold uppercase tracking-[0.5px] px-[5px] py-px border border-[var(--color-accent-blue)] text-[var(--color-accent-blue)] shrink-0">
          {ticket.dept}
        </span>
        <span className="font-mono text-[7px] font-bold uppercase tracking-[0.5px] px-[5px] py-px border border-[var(--color-text-faint)] text-[var(--color-text-muted)] shrink-0">
          Closed
        </span>
        <span className="text-[13px] font-semibold text-[var(--color-text-primary)] truncate flex-1 min-w-0">
          {ticket.agentName}
        </span>
        <span className="font-mono text-[9px] text-[var(--color-text-muted)] shrink-0 ml-auto">
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
