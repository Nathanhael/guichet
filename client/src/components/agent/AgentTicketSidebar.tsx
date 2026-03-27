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
  isOpen: boolean;
}

/**
 * Collapsible sidebar listing the agent's open tickets.
 * Shows department badge, status dot, references, lang flag, time, and unread indicator.
 */
export default function AgentTicketSidebar({ tickets, unreadCount, isOpen }: AgentTicketSidebarProps) {
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
    <aside
      className={`${
        isOpen ? 'w-80 border-r border-[var(--color-border)] max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:bg-[var(--color-bg-surface)]' : 'w-0 border-r-0'
      } shrink-0 overflow-hidden bg-[var(--color-bg-surface)] flex flex-col`}
    >
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
        <button
          onClick={() => setActiveTicketId(null)}
          className="mono-label border border-[var(--color-border)] px-3 py-1 hover:bg-[var(--color-accent-blue)] hover:text-white"
        >
          {t('new_ticket')}
        </button>
      </div>

      {/* Ticket list */}
      <div className="flex-1 overflow-y-auto">
        {tickets.map((ticket) => {
          const isActive = activeTicketId === ticket.id;
          const isUnread = unreadTickets.has(ticket.id);
          const time = getTicketTime(ticket.createdAt);

          return (
            <button
              key={ticket.id}
              onClick={() => selectTicket(ticket.id)}
              className={`w-full text-left px-4 py-3 border-b border-[var(--color-border)] ${
                isActive
                  ? 'bg-[var(--color-text-primary)] text-[var(--color-bg-base)]'
                  : 'hover:bg-[var(--color-bg-hover)]'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="mono-label opacity-70">{ticket.dept}</span>
                    <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[ticket.status] || STATUS_DOT.open}`} />
                    <span className="text-[10px] uppercase opacity-50">{ticket.status}</span>
                  </div>
                  {(ticket.references || []).length > 0 && (
                    <p className="text-[11px] opacity-60 truncate">
                      {(ticket.references || []).map((r) => r.value).join(' · ')}
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-1 text-[10px] opacity-50">
                    <span>{LANG_FLAG[ticket.agentLang] || ''}</span>
                    <span>{time}</span>
                  </div>
                </div>

                {isUnread && <span className="w-2.5 h-2.5 bg-[var(--color-text-primary)] rounded-full shrink-0 mt-1" />}
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
