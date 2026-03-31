import { useState } from 'react';
import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';

export default function PlatformSystemHealth() {
  const t = useT();
  const { data: health, isLoading, isError, error, refetch } = trpc.platform.getSystemHealth.useQuery(undefined, {
    refetchInterval: 10000,
    retry: 1
  });
  const [dismissedAlerts, setDismissedAlerts] = useState<string[]>([]);

  const alerts: { id: string; message: string }[] = [];
  if (health) {
    if (!health.redis) alerts.push({ id: 'redis-down', message: t('redis_unreachable') });
    if (!health.postgres) alerts.push({ id: 'pg-down', message: t('postgres_unreachable') });
    if (!health.gdprSuccess) alerts.push({ id: 'gdpr-failed', message: t('gdpr_purge_failed') });
    const lastRun = new Date(health.gdprLastRun).getTime();
    if (Date.now() - lastRun > 25 * 60 * 60 * 1000) alerts.push({ id: 'gdpr-overdue', message: t('gdpr_purge_overdue') });
  }
  const visibleAlerts = alerts.filter(a => !dismissedAlerts.includes(a.id));

  if (isLoading) return <div className="p-8 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] animate-pulse">{t('loading_system_health')}</div>;

  if (isError || !health) return (
    <div className="p-8 border border-[var(--color-accent-red)] bg-[var(--color-bg-elevated)]">
      <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-[var(--color-accent-red)] mb-2">
        Failed to load system health data.
      </p>
      {error && (
        <p className="font-mono text-[9px] text-[var(--color-text-muted)] mb-4 uppercase">
          Error: {error.message}
        </p>
      )}
      <button onClick={() => refetch()} className="btn-primary text-[10px] uppercase tracking-widest px-4 py-2">
        Retry Connection
      </button>
    </div>
  );

  return (
    <div className="max-w-6xl space-y-8">
      {visibleAlerts.length > 0 && (
        <div>
          <h2 className="text-lg font-bold uppercase tracking-wide mb-4">{t('alerts')}</h2>
          <div className="space-y-2">
            {visibleAlerts.map(alert => (
              <div key={alert.id} className="surface-card p-4 flex justify-between items-center">
                <span className="text-xs font-bold uppercase tracking-wide">{alert.message}</span>
                <button
                  onClick={() => setDismissedAlerts(d => [...d, alert.id])}
                  className="btn-secondary ml-4"
                >
                  {t('dismiss')}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h2 className="text-lg font-bold uppercase tracking-wide mb-4">{t('services')}</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="surface-card p-6">
            <div className="flex justify-between items-start mb-4">
              <h3 className="font-bold uppercase tracking-wide">PostgreSQL</h3>
              <div className={`w-3 h-3 border border-[var(--color-border)] ${health.postgres ? 'bg-[var(--color-text-primary)]' : ''}`} />
            </div>
            <div className="flex justify-between items-end">
              <span className="mono-label">{t('active_connections')}</span>
              <span className="text-2xl font-mono">{health.postgresConnections}</span>
            </div>
          </div>

          <div className="surface-card p-6">
            <div className="flex justify-between items-start mb-4">
              <h3 className="font-bold uppercase tracking-wide">Redis</h3>
              <div className={`w-3 h-3 border border-[var(--color-border)] ${health.redis ? 'bg-[var(--color-text-primary)]' : ''}`} />
            </div>
            <div className="flex justify-between items-end">
              <span className="mono-label">{t('memory_used')}</span>
              <span className="text-2xl font-mono">{health.redisMemoryUsed}</span>
            </div>
          </div>
        </div>
      </div>

      <div>
        <h2 className="text-lg font-bold uppercase tracking-wide mb-4">{t('gdpr_purge_service')}</h2>
        <div className="surface-card p-6">
          <div className="flex items-center gap-4 mb-6 pb-6 border-b border-[var(--color-border)]">
            <div className={`w-3 h-3 border border-[var(--color-border)] ${health.gdprSuccess ? 'bg-[var(--color-text-primary)]' : ''}`} />
            <div>
              <p className="font-bold uppercase tracking-wide">{t('last_run')}</p>
              <p className="text-xs text-[var(--color-text-secondary)] uppercase mt-1">{new Date(health.gdprLastRun).toLocaleString()}</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-8">
            <div>
              <p className="mono-label mb-2">{t('retention_period')}</p>
              <p className="font-mono text-lg">30 Days</p>
            </div>
            <div>
              <p className="mono-label mb-2">{t('records_purged')}</p>
              <p className="font-mono text-lg">{health.gdprRecordsPurged}</p>
            </div>
            <div>
              <p className="mono-label mb-2">{t('next_purge')}</p>
              <p className="font-mono text-sm">{new Date(health.gdprNextPurge).toLocaleString()}</p>
            </div>
          </div>
        </div>
      </div>

      <div>
        <h2 className="text-lg font-bold uppercase tracking-wide mb-4">{t('observability')}</h2>
        <div className="flex gap-4">
          <a
            href={`http://${window.location.hostname}:3000`}
            target="_blank"
            rel="noreferrer"
            className="btn-secondary"
          >
            Grafana Dashboards
          </a>
          <a
            href={`http://${window.location.hostname}:9090`}
            target="_blank"
            rel="noreferrer"
            className="btn-secondary"
          >
            Prometheus Metrics
          </a>
        </div>
      </div>
    </div>
  );
}
