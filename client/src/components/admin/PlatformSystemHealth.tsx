import { trpc } from '../../utils/trpc';

export default function PlatformSystemHealth() {
  const { data: health, isLoading } = trpc.platform.getSystemHealth.useQuery(undefined, {
    refetchInterval: 10000 // Refresh every 10s
  });

  if (isLoading || !health) return <div className="p-8 text-xs font-black uppercase tracking-widest opacity-50">Loading System Health...</div>;

  return (
    <div className="max-w-6xl space-y-8">
      <div>
        <h2 className="text-lg font-black uppercase tracking-widest mb-4">Services</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="border-2 border-black dark:border-white p-6">
            <div className="flex justify-between items-start mb-4">
              <h3 className="font-black uppercase tracking-widest">PostgreSQL</h3>
              <div className={`w-3 h-3 rounded-full ${health.postgres ? 'bg-black dark:bg-white' : 'bg-red-500'}`} />
            </div>
            <div className="flex justify-between items-end">
              <span className="text-[10px] uppercase font-black opacity-60">Active Connections</span>
              <span className="text-2xl font-mono">{health.postgresConnections}</span>
            </div>
          </div>
          
          <div className="border-2 border-black dark:border-white p-6">
            <div className="flex justify-between items-start mb-4">
              <h3 className="font-black uppercase tracking-widest">Redis</h3>
              <div className={`w-3 h-3 rounded-full ${health.redis ? 'bg-black dark:bg-white' : 'bg-red-500'}`} />
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
            <div className={`w-3 h-3 rounded-full ${health.gdprSuccess ? 'bg-black dark:bg-white' : 'bg-red-500'}`} />
            <div>
              <p className="font-black uppercase tracking-widest">Last Run</p>
              <p className="text-xs opacity-60 uppercase mt-1">{new Date(health.gdprLastRun).toLocaleString()}</p>
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-8">
            <div>
              <p className="text-[10px] uppercase font-black opacity-60 mb-2">Retention Period</p>
              <p className="font-mono text-lg">30 Days</p>
            </div>
            <div>
              <p className="text-[10px] uppercase font-black opacity-60 mb-2">Records Purged (Last Run)</p>
              <p className="font-mono text-lg">{health.gdprRecordsPurged}</p>
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