import { useState } from 'react';
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
import { trpc } from '../../utils/trpc';
import useStore from '../../store/useStore';

export default function AdminStats() {
  const { memberships, activeMembershipId } = useStore();
  const activeMembership = (memberships || []).find(m => m.id === activeMembershipId);
  const departments: { id: string; name: string }[] = activeMembership?.manifest?.departments || [];

  const [statsDept, setStatsDept] = useState('all');
  const [statsDateFrom, setStatsDateFrom] = useState('');
  const [statsDateTo, setStatsDateTo] = useState('');
  const [activePreset, setActivePreset] = useState<string | null>(null);

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

  const { data: stats, isLoading } = trpc.stats.getGlobalStats.useQuery(
    {
      dept: statsDept === 'all' ? undefined : statsDept,
      dateFrom: statsDateFrom || undefined,
      dateTo: statsDateTo || undefined,
    },
    { refetchInterval: 30000 }
  );

  if (isLoading || !stats) {
    return (
      <div className="space-y-6 min-w-[1280px] max-w-7xl mx-auto p-4">
        <div className="flex justify-between items-center mb-8">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-12 w-96" />
        </div>
        <div className="grid grid-cols-6 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
        <div className="grid grid-cols-2 gap-4">
          <Skeleton className="h-80" />
          <Skeleton className="h-80" />
        </div>
      </div>
    );
  }

  const deptCounts: Record<string, number> = (stats as any).deptCounts || {};
  const totalTickets = stats.total || 1;

  return (
    <div className="space-y-6 min-w-[1280px] max-w-7xl mx-auto pb-10">
      <div className="flex items-center justify-between gap-6">
        <div>
          <h2 className="text-2xl font-black uppercase tracking-tight text-black dark:text-white">Dashboard</h2>
          <p className="text-sm opacity-60 mt-1">Real-time performance metrics and historical trends</p>
        </div>

        <div className="flex items-center gap-2 border-2 border-black dark:border-white p-2 bg-white dark:bg-black overflow-x-auto">
          {/* Department filter */}
          <div className="flex gap-1">
            {(['all', ...departments.map(d => d.id)] as string[]).map((d) => (
              <button
                key={d}
                onClick={() => setStatsDept(d)}
                className={`px-3 py-1.5 text-xs font-black uppercase border-2 ${
                  statsDept === d
                    ? 'border-black dark:border-white bg-black dark:bg-white text-white dark:text-black'
                    : 'border-transparent text-black dark:text-white opacity-50 hover:opacity-100'
                }`}
              >
                {d === 'all' ? 'All' : (departments.find(dep => dep.id === d)?.name || d)}
              </button>
            ))}
          </div>

          <div className="w-px h-6 bg-black dark:bg-white opacity-20 mx-1" />

          {/* Date presets */}
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
                className={`px-2.5 py-1.5 text-xs font-black uppercase border-2 ${
                  activePreset === key
                    ? 'border-black dark:border-white bg-black dark:bg-white text-white dark:text-black'
                    : 'border-transparent text-black dark:text-white opacity-50 hover:opacity-100'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="w-px h-6 bg-black dark:bg-white opacity-20 mx-1" />

          {/* Date range */}
          <div className="flex items-center gap-2">
            <input
              type="date"
              aria-label="Start date"
              value={statsDateFrom}
              onChange={(e) => { setStatsDateFrom(e.target.value); setActivePreset(null); }}
              className="border-2 border-black dark:border-white bg-transparent px-3 py-1.5 text-xs font-bold text-black dark:text-white outline-none"
            />
            <span className="text-xs opacity-50">→</span>
            <input
              type="date"
              aria-label="End date"
              value={statsDateTo}
              onChange={(e) => { setStatsDateTo(e.target.value); setActivePreset(null); }}
              className="border-2 border-black dark:border-white bg-transparent px-3 py-1.5 text-xs font-bold text-black dark:text-white outline-none"
            />
            {(statsDept !== 'all' || statsDateFrom || statsDateTo) && (
              <button
                onClick={() => { setStatsDept('all'); setStatsDateFrom(''); setStatsDateTo(''); setActivePreset(null); }}
                className="p-1.5 border-2 border-black dark:border-white text-black dark:text-white opacity-50 hover:opacity-100"
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

      {/* Stat cards */}
      <div className="grid grid-cols-6 gap-4">
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
        <StatCard label="Satisfaction" value={(stats.avgRating ?? 0) > 0 ? `${stats.avgRating}` : '—'} color="yellow" prev={stats.previousPeriod?.avgRating ?? undefined} />
        <StatCard label="Abandoned" value={stats.abandonedCount} color="red" prev={stats.previousPeriod?.abandonedCount} invertTrend />
        <StatCard
          label="SLA Health"
          value={`${stats.slaHealth}%`}
          color={stats.slaHealth >= 90 ? 'teal' : stats.slaHealth >= 70 ? 'yellow' : 'red'}
          prev={stats.previousPeriod?.slaHealth != null ? `${stats.previousPeriod.slaHealth}%` : undefined}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Queue health */}
        <Panel title="Queue health">
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div className={`border-2 p-3 ${stats.oldestWaitMinutes > 3 ? 'border-black dark:border-white' : 'border-black/20 dark:border-white/20'}`}>
              <p className="text-xs uppercase font-bold opacity-60">Oldest waiting</p>
              <p className={`text-2xl font-black mt-0.5 ${stats.oldestWaitMinutes > 3 ? 'text-black dark:text-white' : 'opacity-40'}`}>
                {stats.oldestWaitMinutes > 0 ? `${stats.oldestWaitMinutes}m` : '—'}
              </p>
            </div>
            <div className={`border-2 p-3 ${stats.waitingOver3 > 0 ? 'border-black dark:border-white' : 'border-black/20 dark:border-white/20'}`}>
              <p className="text-xs uppercase font-bold opacity-60">Waiting &gt;3 min</p>
              <p className={`text-2xl font-black mt-0.5 ${stats.waitingOver3 > 0 ? 'text-black dark:text-white' : 'opacity-40'}`}>
                {stats.waitingOver3}
              </p>
            </div>
          </div>

          {/* Department distribution */}
          {departments.length > 0 && (
            <div className="mt-4 pt-4 border-t-2 border-black/10 dark:border-white/10">
              <p className="text-[10px] uppercase font-black opacity-60 mb-3 tracking-widest">Dept distribution</p>
              <div className="space-y-2">
                {departments.map((dept) => {
                  const count = deptCounts[dept.id] || 0;
                  const pct = Math.round((count / totalTickets) * 100);
                  return (
                    <div key={dept.id}>
                      <div className="flex justify-between mb-1">
                        <span className="text-[10px] font-black uppercase">{dept.name}</span>
                        <span className="text-[10px] font-bold opacity-60">{count} ({pct}%)</span>
                      </div>
                      <div className="h-1.5 w-full bg-black/10 dark:bg-white/10">
                        <div className="h-full bg-black dark:bg-white" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Panel>

        <Panel title="Online now">
          <div className="py-4 text-center">
            <p className="text-sm opacity-60">Live presence monitoring active</p>
          </div>
        </Panel>
      </div>

      {/* Trend chart */}
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
            <Line type="monotone" dataKey="total" stroke="#000000" strokeWidth={2} dot={false} name="Total" />
          </LineChart>
        </ResponsiveContainer>
      </Panel>

      {/* Support & Agent performance */}
      <div className="grid grid-cols-2 gap-4">
        <Panel title="Support performance">
          {stats.supportStats.length === 0 ? (
            <p className="text-sm opacity-60">No data yet</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(160, stats.supportStats.length * 40)}>
              <BarChart data={stats.supportStats} layout="vertical" margin={{ top: 0, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#93a1a1" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={90} />
                <Tooltip />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="total" fill="#000000" name="Total Tasks" />
                <Bar dataKey="today" fill="#666666" name="Today" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Panel>

        <Panel title="Agent performance">
          {stats.agentStats.length === 0 ? (
            <p className="text-sm opacity-60">No data yet</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(160, stats.agentStats.length * 40)}>
              <BarChart data={stats.agentStats} layout="vertical" margin={{ top: 0, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#93a1a1" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={90} />
                <Tooltip />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="total" fill="#000000" name="Total Tickets" />
                <Bar dataKey="today" fill="#666666" name="Today" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Panel>
      </div>

      {/* Team Satisfaction */}
      <TeamSatisfaction dateFrom={statsDateFrom} dateTo={statsDateTo} />
    </div>
  );
}

function StarRating({ value }: { value: number }) {
  const stars = [];
  for (let i = 1; i <= 5; i++) {
    const filled = i <= Math.round(value);
    stars.push(
      <svg
        key={i}
        xmlns="http://www.w3.org/2000/svg"
        className={`h-4 w-4 inline-block ${filled ? 'text-black dark:text-white' : 'text-black/20 dark:text-white/20'}`}
        viewBox="0 0 24 24"
        fill="currentColor"
      >
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
      </svg>
    );
  }
  return <span className="inline-flex gap-0.5">{stars}</span>;
}

function TeamSatisfaction({ dateFrom, dateTo }: { dateFrom: string; dateTo: string }) {
  const { data: staffRatings, isLoading } = trpc.rating.getStaffRatings.useQuery(
    {
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    },
    { refetchInterval: 30000 }
  );

  return (
    <Panel title="Team Satisfaction">
      {isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : !staffRatings || staffRatings.length === 0 ? (
        <p className="text-sm opacity-60">No ratings yet</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b-2 border-black dark:border-white">
                <th className="text-[10px] font-black uppercase tracking-widest py-2 pr-4">Support Staff</th>
                <th className="text-[10px] font-black uppercase tracking-widest py-2 pr-4">Avg Rating</th>
                <th className="text-[10px] font-black uppercase tracking-widest py-2 pr-4">Stars</th>
                <th className="text-[10px] font-black uppercase tracking-widest py-2 text-right">Total Ratings</th>
              </tr>
            </thead>
            <tbody>
              {staffRatings.map((staff) => {
                const avg = Number(staff.avgRating) || 0;
                const colorClass =
                  avg >= 4 ? 'text-green-700 dark:text-green-400' :
                  avg >= 3 ? 'text-yellow-700 dark:text-yellow-400' :
                  'text-red-700 dark:text-red-400';
                return (
                  <tr key={staff.supportId} className="border-b border-black/10 dark:border-white/10">
                    <td className="py-2 pr-4 text-sm font-bold">{staff.supportName}</td>
                    <td className={`py-2 pr-4 text-sm font-black tabular-nums ${colorClass}`}>{avg.toFixed(1)}</td>
                    <td className="py-2 pr-4"><StarRating value={avg} /></td>
                    <td className="py-2 text-sm font-bold opacity-60 text-right">{staff.totalRatings}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
