import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';
import { Ticket } from '../../types';
import { ChevronRight } from 'lucide-react';

interface TicketSidebarProps {
  ticket: Ticket;
  onPreviewTicket?: (ticket: Ticket) => void;
  onToggle: () => void;
}

export default function TicketSidebar({ ticket, onPreviewTicket, onToggle }: TicketSidebarProps) {
  const t = useT();

  // ── Past Tickets ──
  const { data: pastTickets } = trpc.ticket.list.useQuery(
    { agentId: ticket.agentId, limit: 10 },
    { enabled: !!ticket.agentId }
  );

  type TicketListResult = { tickets: Ticket[]; nextCursor?: string | null };
  const pastList = Array.isArray(pastTickets)
    ? pastTickets.filter((tk) => tk.id !== ticket.id)
    : ((pastTickets as TicketListResult | undefined)?.tickets || []).filter((tk) => tk.id !== ticket.id);

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--color-border)] bg-[var(--color-bg-base)]">
        <span className="mono-label">{t('ticket_context') || 'CONTEXT'}</span>
        <button
          onClick={onToggle}
          className="p-1 hover:bg-[var(--color-accent-blue)] hover:text-[var(--color-bg-base)]"
          title={t('collapse_sidebar') || 'Collapse'}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-4">
        {/* Past Tickets */}
        <section>
          <h3 className="mono-label opacity-40 mb-2">
            {t('past_tickets') || 'History'} ({pastList.length})
          </h3>
          {pastList.length === 0 ? (
            <p className="text-[12px] text-[var(--color-text-primary)] opacity-40 italic">
              {t('no_history') || 'First contact'}
            </p>
          ) : (
            <div className="space-y-2">
              {pastList.slice(0, 5).map((tk) => (
                <div
                  key={tk.id}
                  className={`surface-card ${onPreviewTicket ? 'cursor-pointer hover:bg-[var(--color-bg-elevated)]' : ''}`}
                  onClick={() => onPreviewTicket?.(tk as Ticket)}
                >
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-mono text-[8px] border border-[var(--color-accent-blue)] text-[var(--color-accent-blue)] px-1.5 py-0.5 uppercase">
                      {tk.dept}
                    </span>
                    <span className="mono-label opacity-60 uppercase">{tk.status}</span>
                  </div>
                  <span className="mono-timestamp">
                    {new Date(tk.createdAt).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
