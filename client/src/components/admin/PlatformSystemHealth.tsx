import { useState } from 'react';
import { trpc } from '../../utils/trpc';

export default function PlatformSystemHealth() {
  const { data: health, isLoading } = trpc.platform.getSystemHealth.useQuery(undefined, {
    refetchInterval: 10000
  });
  const [dismissedAlerts, setDismissedAlerts] = useState<string[]>([]);

  const alerts: { id: string; message: string }[] = [];
  if (health) {
    if (!health.redis) alerts.push({ id: 'redis-down', message: 'Redis is unreachable' });
    if (!health.postgres) alerts.push({ id: 'pg-down', message: 'PostgreSQL is unreachable' });
    if (!health.gdprSuccess) alerts.push({ id: 'gdpr-failed', message: 'GDPR purge failed — check server logs' });
    const lastRun = new Date(health.gdprLastRun).getTime();
    if (Date.now() - lastRun > 25 * 60 * 60 * 1000) alerts.push({ id: 'gdpr-overdue', message: 'GDPR purge overdue (last run >25h ago)' });
  }
  const visibleAlerts = alerts.filter(a => !dismissedAlerts.includes(a.id));

  if (isLoading || !health) return <div className="p-8 text-xs font-black uppercase tracking-widest opacity-50">Loading System Health...</div>;

  return (
    <div className="max-w-6xl space-y-8">
      {visibleAlerts.length > 0 && (
        <div>
          <h2 className="text-lg font-black uppercase tracking-widest mb-4">Alerts</h2>
          <div className="space-y-2">
            {visibleAlerts.map(alert => (
              <div key={alert.id} className="border-2 border-black dark:border-white p-4 flex justify-between items-center">
                <span className="text-xs font-black uppercase tracking-widest">{alert.message}</span>
                <button
                  onClick={() => setDismissedAlerts(d => [...d, alert.id])}
                  className="text-[10px] font-black uppercase tracking-widest border border-black dark:border-white px-3 py-1 ml-4"
                >
                  Dismiss
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h2 className="text-lg font-black uppercase tracking-widest mb-4">Services</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="border-2 border-black dark:border-white p-6">
            <div className="flex justify-between items-start mb-4">
              <h3 className="font-black uppercase tracking-widest">PostgreSQL</h3>
              <div className={`w-3 h-3 border-2 border-black dark:border-white ${health.postgres ? 'bg-black dark:bg-white' : ''}`} />
            </div>
            <div className="flex justify-between items-end">
              <span className="text-[10px] uppercase font-black opacity-60">Active Connections</span>
              <span className="text-2xl font-mono">{health.postgresConnections}</span>
            </div>
          </div>
          
          <div className="border-2 border-black dark:border-white p-6">
            <div className="flex justify-between items-start mb-4">
              <h3 className="font-black uppercase tracking-widest">Redis</h3>
              <div className={`w-3 h-3 border-2 border-black dark:border-white ${health.redis ? 'bg-black dark:bg-white' : ''}`} />
            </div>
            <div className="flex justify-between items-end">
              <span className="text-[10px] uppercase font-black opacity-60">Memory Used</span>
              <span className="text-2xl font-mono">{health.redisMemoryUsed}</span>
            </div>
          </div>
        </div>
      </div>

      <div>
        <h2 className="text-lg font-black uppercase tracking-widest mb-4">GDPR Purge Service</h2>
        <div className="border-2 border-black dark:border-white p-6">
          <div className="flex items-center gap-4 mb-6 pb-6 border-b border-black/20 dark:border-white/20">
            <div className={`w-3 h-3 border-2 border-black dark:border-white ${health.gdprSuccess ? 'bg-black dark:bg-white' : ''}`} />
            <div>
              <p className="font-black uppercase tracking-widest">Last Run</p>
              <p className="text-xs opacity-60 uppercase mt-1">{new Date(health.gdprLastRun).toLocaleString()}</p>
            </div>
          </div>
          
          <div className="grid grid-cols-3 gap-8">
            <div>
              <p className="text-[10px] uppercase font-black opacity-60 mb-2">Retention Period</p>
              <p className="font-mono text-lg">30 Days</p>
            </div>
            <div>
              <p className="text-[10px] uppercase font-black opacity-60 mb-2">Records Purged (Last Run)</p>
              <p className="font-mono text-lg">{health.gdprRecordsPurged}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase font-black opacity-60 mb-2">Next Purge</p>
              <p className="font-mono text-sm">{new Date(health.gdprNextPurge).toLocaleString()}</p>
            </div>
          </div>
        </div>
      </div>
      
      <div>
        <h2 className="text-lg font-black uppercase tracking-widest mb-4">Observability</h2>
        <div className="flex gap-4">
          <a href="/grafana" target="_blank" rel="noreferrer" className="px-6 py-3 border-2 border-black dark:border-white font-black uppercase tracking-widest text-[10px] hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black transition-all">
            Grafana Dashboards ↗
          </a>
          <a href="/prometheus" target="_blank" rel="noreferrer" className="px-6 py-3 border-2 border-black dark:border-white font-black uppercase tracking-widest text-[10px] hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black transition-all">
            Prometheus Metrics ↗
          </a>
        </div>
      </div>
    </div>
  );
}