import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
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
        className="fixed top-0 right-0 h-full w-full max-w-xl bg-[var(--color-bg-surface)] shadow-[var(--shadow-modal)] z-50 overflow-y-auto flex flex-col"
      >
        <div className="flex justify-between items-start p-5 border-b border-[var(--color-border)]">
          <div className="min-w-0">
            <h3 className="text-[16px] font-semibold text-[var(--color-ink)]">Audit History</h3>
            <p className="text-[12px] text-[var(--color-ink-muted)] mt-1 truncate">{ticketLabel || ticketId}</p>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-full text-[var(--color-ink-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)] transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 flex-1">
          {query.isLoading ? (
            <p className="text-[13px] text-[var(--color-ink-muted)]">Loading…</p>
          ) : query.error ? (
            <p className="text-[13px] text-[var(--color-urgent)]">{query.error.message}</p>
          ) : entries.length === 0 ? (
            <div className="rounded-[var(--radius-card)] bg-[var(--color-bg-elevated)] px-4 py-10 text-center">
              <p className="text-[13px] font-medium text-[var(--color-ink-soft)] mb-1">No audit history</p>
              <p className="text-[12px] text-[var(--color-ink-muted)]">
                No audit entries reference this ticket yet.
              </p>
            </div>
          ) : (
            <ul
              className="divide-y divide-[var(--color-border)] rounded-[var(--radius-card)] bg-[var(--color-bg-elevated)] overflow-hidden"
              data-testid="ticket-audit-list"
            >
              {entries.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(entry)}
                    className="w-full text-left px-4 py-3 hover:bg-[var(--color-hover)] focus:outline-none focus:bg-[var(--color-hover)] transition-colors"
                  >
                    <div className="flex justify-between items-start gap-3 mb-1">
                      <span className="font-mono text-[12px] font-semibold text-[var(--color-ink)] break-all">
                        {entry.action}
                      </span>
                      <span className="text-[11px] text-[var(--color-ink-muted)] shrink-0 tabular-nums">
                        {new Date(entry.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-[11px] text-[var(--color-ink-muted)]">
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
