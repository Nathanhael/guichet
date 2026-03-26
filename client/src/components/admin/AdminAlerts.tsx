import { useState } from 'react';
import { trpc } from '../../utils/trpc';

export default function AdminAlerts() {
  const [filter, setFilter] = useState<'active' | 'acknowledged' | 'resolved' | undefined>('active');

  const { data: alerts, isLoading, refetch } = trpc.alerts.list.useQuery({ status: filter, limit: 50 });
  const acknowledgeMutation = trpc.alerts.acknowledge.useMutation({ onSuccess: () => refetch() });
  const resolveMutation = trpc.alerts.resolve.useMutation({ onSuccess: () => refetch() });

  const FILTERS: { value: 'active' | 'acknowledged' | 'resolved' | undefined; label: string }[] = [
    { value: 'active', label: 'Active' },
    { value: 'acknowledged', label: 'Acknowledged' },
    { value: 'resolved', label: 'Resolved' },
    { value: undefined, label: 'All' },
  ];

  return (
    <div className="min-w-[1120px] max-w-4xl space-y-6">
      <div className="flex items-end justify-between gap-6 border-b border-[var(--color-border)] pb-4">
        <div>
          <h2 className="text-4xl font-bold uppercase tracking-tighter">Topic Alerts</h2>
          <p className="text-sm font-bold uppercase text-[var(--color-text-secondary)] mt-1 tracking-wide">Incident detection based on conversation clustering.</p>
        </div>
        <div className="flex gap-1 overflow-x-auto">
          {FILTERS.map(({ value, label }) => (
            <button
              key={label}
              onClick={() => setFilter(value)}
              className={`px-4 py-2 mono-label border border-[var(--color-border)] ${filter === value ? 'bg-[var(--color-text-primary)] text-[var(--color-bg-base)]' : ''}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="py-8 text-center mono-label text-[var(--color-text-muted)]">Loading alerts...</div>
      ) : !alerts?.length ? (
        <div className="surface-card p-12 text-center">
          <p className="font-bold uppercase tracking-wide text-lg">No {filter ?? ''} alerts</p>
          <p className="text-xs uppercase text-[var(--color-text-secondary)] mt-2">All departments are operating normally.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {alerts.map((alert) => (
            <div key={alert.id} className="surface-card p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2 overflow-x-auto">
                    <span className="border border-[var(--color-border)] mono-label px-2 py-0.5">
                      {alert.severity} severity
                    </span>
                    <span className="border border-[var(--color-border)] mono-label px-2 py-0.5 text-[var(--color-text-secondary)]">
                      {alert.dept}
                    </span>
                    <span className="text-[10px] font-mono text-[var(--color-text-secondary)]">
                      {new Date(alert.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <h3 className="text-lg font-bold uppercase tracking-tight mb-1">{alert.topic}</h3>
                  <p className="text-sm opacity-80 mb-3">{alert.summary}</p>
                  <p className="mono-label text-[var(--color-text-secondary)]">{alert.ticketCount} tickets</p>
                </div>

                <div className="flex flex-col gap-2 shrink-0">
                  {alert.status === 'active' && (
                    <button
                      onClick={() => acknowledgeMutation.mutate(alert.id)}
                      disabled={acknowledgeMutation.isPending}
                      className="btn-secondary disabled:opacity-30"
                    >
                      Acknowledge
                    </button>
                  )}
                  {(alert.status === 'active' || alert.status === 'acknowledged') && (
                    <button
                      onClick={() => resolveMutation.mutate(alert.id)}
                      disabled={resolveMutation.isPending}
                      className="btn-primary disabled:opacity-30"
                    >
                      Resolve
                    </button>
                  )}
                  {alert.status === 'resolved' && (
                    <div className="text-right">
                      <p className="mono-label text-[var(--color-text-secondary)]">Resolved</p>
                      <p className="text-xs font-mono">{alert.resolvedAt ? new Date(alert.resolvedAt).toLocaleTimeString() : '—'}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
