import { useEffect } from 'react';
import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';
import { Ticket } from '../../types';
import {
  ChevronRight,
  RefreshCw,
  Brain,
} from 'lucide-react';

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

  // ── AI Summary ──
  const aiConfigQuery = trpc.partner.getAiConfig.useQuery(undefined, { staleTime: 60000 });
  const aiConfig = aiConfigQuery.data;
  const summaryMutation = trpc.ai.summarizeChat.useMutation();

  // Auto-summarize when ticket changes (if enabled)
  useEffect(() => {
    if (aiConfig?.chatSummarization) {
      summaryMutation.mutate({ ticketId: ticket.id });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket.id, aiConfig?.chatSummarization]);

  const aiEnabled = aiConfig?.chatSummarization === true;

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--color-border)] bg-[var(--color-bg-base)]">
        <span className="mono-label">{t('ticket_context') || 'CONTEXT'}</span>
        <button
          onClick={onToggle}
          className="p-1 hover:bg-[var(--color-accent-blue)] hover:text-white"
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

        {/* AI Summary (only when AI chat summarization is enabled) */}
        {aiEnabled && (
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="mono-label opacity-40">{t('ai_summary') || 'SUMMARY'}</h3>
              <button
                onClick={() => summaryMutation.mutate({ ticketId: ticket.id, refresh: true })}
                disabled={summaryMutation.isPending}
                className="p-1 hover:bg-[var(--color-accent-blue)] hover:text-white"
                title={t('refresh_summary') || 'Refresh summary'}
              >
                <RefreshCw className={`h-3 w-3 ${summaryMutation.isPending ? 'animate-spin' : ''}`} />
              </button>
            </div>
            <div className="border border-[var(--color-border)] p-2.5">
              {summaryMutation.isPending ? (
                <div className="flex items-center gap-2 text-xs opacity-40">
                  <Brain className="h-3.5 w-3.5" />
                  <span className="mono-label">{t('ai_analyzing') || 'Analyzing...'}</span>
                </div>
              ) : summaryMutation.data?.summary ? (
                <p className="text-xs leading-relaxed opacity-80">{summaryMutation.data.summary}</p>
              ) : summaryMutation.error ? (
                <p className="text-xs opacity-40 italic">{t('ai_unavailable') || 'AI unavailable'}</p>
              ) : (
                <p className="text-xs opacity-40 italic">{t('ai_no_summary') || 'No summary yet'}</p>
              )}
            </div>
          </section>
        )}
      </div>
    </>
  );
}
