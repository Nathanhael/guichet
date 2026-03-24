import useStore from '../../store/useStore';
import { useT } from '../../i18n';
import { getTicketTime } from '../../utils/dateUtils';
import { Ticket } from '../../types';
import { LANG_FLAG } from '../../constants';

const STATUS_DOT: Record<string, string> = {
  open: 'bg-yellow-500',
  active: 'bg-green-500',
  closed: 'bg-gray-400',
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
        isOpen ? 'w-80 border-r-2 border-black/20 dark:border-white/20 max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:shadow-2xl max-md:bg-white max-md:dark:bg-black' : 'w-0 border-r-0'
      } shrink-0 overflow-hidden transition-all duration-200 bg-white/60 dark:bg-brand-900/60 backdrop-blur-sm flex flex-col`}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b-2 border-black/20 dark:border-white/20 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <h2 className="font-black text-[10px] uppercase tracking-[0.2em]">{t('my_tickets')}</h2>
          {unreadCount > 0 && (
            <span className="bg-black dark:bg-white text-white dark:text-black text-[9px] font-black px-1.5 py-0.5">
              {unreadCount}
            </span>
          )}
        </div>
        <button
          onClick={() => setActiveTicketId(null)}
          className="text-[10px] font-black uppercase tracking-widest border-2 border-black dark:border-white px-3 py-1 hover:bg-black dark:hover:bg-white hover:text-white dark:hover:text-black transition-colors"
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
              className={`w-full text-left px-4 py-3 border-b border-black/10 dark:border-white/10 transition-colors ${
                isActive
                  ? 'bg-black dark:bg-white text-white dark:text-black'
                  : 'hover:bg-black/5 dark:hover:bg-white/5'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-black uppercase tracking-widest opacity-70">{ticket.dept}</span>
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

                {isUnread && <span className="w-2.5 h-2.5 bg-black dark:bg-white rounded-full shrink-0 mt-1" />}
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
