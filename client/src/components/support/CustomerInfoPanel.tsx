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
    <aside className="w-72 bg-white dark:bg-black border-l-2 border-black dark:border-white flex flex-col overflow-hidden">
      {/* Agent info header */}
      <div className="px-5 py-4 border-b-2 border-black dark:border-white">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-800 flex items-center justify-center text-sm font-black uppercase">
            {(ticket.agentName || '?').charAt(0)}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-black text-sm truncate">{ticket.agentName}</span>
              <span className={`w-2 h-2 rounded-full shrink-0 ${agentOnline ? 'bg-green-500' : 'bg-slate-300 dark:bg-slate-600'}`} />
            </div>
            {ticket.agentLang && (
              <span className="text-[10px] text-slate-500 flex items-center gap-1">
                {LANG_FLAG[ticket.agentLang as keyof typeof LANG_FLAG]} {ticket.agentLang.toUpperCase()}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[9px] font-black px-2 py-0.5 border border-current uppercase tracking-widest">
            {ticket.dept}
          </span>
          <span className={`text-[9px] font-black px-2 py-0.5 uppercase tracking-widest ${
            ticket.status === 'open' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300' :
            ticket.status === 'active' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' :
            'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
          }`}>
            {ticket.status}
          </span>
        </div>
      </div>

      {/* References */}
      {references.length > 0 && (
        <div className="px-5 py-3 border-b border-black/10 dark:border-white/10">
          <h3 className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">
            {t('references') || 'References'}
          </h3>
          <div className="space-y-1.5">
            {references.map((ref: { label: string; value: string }, i: number) => (
              <div key={i} className="flex items-baseline gap-2">
                <span className="text-[10px] font-bold text-slate-500 shrink-0 uppercase">{ref.label}:</span>
                <span className="text-xs font-mono text-black dark:text-white truncate">{ref.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Labels */}
      {labels.length > 0 && (
        <div className="px-5 py-3 border-b border-black/10 dark:border-white/10">
          <h3 className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">
            {t('labels') || 'Labels'}
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {labels.map((label: any) => (
              <span
                key={label.id}
                className="text-[9px] font-black px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 uppercase tracking-wider"
              >
                {label.text || label.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Past tickets */}
      <div className="px-5 py-3 flex-1 overflow-y-auto">
        <h3 className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">
          {t('past_tickets') || 'History'} ({pastList.length})
        </h3>
        {pastList.length === 0 ? (
          <p className="text-[10px] text-slate-400 italic">{t('no_history') || 'First contact'}</p>
        ) : (
          <div className="space-y-2">
            {pastList.slice(0, 8).map((t: any) => (
              <div key={t.id} className="p-2 border border-black/10 dark:border-white/10 rounded">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[9px] font-black px-1.5 py-0.5 border border-current uppercase">{t.dept}</span>
                  <span className={`text-[9px] font-bold uppercase ${t.status === 'closed' ? 'text-slate-400' : 'text-green-600'}`}>
                    {t.status}
                  </span>
                </div>
                <span className="text-[10px] text-slate-500">
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
