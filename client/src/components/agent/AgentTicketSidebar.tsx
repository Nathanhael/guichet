import { ChevronLeft } from 'lucide-react';
import useStore from '../../store/useStore';
import { useT } from '../../i18n';
import { getTicketTime } from '../../utils/dateUtils';
import { Ticket } from '../../types';
import { LANG_FLAG } from '../../constants';

const STATUS_DOT: Record<string, string> = {
  open: 'bg-[var(--color-accent-yellow)]',
  active: 'bg-[var(--color-accent-green)]',
  closed: 'bg-[var(--color-text-muted)]',
};

interface AgentTicketSidebarProps {
  tickets: Ticket[];
  unreadCount: number;
  onToggle: () => void;
}

/**
 * Sidebar listing the agent's open ticket(s).
 * Shows department badge, status dot, references, lang flag, time, and unread indicator.
 */
export default function AgentTicketSidebar({ tickets, unreadCount, onToggle }: AgentTicketSidebarProps) {
  const activeTicketId = useStore((s) => s.activeTicketId);
  const setActiveTicketId = useStore((s) => s.setActiveTicketId);
  const clearUnread = useStore((s) => s.clearUnread);
  const unreadTickets = useStore((s) => s.unreadTickets);
  const t = useT();

  function selectTicket(ticketId: string) {
    setActiveTicketId(ticketId);
    clearUnread(ticketId);
  }

  return (
    <>
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <h2 className="mono-label">{t('my_tickets')}</h2>
          {unreadCount > 0 && (
            <span className="bg-[var(--color-text-primary)] text-[var(--color-bg-base)] text-[9px] font-bold px-1.5 py-0.5">
              {unreadCount}
            </span>
          )}
        </div>
        <button onClick={onToggle} className="opacity-30 hover:opacity-100" title="Collapse">
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Ticket list */}
      <div className="flex-1 overflow-y-auto">
        {tickets.map((ticket) => {
          const isActive = activeTicketId === ticket.id;
          const isUnread = !!unreadTickets[ticket.id];
          const time = getTicketTime(ticket.createdAt);

          const refs = (ticket.references as Array<{label: string; value: string}>) || [];

          return (
            <button
              key={ticket.id}
              onClick={() => selectTicket(ticket.id)}
              className={`w-full text-left px-4 py-3.5 border-b border-[var(--color-border)] ${
                isActive
                  ? 'bg-[var(--color-text-primary)] text-[var(--color-bg-base)]'
                  : 'hover:bg-[var(--color-bg-hover)]'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  {/* Department badge + status */}
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={`text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 border shrink-0 ${
                      isActive ? 'border-current' : 'border-[var(--color-border)]'
                    }`}>{ticket.dept}</span>
                    <span className={`w-1.5 h-1.5 shrink-0 ${STATUS_DOT[ticket.status] || STATUS_DOT.open}`} />
                    <span className="text-[9px] uppercase tracking-wider opacity-50">{ticket.status}</span>
                  </div>

                  {/* Primary: reference values as ticket identifier */}
                  {refs.length > 0 ? (
                    <p className="text-sm font-bold truncate">
                      {refs.map((r) => r.value).join(' \u00b7 ')}
                    </p>
                  ) : (
                    <p className="text-sm font-bold truncate opacity-40 font-mono">
                      #{ticket.id.slice(0, 8)}
                    </p>
                  )}

                  {/* Footer: lang + time */}
                  <div className="flex items-center gap-2 mt-1.5 text-[10px] opacity-40">
                    {LANG_FLAG[ticket.agentLang ?? ''] && <span>{LANG_FLAG[ticket.agentLang ?? '']}</span>}
                    <span className="font-mono">{time}</span>
                  </div>
                </div>

                {isUnread && !isActive && <span className="w-2 h-2 bg-[var(--color-accent-blue)] shrink-0 mt-2" />}
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}
