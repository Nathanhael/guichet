import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';
import { Ticket } from '../../types';
import { ChevronRight } from 'lucide-react';
import SectionLabel from '../ui/SectionLabel';
import Pill from '../ui/Pill';

interface TicketSidebarProps {
  ticket: Ticket;
  onPreviewTicket?: (ticket: Ticket) => void;
  onToggle: () => void;
}

export default function TicketSidebar({ ticket, onPreviewTicket, onToggle }: TicketSidebarProps) {
  const t = useT();

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
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--color-border)] bg-[var(--color-bg-surface)]">
        <SectionLabel>{t('ticket_context')}</SectionLabel>
        <button
          onClick={onToggle}
          className="p-1 rounded-[var(--radius-btn)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] hover:bg-[var(--color-hover)] transition-colors"
          title={t('collapse_sidebar')}
        >
          <ChevronRight className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-4">
        <section>
          <div className="mb-2 flex items-center gap-1.5">
            <SectionLabel>{t('past_tickets')}</SectionLabel>
            <span className="text-[11px] text-[var(--color-ink-muted)] tabular-nums">({pastList.length})</span>
          </div>
          {pastList.length === 0 ? (
            <p className="text-[12px] text-[var(--color-ink-muted)] italic">
              {t('no_history')}
            </p>
          ) : (
            <div className="space-y-2">
              {pastList.slice(0, 5).map((tk) => (
                <div
                  key={tk.id}
                  className={`rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)] p-2.5 transition-colors ${
                    onPreviewTicket ? 'cursor-pointer hover:bg-[var(--color-hover)]' : ''
                  }`}
                  onClick={() => onPreviewTicket?.(tk as Ticket)}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Pill tone="accent">{tk.dept}</Pill>
                    <Pill tone="muted">{tk.status}</Pill>
                  </div>
                  <span className="text-[11px] text-[var(--color-ink-muted)]">
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
