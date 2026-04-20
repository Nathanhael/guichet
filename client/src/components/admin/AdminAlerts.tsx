import { useState } from 'react';
import { Flame, Clock } from 'lucide-react';
import { trpc } from '../../utils/trpc';

type AlertFilter = 'active' | 'acknowledged' | 'resolved' | undefined;
type SlaStatus = 'active' | 'resolved';

const CARD = 'rounded-[var(--radius-card)] bg-[var(--color-bg-surface)] shadow-[var(--shadow-card)]';

function SegmentedTabs<T extends string | undefined>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex gap-1 p-1 rounded-[var(--radius-pill)] bg-[var(--color-bg-elevated)]">
      {options.map((opt) => (
        <button
          key={opt.label}
          onClick={() => onChange(opt.value)}
          className={`px-3 py-1 rounded-[var(--radius-pill)] text-[12px] font-medium transition-colors ${
            value === opt.value
              ? 'bg-[var(--color-bg-surface)] text-[var(--color-ink)] shadow-[var(--shadow-soft)]'
              : 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function severityBg(sev: string | null | undefined): string {
  const s = (sev || '').toLowerCase();
  if (s.includes('critical') || s.includes('high')) return 'bg-[var(--color-urgent-soft)] text-[var(--color-urgent)]';
  if (s.includes('warn') || s.includes('med')) return 'bg-[color-mix(in_srgb,var(--color-accent-amber)_14%,transparent)] text-[var(--color-accent-amber)]';
  return 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]';
}

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

  const visibleFilters = topTab === 'sla'
    ? ALL_FILTERS.filter((f) => f.value === 'active' || f.value === 'resolved')
    : ALL_FILTERS;

  const handleTopTab = (next: 'topic' | 'sla') => {
    setTopTab(next);
    if (next === 'sla' && filter !== 'active' && filter !== 'resolved') {
      setFilter('active');
    }
  };

  const slaStatus: SlaStatus = filter === 'resolved' ? 'resolved' : 'active';
  const isTopic = topTab === 'topic';

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-end justify-between gap-6 flex-wrap">
        <div>
          <h2 className="text-[22px] font-semibold tracking-[-0.2px] text-[var(--color-ink)]">
            {isTopic ? 'Topic Alerts' : 'SLA Breaches'}
          </h2>
          <p className="text-[13px] text-[var(--color-ink-muted)] mt-1">
            {isTopic
              ? 'Incident detection based on conversation clustering.'
              : 'First-response SLA tracking per department.'}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <SegmentedTabs
            options={[
              { value: 'topic', label: 'Topic' },
              { value: 'sla', label: 'SLA' },
            ]}
            value={topTab}
            onChange={(v) => handleTopTab(v)}
          />
          <SegmentedTabs
            options={visibleFilters}
            value={filter}
            onChange={(v) => setFilter(v)}
          />
        </div>
      </div>

      {isTopic ? (
        isLoading ? (
          <div className="py-8 text-center text-[13px] text-[var(--color-ink-muted)]">Loading alerts…</div>
        ) : !alerts?.length ? (
          <div className={`${CARD} p-12 text-center`}>
            <Flame className="h-10 w-10 mx-auto text-[var(--color-ink-muted)] opacity-50 mb-3" strokeWidth={1.5} />
            <p className="font-semibold text-[16px] text-[var(--color-ink)]">No {filter ?? ''} alerts</p>
            <p className="text-[13px] text-[var(--color-ink-muted)] mt-1">All departments are operating normally.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {alerts.map((alert) => (
              <div key={alert.id} className={`${CARD} p-5`}>
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-[var(--radius-pill)] ${severityBg(alert.severity)}`}>
                        {alert.severity} severity
                      </span>
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded-[var(--radius-pill)] bg-[var(--color-bg-elevated)] text-[var(--color-ink-soft)]">
                        {alert.dept}
                      </span>
                      <span className="text-[11px] text-[var(--color-ink-muted)] tabular-nums">
                        {new Date(alert.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <h3 className="text-[16px] font-semibold text-[var(--color-ink)] mb-1">{alert.topic}</h3>
                    <p className="text-[13px] text-[var(--color-ink-soft)] mb-3">{alert.summary}</p>
                    <p className="text-[12px] text-[var(--color-ink-muted)]">{alert.ticketCount} tickets</p>
                  </div>

                  <div className="flex flex-col gap-2 shrink-0 items-end">
                    {alert.status === 'active' && (
                      <button
                        onClick={() => acknowledgeMutation.mutate(alert.id)}
                        disabled={acknowledgeMutation.isPending}
                        className="h-8 px-3 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-hover)] text-[13px] font-medium text-[var(--color-ink)] disabled:opacity-30 transition-colors"
                      >
                        Acknowledge
                      </button>
                    )}
                    {(alert.status === 'active' || alert.status === 'acknowledged') && (
                      <button
                        onClick={() => resolveMutation.mutate(alert.id)}
                        disabled={resolveMutation.isPending}
                        className="h-8 px-3 rounded-[var(--radius-btn)] bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover,var(--color-accent))] text-[13px] font-medium text-white disabled:opacity-30 transition-colors shadow-[var(--shadow-soft)]"
                      >
                        Resolve
                      </button>
                    )}
                    {alert.status === 'resolved' && (
                      <div className="text-right">
                        <p className="text-[11px] uppercase tracking-[0.08em] font-semibold text-[var(--color-ok)]">Resolved</p>
                        <p className="text-[12px] text-[var(--color-ink-muted)] tabular-nums">{alert.resolvedAt ? new Date(alert.resolvedAt).toLocaleTimeString() : '—'}</p>
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
    return <div className="py-8 text-center text-[13px] text-[var(--color-ink-muted)]">Loading SLA breaches…</div>;
  }
  if (!data?.items.length) {
    return (
      <div className={`${CARD} p-12 text-center`}>
        <Clock className="h-10 w-10 mx-auto text-[var(--color-ink-muted)] opacity-50 mb-3" strokeWidth={1.5} />
        <p className="font-semibold text-[16px] text-[var(--color-ink)]">No {status} SLA breaches</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {data.items.map((b) => (
        <div key={b.id} className={`${CARD} p-5`}>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--color-ink-muted)]">{b.dept} · threshold {b.thresholdMinutes}m</div>
              <div className="text-[14px] mt-1 text-[var(--color-ink)]">Ticket <span className="font-mono">{b.ticketId}</span></div>
              <div className="text-[12px] text-[var(--color-ink-muted)] mt-0.5 tabular-nums">breached at {new Date(b.breachedAt).toLocaleString()}</div>
              {b.resolvedAt && (
                <div className="text-[12px] text-[var(--color-ok)] mt-0.5 tabular-nums">resolved {new Date(b.resolvedAt).toLocaleString()}</div>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
