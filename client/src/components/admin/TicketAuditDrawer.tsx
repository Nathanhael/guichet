import { useEffect, useState } from 'react';
import { trpc } from '../../utils/trpc';
import AuditMetadataDrawer, { AuditEntry } from './AuditMetadataDrawer';

interface Props {
  ticketId: string | null;
  ticketLabel?: string;
  onClose: () => void;
}

export default function TicketAuditDrawer({ ticketId, ticketLabel, onClose }: Props) {
  const [selected, setSelected] = useState<AuditEntry | null>(null);

  const query = trpc.partner.audit.getForTicket.useQuery(
    { ticketId: ticketId || '' },
    { enabled: !!ticketId },
  );

  useEffect(() => {
    if (!ticketId) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !selected) onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [ticketId, onClose, selected]);

  if (!ticketId) return null;

  const entries = (query.data as AuditEntry[] | undefined) ?? [];

  return (
    <>
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-label="Ticket audit history"
        className="fixed top-0 right-0 h-full w-full max-w-xl bg-[var(--color-bg-surface)] border-l border-[var(--color-border-heavy)] z-50 overflow-y-auto flex flex-col"
      >
        <div className="flex justify-between items-start p-6 border-b border-[var(--color-border)]">
          <div className="min-w-0">
            <h3 className="text-lg font-bold uppercase tracking-wide">Audit History</h3>
            <p className="mono-label mt-2 truncate">{ticketLabel || ticketId}</p>
          </div>
          <button onClick={onClose} className="btn-secondary" aria-label="Close">
            Close
          </button>
        </div>

        <div className="p-6 flex-1">
          {query.isLoading ? (
            <p className="text-sm text-[var(--color-text-muted)]">Loading...</p>
          ) : query.error ? (
            <p className="text-sm text-[var(--color-accent-red)]">{query.error.message}</p>
          ) : entries.length === 0 ? (
            <div className="border border-[var(--color-border)] bg-[var(--color-bg-base)] px-4 py-8 text-center">
              <p className="mono-label mb-2">No audit history</p>
              <p className="text-xs text-[var(--color-text-muted)]">
                No audit entries reference this ticket yet.
              </p>
            </div>
          ) : (
            <ul
              className="divide-y divide-[var(--color-border)] border border-[var(--color-border)] bg-[var(--color-bg-base)]"
              data-testid="ticket-audit-list"
            >
              {entries.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(entry)}
                    className="w-full text-left px-4 py-3 hover:bg-bg-elevated focus:outline-none focus:bg-bg-elevated"
                  >
                    <div className="flex justify-between items-start gap-3 mb-1">
                      <span className="font-mono text-xs font-bold uppercase tracking-wide break-all">
                        {entry.action}
                      </span>
                      <span className="mono-label shrink-0">
                        {new Date(entry.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-[10px] text-[var(--color-text-muted)]">
                      {entry.actorName || entry.actorId || 'System'}
                      {entry.targetType ? ` · ${entry.targetType}` : ''}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      <AuditMetadataDrawer entry={selected} onClose={() => setSelected(null)} />
    </>
  );
}
