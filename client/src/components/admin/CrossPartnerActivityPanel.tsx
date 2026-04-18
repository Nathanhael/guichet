import { trpc } from '../../utils/trpc';

/**
 * Cross-partner audit activity rollup.
 *
 * Aggregates audit_log rows per partner over the caller's selected time window
 * so platform operators can spot which tenant is unusually noisy — often the
 * first signal of a compromised account, a misconfigured SSO mapping, or an
 * internal tool gone wild. Purely an aggregate view; clicking a row scopes
 * the main audit log below by partnerId for the raw investigation.
 *
 * Respects whatever dateFrom/dateTo the operator already has applied in the
 * audit log — the server defaults are intentionally absent so ops can zoom
 * all the way out to "since the beginning of time" if they need to.
 */
type Props = {
  dateFrom?: string;
  dateTo?: string;
  onSelectPartner: (partnerId: string) => void;
};

export default function CrossPartnerActivityPanel({ dateFrom, dateTo, onSelectPartner }: Props) {
  const { data, isLoading } = trpc.platform.getCrossPartnerActivity.useQuery(
    { dateFrom, dateTo, limit: 10 },
    { refetchOnWindowFocus: false, staleTime: 30_000 },
  );

  if (isLoading) {
    return (
      <div className="bg-bg-elevated p-4 border border-[var(--color-border)]">
        <p className="mono-label">Loading cross-partner activity…</p>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return null;
  }

  const total = data.reduce((sum, r) => sum + r.totalEvents, 0);

  return (
    <div
      className="bg-bg-elevated p-4 border border-[var(--color-border)]"
      data-testid="cross-partner-activity-panel"
    >
      <div className="flex items-center justify-between mb-3">
        <p className="mono-label">Cross-partner activity (top {data.length})</p>
        <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-text-muted)]">
          {total.toLocaleString()} total events
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-[var(--color-border)]">
              <th className="p-2 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Partner</th>
              <th className="p-2 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] text-right">Events</th>
              <th className="p-2 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] text-right">% of total</th>
              <th className="p-2 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Last activity</th>
              <th className="p-2 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {data.map((row) => {
              const partnerId = row.partnerId ?? '';
              if (!partnerId) return null;
              const pct = total > 0 ? ((row.totalEvents / total) * 100).toFixed(1) : '0.0';
              return (
                <tr key={partnerId}>
                  <td className="p-2 text-[11px] font-bold">
                    {row.partnerName || <span className="font-mono text-[var(--color-text-muted)]">{partnerId}</span>}
                  </td>
                  <td className="p-2 text-[11px] font-mono text-right">
                    {row.totalEvents.toLocaleString()}
                  </td>
                  <td className="p-2 text-[10px] font-mono text-right text-[var(--color-text-secondary)]">
                    {pct}%
                  </td>
                  <td className="p-2 text-[10px] font-mono whitespace-nowrap text-[var(--color-text-secondary)]">
                    {row.lastEventAt ? new Date(row.lastEventAt).toLocaleString() : '—'}
                  </td>
                  <td className="p-2 text-right">
                    <button
                      type="button"
                      onClick={() => onSelectPartner(partnerId)}
                      data-testid={`cross-partner-activity-select-${partnerId}`}
                      className="font-mono text-[9px] uppercase tracking-widest px-2 py-1 border border-[var(--color-border)] bg-[var(--color-bg-base)] hover:bg-[var(--color-accent-blue)] hover:text-white hover:border-[var(--color-accent-blue)]"
                    >
                      Filter →
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
