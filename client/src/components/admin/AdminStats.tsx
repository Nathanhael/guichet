import { useState, useEffect } from 'react';
import { useT } from '../../i18n';
import useStore from '../../store/useStore';
import { OnlineExpert } from '../../types';
import { Panel, StatCard, Skeleton } from './DashboardHelpers';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import LLMSummary from './Stats/LLMSummary';
import TopicSummary from './Stats/TopicSummary';
import StaffingDemand from './Stats/StaffingDemand';
import { trpc } from '../../utils/trpc';

export default function AdminStats() {
  const t = useT();
  const { onlineExperts } = useStore();
  const [statsDept, setStatsDept] = useState('all');
  const [statsDateFrom, setStatsDateFrom] = useState('');
  const [statsDateTo, setStatsDateTo] = useState('');
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [activeHour, setActiveHour] = useState<number | null>(null);

  function applyPreset(key: string) {
    const now = new Date();
    const toStr = now.toISOString().slice(0, 10);
    let fromStr = toStr;
    if (key === '7d') {
      const d = new Date(now);
      d.setDate(d.getDate() - 6);
      fromStr = d.toISOString().slice(0, 10);
    } else if (key === '14d') {
      const d = new Date(now);
      d.setDate(d.getDate() - 13);
      fromStr = d.toISOString().slice(0, 10);
    } else if (key === '30d') {
      const d = new Date(now);
      d.setDate(d.getDate() - 29);
      fromStr = d.toISOString().slice(0, 10);
    }
    setStatsDateFrom(fromStr);
    setStatsDateTo(toStr);
    setActivePreset(key);
  }

  // tRPC: Global Stats
  const { data: stats, isLoading, refetch } = trpc.stats.getGlobalStats.useQuery(
    {
      dept: statsDept === 'all' ? undefined : statsDept,
      dateFrom: statsDateFrom || undefined,
      dateTo: statsDateTo || undefined,
    },
    {
      refetchInterval: 30000,
    }
  );

  if (isLoading || !stats) {
    return (
      <div className="space-y-6 max-w-7xl mx-auto p-4 animate-fade-in">
        <div className="flex justify-between items-center mb-8">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-12 w-96 rounded-2xl" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-2xl w-full" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Skeleton className="h-80 rounded-2xl" />
          <Skeleton className="h-80 rounded-2xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-slide-up pb-10">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-solarized-base01 dark:text-white tracking-tight">{t('dashboard')}</h2>
          <p className="text-sm text-solarized-base1 dark:text-gray-400 mt-1">Real-time performance metrics and historical trends</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 bg-solarized-base3/50 dark:bg-brand-800/50 p-2 rounded-2xl border border-solarized-base2 dark:border-brand-700/50 backdrop-blur-sm self-start">
          <div className="flex gap-1">
            {['all', 'DSC', 'FOT'].map((d) => (
              <button
                key={d}
                onClick={() => setStatsDept(d)}
                className={`px-3 py-1.5 text-xs font-bold rounded-xl transition-all duration-300 ${
                  statsDept === d ? 'bg-brand-500 text-white shadow-md shadow-brand-500/20' : 'text-solarized-base01 dark:text-gray-400 hover:bg-solarized-base2 dark:hover:bg-brand-700'
                }`}
              >
                {d === 'all' ? 'All' : d}
              </button>
            ))}
          </div>
          <div className="w-px h-6 bg-slate-200 dark:bg-brand-700 mx-1 invisible md:visible" />
          <div className="flex gap-1">
            {[
              { key: 'today', label: 'Today' },
              { key: '7d', label: '7D' },
              { key: '14d', label: '14D' },
              { key: '30d', label: '30D' },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => applyPreset(key)}
                className={`px-2.5 py-1.5 text-xs font-bold rounded-xl transition-all duration-300 ${
                  activePreset === key ? 'bg-accent-500 text-white shadow-md shadow-accent-500/20' : 'text-solarized-base01 dark:text-gray-400 hover:bg-solarized-base2 dark:hover:bg-brand-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="w-px h-6 bg-slate-200 dark:bg-brand-700 mx-1 invisible md:visible" />
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={statsDateFrom}
              onChange={(e) => {
                setStatsDateFrom(e.target.value);
                setActivePreset(null);
              }}
              className="border-none bg-solarized-base3/80 dark:bg-gray-700/80 rounded-xl px-3 py-1.5 text-xs font-semibold text-solarized-base01 dark:text-gray-200 focus:ring-2 focus:ring-brand-500 outline-none"
            />
            <span className="text-solarized-base1 text-xs">→</span>
            <input
              type="date"
              value={statsDateTo}
              onChange={(e) => {
                setStatsDateTo(e.target.value);
                setActivePreset(null);
              }}
              className="border-none bg-solarized-base3/80 dark:bg-gray-700/80 rounded-xl px-3 py-1.5 text-xs font-semibold text-solarized-base01 dark:text-gray-200 focus:ring-2 focus:ring-brand-500 outline-none"
            />
            {(statsDept !== 'all' || statsDateFrom || statsDateTo) && (
              <button
                onClick={() => {
                  setStatsDept('all');
                  setStatsDateFrom('');
                  setStatsDateTo('');
                  setActivePreset(null);
                }}
                className="p-1.5 text-slate-400 hover:text-brand-500 hover:bg-brand-50 dark:hover:bg-brand-900/40 rounded-lg transition-colors"
                title="Clear all filters"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard label="Total Tickets" value={stats.total} color="dark" prev={stats.previousPeriod?.total} />
        <StatCard
          label="Response Time"
          value={stats.avgResponseMinutes > 0 ? `${stats.avgResponseMinutes}m` : '—'}
          color="gray"
          prev={stats.previousPeriod?.avgResponseMinutes && stats.previousPeriod.avgResponseMinutes > 0 ? `${stats.previousPeriod.avgResponseMinutes}m` : undefined}
          invertTrend
        />
        <StatCard
          label="p95 Response"
          value={stats.p95ResponseMinutes != null ? `${stats.p95ResponseMinutes}m` : '—'}
          color="red"
          invertTrend
        />
        <StatCard label="Satisfaction" value={stats.avgRating > 0 ? `${stats.avgRating}` : '—'} color="yellow" prev={stats.previousPeriod?.avgRating} />
        <StatCard label="Abandoned" value={stats.abandonedCount} color="red" prev={stats.previousPeriod?.abandonedCount} invertTrend />
        <StatCard
          label="SLA Health"
          value={`${stats.slaHealth}%`}
          color={stats.slaHealth >= 90 ? 'teal' : stats.slaHealth >= 70 ? 'yellow' : 'red'}
          prev={stats.previousPeriod?.slaHealth != null ? `${stats.previousPeriod.slaHealth}%` : undefined}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title="Queue health">
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div
              className={`rounded-lg p-3 ${
                stats.oldestWaitMinutes > 3 ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800' : 'bg-solarized-base2 dark:bg-gray-700'
              }`}
            >
              <p className="text-xs text-solarized-base1 dark:text-gray-400">Oldest waiting</p>
              <p
                className={`text-2xl font-bold mt-0.5 ${
                  stats.oldestWaitMinutes > 3 ? 'text-red-600 dark:text-red-400' : 'text-solarized-base01 dark:text-white'
                }`}
              >
                {stats.oldestWaitMinutes > 0 ? `${stats.oldestWaitMinutes}m` : '—'}
              </p>
            </div>
            <div
              className={`rounded-lg p-3 ${
                stats.waitingOver3 > 0 ? 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800' : 'bg-solarized-base2 dark:bg-gray-700'
              }`}
            >
              <p className="text-xs text-solarized-base1 dark:text-gray-400">Waiting &gt;3 min</p>
              <p
                className={`text-2xl font-bold mt-0.5 ${
                  stats.waitingOver3 > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-solarized-base01 dark:text-white'
                }`}
              >
                {stats.waitingOver3}
              </p>
            </div>
          </div>

            <div className="mt-4 pt-4 border-t border-solarized-base2 dark:border-gray-700">
            <p className="text-[10px] uppercase font-bold text-solarized-base1 mb-2 tracking-wider">DSC vs FOT Distribution</p>
            <div className="h-2 w-full bg-indigo-500 rounded-full overflow-hidden flex">
              <div
                className="h-full bg-amber-500 transition-all duration-500"
                style={{ width: `${Math.round((stats.dscCount / (stats.total || 1)) * 100)}%` }}
              />
            </div>
            <div className="flex justify-between mt-1.5">
              <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400">● DSC {Math.round((stats.dscCount / (stats.total || 1)) * 100)}%</span>
              <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400">● FOT {Math.round((stats.fotCount / (stats.total || 1)) * 100)}%</span>
            </div>
          </div>
        </Panel>

        <Panel title={`Online now (${onlineExperts.length})`}>
          {onlineExperts.length === 0 ? (
            <p className="text-sm text-solarized-base1">No experts online</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {onlineExperts.map((e: any) => (
                <div
                  key={e.userId}
                  title={`${e.name} · ${e.status || 'available'}`}
                  className="relative group flex items-center gap-2 bg-solarized-base2 dark:bg-gray-700 border border-solarized-base2 dark:border-brand-600 rounded-full pl-1.5 pr-4 py-1.5 cursor-default"
                >
                  <div className="w-6 h-6 rounded-full bg-solarized-base3/50 dark:bg-brand-900/50 flex items-center justify-center text-xs font-bold text-brand-600 dark:text-brand-400 shrink-0">
                    {e.name
                      .split(' ')
                      .map((w: string) => w[0])
                      .join('')
                      .slice(0, 2)
                      .toUpperCase()}
                  </div>
                  <span className="text-sm font-medium text-solarized-base01 dark:text-gray-200 leading-none truncate max-w-[120px]">{e.name}</span>
                  <span
                    className={`absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full ring-2 ring-white dark:ring-gray-800 ${
                      e.status === 'break' ? 'bg-yellow-400' : e.status === 'lunch' ? 'bg-orange-400' : e.status === 'meeting' ? 'bg-gray-400' : 'bg-green-400'
                    }`}
                  />
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <Panel
        title={`Tickets Trend (${
          stats.trendGranularity === 'weekly' ? `${stats.dailyTrend.length} weeks` : stats.trendGranularity === 'monthly' ? `${stats.dailyTrend.length} months` : `${stats.dailyTrend.length} days`
        })`}
      >
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={stats.dailyTrend} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#93a1a1" />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={Math.ceil(stats.dailyTrend.length / 10)} />
            <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
            <Tooltip />
            <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="total" stroke="#e24e1b" strokeWidth={2} dot={false} name="Total" />
            <Line type="monotone" dataKey="dsc" stroke="#f59e0b" strokeWidth={1.5} dot={false} name="DSC" />
            <Line type="monotone" dataKey="fot" stroke="#6366f1" strokeWidth={1.5} dot={false} name="FOT" />
          </LineChart>
        </ResponsiveContainer>
      </Panel>

      {stats.hourlyStaffing && (
        <StaffingDemand 
          hourlyStaffing={stats.hourlyStaffing} 
          activeHour={activeHour} 
          onHourClick={setActiveHour} 
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title="Expert performance">
          {stats.expertStats.length === 0 ? (
            <p className="text-sm text-solarized-base1">No data yet</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(160, stats.expertStats.length * 40)}>
              <BarChart data={stats.expertStats} layout="vertical" margin={{ top: 0, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#93a1a1" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={90} />
                <Tooltip />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="total" fill="#6366f1" radius={[0, 3, 3, 0]} name="Total Tasks" />
                <Bar dataKey="today" fill="#a5b4fc" radius={[0, 3, 3, 0]} name="Today" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Panel>

        <Panel title="Agent performance">
          {stats.agentStats.length === 0 ? (
            <p className="text-sm text-solarized-base1">No data yet</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(160, stats.agentStats.length * 40)}>
              <BarChart data={stats.agentStats} layout="vertical" margin={{ top: 0, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#93a1a1" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={90} />
                <Tooltip />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="total" fill="#f59e0b" radius={[0, 3, 3, 0]} name="Total Tickets" />
                <Bar dataKey="today" fill="#fcd34d" radius={[0, 3, 3, 0]} name="Today" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Panel>
      </div>
    </div>
  );
}
