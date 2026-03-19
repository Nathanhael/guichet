import { useState } from 'react';
import { trpc } from '../../utils/trpc';
import { Skeleton } from './DashboardHelpers';
import { AlertTriangle, Flame, CheckCircle2, Eye, Bell, XCircle } from 'lucide-react';

export default function AdminAlerts() {
  const [filter, setFilter] = useState<'active' | 'acknowledged' | 'resolved' | undefined>('active');
  
  const { data: alerts, isLoading, refetch } = trpc.alerts.list.useQuery({ 
    status: filter,
    limit: 50 
  });

  const acknowledgeMutation = trpc.alerts.acknowledge.useMutation({
    onSuccess: () => refetch()
  });

  const resolveMutation = trpc.alerts.resolve.useMutation({
    onSuccess: () => refetch()
  });

  const getSeverityColor = (sev: string) => {
    switch (sev) {
      case 'high': return 'text-rose-500 bg-rose-500/10 border-rose-500/20';
      case 'medium': return 'text-amber-500 bg-amber-500/10 border-amber-500/20';
      case 'low': return 'text-blue-500 bg-blue-500/10 border-blue-500/20';
      default: return 'text-gray-500 bg-gray-500/10 border-gray-500/20';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-ui-base01 dark:text-white flex items-center gap-2">
            <Flame className="text-rose-500 animate-pulse" size={24} />
            Topic Heat Alerts
          </h2>
          <p className="text-xs text-ui-base1 dark:text-gray-400 mt-1">
            Intelligent incident detection based on real-time conversation clustering.
          </p>
        </div>

        <div className="flex bg-ui-base2 dark:bg-brand-900/50 p-1 rounded-xl border border-ui-base2 dark:border-brand-800">
          {(['active', 'acknowledged', 'resolved'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold capitalize transition-all ${
                filter === s
                  ? 'bg-brand-500 text-white shadow-md'
                  : 'text-ui-base1 dark:text-gray-400 hover:text-ui-base01 dark:hover:text-gray-200'
              }`}
            >
              {s}
            </button>
          ))}
          <button
            onClick={() => setFilter(undefined)}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
              filter === undefined
                ? 'bg-brand-500 text-white shadow-md'
                : 'text-ui-base1 dark:text-gray-400 hover:text-ui-base01 dark:hover:text-gray-200'
            }`}
          >
            All
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-32 w-full rounded-2xl" />
            ))}
          </div>
        ) : !alerts || alerts.length === 0 ? (
          <div className="glass-card p-12 text-center border-dashed border-2 border-ui-base2 dark:border-brand-800 bg-transparent">
            <div className="w-16 h-16 bg-emerald-500/10 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 size={32} />
            </div>
            <h3 className="text-lg font-bold text-ui-base01 dark:text-white">System Neutral</h3>
            <p className="text-sm text-ui-base1 dark:text-gray-400 mt-1 max-w-xs mx-auto">
              No {filter || ''} incidents detected. All departments are operating within normal parameters.
            </p>
          </div>
        ) : (
          <div className="grid gap-4">
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className={`glass-card p-5 border-l-4 transition-all hover:shadow-xl ${
                  alert.severity === 'high' ? 'border-l-rose-500' : 
                  alert.severity === 'medium' ? 'border-l-amber-500' : 'border-l-blue-500'
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2 flex-wrap">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest border ${getSeverityColor(alert.severity || 'medium')}`}>
                        {alert.severity} Heat
                      </span>
                      <span className="px-2 py-0.5 rounded bg-ui-base2 dark:bg-brand-900/50 text-ui-base1 dark:text-gray-400 text-[10px] font-black uppercase tracking-widest border border-ui-base2 dark:border-brand-800">
                        {alert.dept}
                      </span>
                      <span className="text-xs text-ui-base1 font-medium">
                        {new Date(alert.createdAt).toLocaleString('en-GB', { 
                          dateStyle: 'medium', 
                          timeStyle: 'short' 
                        })}
                      </span>
                    </div>
                    
                    <h3 className="text-lg font-black text-ui-base01 dark:text-white tracking-tight mb-1">
                      {alert.topic}
                    </h3>
                    <p className="text-sm text-ui-base01 dark:text-gray-300 leading-relaxed mb-4">
                      {alert.summary}
                    </p>

                    <div className="flex items-center gap-4 text-xs">
                      <div className="flex items-center gap-1.5 text-ui-base1 dark:text-gray-400">
                        <AlertTriangle size={14} />
                        <span className="font-bold">{alert.ticketCount} tickets</span> in 15 mins
                      </div>
                      {alert.status !== 'active' && (
                        <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 size={14} />
                          <span className="font-bold capitalize">{alert.status}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 shrink-0">
                    {alert.status === 'active' && (
                      <button
                        onClick={() => acknowledgeMutation.mutate(alert.id)}
                        disabled={acknowledgeMutation.isPending}
                        className="flex items-center justify-center gap-2 px-4 py-2 bg-brand-500 hover:bg-brand-600 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-brand-500/20 disabled:opacity-50"
                      >
                        <Eye size={14} />
                        Acknowledge
                      </button>
                    )}
                    {(alert.status === 'active' || alert.status === 'acknowledged') && (
                      <button
                        onClick={() => resolveMutation.mutate(alert.id)}
                        disabled={resolveMutation.isPending}
                        className="flex items-center justify-center gap-2 px-4 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 rounded-xl text-xs font-bold transition-all disabled:opacity-50"
                      >
                        <CheckCircle2 size={14} />
                        Resolve
                      </button>
                    )}
                    {alert.status === 'resolved' && (
                      <div className="text-right px-2">
                        <p className="text-[10px] font-black uppercase text-gray-500 tracking-widest">Resolved At</p>
                        <p className="text-xs font-bold text-ui-base1">
                          {alert.resolvedAt ? new Date(alert.resolvedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '-'}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
