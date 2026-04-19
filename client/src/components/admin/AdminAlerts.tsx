import { useState } from 'react';
import { trpc } from '../../utils/trpc';

type AlertFilter = 'active' | 'acknowledged' | 'resolved' | undefined;
type SlaStatus = 'active' | 'resolved';

export default function AdminAlerts() {
  const [topTab, setTopTab] = useState<'topic' | 'sla'>('topic');
  const [filter, setFilter] = useState<AlertFilter>('active');

  const utils = trpc.useUtils();
  const { data: alerts, isLoading } = trpc.alerts.list.useQuery({ status: filter, limit: 50 });
  const invalidate = () => utils.alerts.list.invalidate();
  const acknowledgeMutation = trpc.alerts.acknowledge.useMutation({ onSuccess: invalidate });
  const resolveMutation = trpc.alerts.resolve.useMutation({ onSuccess: invalidate });

  const ALL_FILTERS: { value: AlertFilter; label: string }[] = [
    { value: 'active', label: 'Active' },
    { value: 'acknowledged', label: 'Acknowledged' },
    { value: 'resolved', label: 'Resolved' },
    { value: undefined, label: 'All' },
  ];

  // SLA tab only supports 'active' | 'resolved'
  const visibleFilters = topTab === 'sla'
    ? ALL_FILTERS.filter((f) => f.value === 'active' || f.value === 'resolved')
    : ALL_FILTERS;

  const handleTopTab = (next: 'topic' | 'sla') => {
    setTopTab(next);
    // Coerce filter when switching to SLA if current value isn't active/resolved
    if (next === 'sla' && filter !== 'active' && filter !== 'resolved') {
      setFilter('active');
    }
  };

  // For the SLA list: filter is guaranteed to be 'active' | 'resolved' on this tab
  const slaStatus: SlaStatus = filter === 'resolved' ? 'resolved' : 'active';

  const isTopic = topTab === 'topic';

  return (
    <div className="min-w-[1120px] max-w-4xl space-y-6">
      <div className="flex items-end justify-between gap-6 border-b border-[var(--color-border)] pb-4">
        <div>
          <h2 className="text-4xl font-bold uppercase tracking-tighter">
            {isTopic ? 'Topic Alerts' : 'SLA Breaches'}
          </h2>
          <p className="text-sm font-bold uppercase text-[var(--color-text-secondary)] mt-1 tracking-wide">
            {isTopic
              ? 'Incident detection based on conversation clustering.'
              : 'First-response SLA tracking per department.'}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex gap-1">
            {(['topic', 'sla'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => handleTopTab(tab)}
                className={`px-4 py-2 mono-label border border-[var(--color-border)] ${topTab === tab ? 'bg-[var(--color-text-primary)] text-[var(--color-bg-base)]' : ''}`}
              >
                {tab === 'topic' ? 'Topic' : 'SLA'}
              </button>
            ))}
          </div>
          <div className="flex gap-1 overflow-x-auto">
            {visibleFilters.map(({ value, label }) => (
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
      </div>

      {isTopic ? (
        isLoading ? (
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
        )
      ) : (
        <SlaBreachList status={slaStatus} />
      )}
    </div>
  );
}

function SlaBreachList({ status }: { status: SlaStatus }) {
  const { data, isLoading } = trpc.sla.listBreaches.useQuery({ status, limit: 50 });
  if (isLoading) {
    return <div className="py-8 text-center mono-label text-[var(--color-text-muted)]">Loading SLA breaches...</div>;
  }
  if (!data?.items.length) {
    return (
      <div className="surface-card p-12 text-center">
        <p className="font-bold uppercase tracking-wide text-lg">No {status} SLA breaches</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {data.items.map((b) => (
        <div key={b.id} className="surface-card p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="mono-label text-[var(--color-text-secondary)]">{b.dept} · threshold {b.thresholdMinutes}m</div>
              <div className="text-sm">Ticket <span className="font-mono">{b.ticketId}</span></div>
              <div className="text-xs text-[var(--color-text-secondary)]">breached at {new Date(b.breachedAt).toLocaleString()}</div>
              {b.resolvedAt && (
                <div className="text-xs text-[var(--color-accent-green)]">resolved {new Date(b.resolvedAt).toLocaleString()}</div>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
