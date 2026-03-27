import { useT } from '../../i18n';
import { LANG_FLAG } from '../../constants';
import { trpc } from '../../utils/trpc';
import { Ticket } from '../../types';
import useStore from '../../store/useStore';

interface CustomerInfoPanelProps {
  ticket: Ticket;
}

/**
 * Right sidebar showing agent/customer context for the current ticket.
 * Displays agent profile, past tickets, references, and labels.
 */
export default function CustomerInfoPanel({ ticket }: CustomerInfoPanelProps) {
  const t = useT();
  const allLabels = useStore((s) => s.allLabels);
  const participantsOnline = useStore((s) => s.participantsOnline);

  // Fetch agent's past tickets
  const { data: pastTickets } = trpc.ticket.list.useQuery(
    { agentId: ticket.agentId, limit: 10 },
    { enabled: !!ticket.agentId }
  );

  const pastList = Array.isArray(pastTickets)
    ? pastTickets.filter((t: any) => t.id !== ticket.id)
    : ((pastTickets as any)?.tickets || []).filter((t: any) => t.id !== ticket.id);

  const agentOnline = participantsOnline[ticket.id] ?? false;
  const references = ticket.references || [];
  const labels = (ticket.labels || []).map(id => (allLabels || []).find(l => l.id === id)).filter(Boolean);

  return (
    <aside className="w-72 bg-[var(--color-bg-surface)] border-l border-[var(--color-border)] flex flex-col overflow-hidden">
      {/* Agent info header */}
      <div className="px-5 py-4 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-full bg-[var(--color-bg-base)] border border-[var(--color-border)] flex items-center justify-center text-sm font-bold uppercase">
            {(ticket.agentName || '?').charAt(0)}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm truncate">{ticket.agentName}</span>
              <span className={`w-2 h-2 rounded-full shrink-0 ${agentOnline ? 'bg-[var(--color-accent-blue)]' : 'opacity-30 bg-[var(--color-text-primary)]'}`} />
            </div>
            {ticket.agentLang && (
              <span className="mono-label opacity-60 flex items-center gap-1">
                {LANG_FLAG[ticket.agentLang as keyof typeof LANG_FLAG]} {ticket.agentLang.toUpperCase()}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-[8px] border border-[var(--color-accent-blue)] text-[var(--color-accent-blue)] px-1.5 py-0.5 uppercase">
            {ticket.dept}
          </span>
          <span className="badge">
            {ticket.status}
          </span>
        </div>
      </div>

      {/* References */}
      {references.length > 0 && (
        <div className="px-5 py-3 border-b border-[var(--color-border)]">
          <h3 className="mono-label opacity-60 mb-2">
            {t('references') || 'References'}
          </h3>
          <div className="space-y-1.5">
            {references.map((ref: { label: string; value: string }, i: number) => (
              <div key={i} className="flex items-baseline gap-2">
                <span className="mono-label opacity-60 shrink-0">{ref.label}:</span>
                <span className="text-[12px] text-[var(--color-text-primary)] font-mono truncate">{ref.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Labels */}
      {labels.length > 0 && (
        <div className="px-5 py-3 border-b border-[var(--color-border)]">
          <h3 className="mono-label opacity-60 mb-2">
            {t('labels') || 'Labels'}
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {labels.map((label: any) => (
              <span
                key={label.id}
                className="font-mono text-[8px] border border-[var(--color-accent-blue)] text-[var(--color-accent-blue)] px-1.5 py-0.5 uppercase"
              >
                {label.text || label.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Past tickets */}
      <div className="px-5 py-3 flex-1 overflow-y-auto">
        <h3 className="mono-label opacity-60 mb-2">
          {t('past_tickets') || 'History'} ({pastList.length})
        </h3>
        {pastList.length === 0 ? (
          <p className="text-[12px] text-[var(--color-text-primary)] opacity-40 italic">{t('no_history') || 'First contact'}</p>
        ) : (
          <div className="space-y-2">
            {pastList.slice(0, 8).map((t: any) => (
              <div key={t.id} className="surface-card">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-mono text-[8px] border border-[var(--color-accent-blue)] text-[var(--color-accent-blue)] px-1.5 py-0.5 uppercase">{t.dept}</span>
                  <span className="mono-label opacity-60 uppercase">{t.status}</span>
                </div>
                <span className="mono-timestamp">
                  {new Date(t.createdAt).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
