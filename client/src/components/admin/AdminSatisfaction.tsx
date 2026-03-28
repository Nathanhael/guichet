import { useState } from 'react';
import { Panel, StatCard, Skeleton, Stars } from './DashboardHelpers';
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
  Cell,
} from 'recharts';
import { trpc } from '../../utils/trpc';
import useStore from '../../store/useStore';

interface AnalyticsData {
  trend: { date: string; avg: number; count: number }[];
  distribution: { rating: number; count: number }[];
  byDept: { dept: string; avg: number; count: number }[];
  byStaff: { supportId: string | null; name: string; avg: number; count: number }[];
  summary: { avg: number; total: number; withComment: number };
}

function applyPreset(
  key: string,
  setDateFrom: (v: string) => void,
  setDateTo: (v: string) => void,
  setActivePreset: (v: string) => void,
) {
  const now = new Date();
  const toStr = now.toISOString().slice(0, 10);
  let fromStr = toStr;
  if (key === '7d') {
    const d = new Date(now);
    d.setDate(d.getDate() - 6);
    fromStr = d.toISOString().slice(0, 10);
  } else if (key === '30d') {
    const d = new Date(now);
    d.setDate(d.getDate() - 29);
    fromStr = d.toISOString().slice(0, 10);
  } else if (key === '90d') {
    const d = new Date(now);
    d.setDate(d.getDate() - 89);
    fromStr = d.toISOString().slice(0, 10);
  }
  setDateFrom(fromStr);
  setDateTo(toStr);
  setActivePreset(key);
}

function barFill(rating: number): string {
  if (rating >= 4) return 'var(--color-text-primary)';
  if (rating === 3) return 'var(--color-text-secondary)';
  return 'var(--color-text-muted)';
}

export default function AdminSatisfaction() {
  const { memberships, activeMembershipId } = useStore();
  const activeMembership = (memberships || []).find(m => m.id === activeMembershipId);
  const departments: { id: string; name: string }[] = activeMembership?.manifest?.departments || [];

  const [dept, setDept] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [activePreset, setActivePreset] = useState<string | null>(null);

  const { data, isLoading } = trpc.rating.getAnalytics.useQuery(
    {
      dept: dept === 'all' ? undefined : dept,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    },
    { refetchInterval: 30000 },
  );

  const stats = data as AnalyticsData | undefined;

  const fullDist = stats
    ? [1, 2, 3, 4, 5].map(r => ({
        rating: r,
        label: `${r} Star${r > 1 ? 's' : ''}`,
        count: stats.distribution.find(d => d.rating === r)?.count || 0,
      }))
    : [];

  const commentRate =
    stats && stats.summary.total > 0
      ? Math.round((stats.summary.withComment / stats.summary.total) * 100)
      : 0;

  const presets = [
    { key: 'today', label: 'Today' },
    { key: '7d', label: '7D' },
    { key: '30d', label: '30D' },
    { key: '90d', label: '90D' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-mono text-[11px] uppercase tracking-widest text-[var(--color-text-muted)]">
          Satisfaction Analytics
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          {/* Department chips */}
          <button
            onClick={() => setDept('all')}
            className={`px-3 py-1 font-mono text-[9px] uppercase tracking-wide border ${
              dept === 'all'
                ? 'bg-[var(--color-text-primary)] text-[var(--color-bg-base)] border-[var(--color-border)]'
                : 'border-transparent text-[var(--color-text-muted)] hover:border-[var(--color-border)]'
            }`}
          >
            All Depts
          </button>
          {departments.map(d => (
            <button
              key={d.id}
              onClick={() => setDept(d.id)}
              className={`px-3 py-1 font-mono text-[9px] uppercase tracking-wide border ${
                dept === d.id
                  ? 'bg-[var(--color-text-primary)] text-[var(--color-bg-base)] border-[var(--color-border)]'
                  : 'border-transparent text-[var(--color-text-muted)] hover:border-[var(--color-border)]'
              }`}
            >
              {d.name}
            </button>
          ))}

          {/* Date presets */}
          <div className="flex items-center gap-1 ml-2">
            {presets.map(p => (
              <button
                key={p.key}
                onClick={() => applyPreset(p.key, setDateFrom, setDateTo, setActivePreset)}
                className={`px-3 py-1 font-mono text-[9px] uppercase tracking-wide border ${
                  activePreset === p.key
                    ? 'bg-[var(--color-text-primary)] text-[var(--color-bg-base)] border-[var(--color-border)]'
                    : 'border-transparent text-[var(--color-text-muted)] hover:border-[var(--color-border)]'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Custom date range */}
          <input
            type="date"
            value={dateFrom}
            onChange={e => { setDateFrom(e.target.value); setActivePreset(null); }}
            className="px-2 py-1 font-mono text-[9px] bg-[var(--color-bg-surface)] border border-[var(--color-border)] text-[var(--color-text-primary)]"
          />
          <span className="font-mono text-[9px] text-[var(--color-text-muted)]">–</span>
          <input
            type="date"
            value={dateTo}
            onChange={e => { setDateTo(e.target.value); setActivePreset(null); }}
            className="px-2 py-1 font-mono text-[9px] bg-[var(--color-bg-surface)] border border-[var(--color-border)] text-[var(--color-text-primary)]"
          />
        </div>
      </div>

      {/* Stat cards */}
      {isLoading ? (
        <div className="grid grid-cols-3 gap-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          <StatCard
            label="Average Rating"
            value={stats ? stats.summary.avg.toFixed(2) : '—'}
            color="dark"
          />
          <StatCard
            label="Total Ratings"
            value={stats ? stats.summary.total : '—'}
            color="dark"
          />
          <StatCard
            label="Comment Rate"
            value={stats ? `${commentRate}%` : '—'}
            color="dark"
          />
        </div>
      )}

      {/* Charts row */}
      <div className="grid grid-cols-2 gap-4">
        {/* Rating Trend */}
        <Panel title="Rating Trend">
          {isLoading ? (
            <Skeleton className="h-48" />
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={stats?.trend || []} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis
                  dataKey="date"
                  tick={{ fontFamily: 'monospace', fontSize: 9 }}
                  tickLine={false}
                />
                <YAxis
                  domain={[0, 5]}
                  ticks={[1, 2, 3, 4, 5]}
                  tick={{ fontFamily: 'monospace', fontSize: 9 }}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{
                    background: 'var(--color-bg-surface)',
                    border: '1px solid var(--color-border)',
                    fontFamily: 'monospace',
                    fontSize: 10,
                  }}
                />
                <Legend wrapperStyle={{ fontFamily: 'monospace', fontSize: 9 }} />
                <Line
                  type="monotone"
                  dataKey="avg"
                  name="Avg Rating"
                  stroke="var(--color-text-primary)"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Panel>

        {/* Rating Distribution */}
        <Panel title="Rating Distribution">
          {isLoading ? (
            <Skeleton className="h-48" />
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={fullDist} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis
                  dataKey="label"
                  tick={{ fontFamily: 'monospace', fontSize: 9 }}
                  tickLine={false}
                />
                <YAxis tick={{ fontFamily: 'monospace', fontSize: 9 }} tickLine={false} />
                <Tooltip
                  contentStyle={{
                    background: 'var(--color-bg-surface)',
                    border: '1px solid var(--color-border)',
                    fontFamily: 'monospace',
                    fontSize: 10,
                  }}
                />
                <Bar dataKey="count" name="Count">
                  {fullDist.map(entry => (
                    <Cell key={entry.rating} fill={barFill(entry.rating)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Panel>
      </div>

      {/* Department breakdown */}
      <Panel title="By Department">
        {isLoading ? (
          <Skeleton className="h-32" />
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <th className="text-left font-mono text-[9px] uppercase tracking-wide text-[var(--color-text-muted)] pb-3">Department</th>
                <th className="text-left font-mono text-[9px] uppercase tracking-wide text-[var(--color-text-muted)] pb-3">Avg</th>
                <th className="text-left font-mono text-[9px] uppercase tracking-wide text-[var(--color-text-muted)] pb-3">Stars</th>
                <th className="text-right font-mono text-[9px] uppercase tracking-wide text-[var(--color-text-muted)] pb-3">Total</th>
              </tr>
            </thead>
            <tbody>
              {(stats?.byDept || []).length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-[var(--color-text-muted)] font-mono text-[10px] py-4">No data</td>
                </tr>
              ) : (
                (stats?.byDept || []).map(row => (
                  <tr key={row.dept} className="border-b border-[var(--color-border)]">
                    <td className="py-2 text-sm font-bold">{row.dept || '—'}</td>
                    <td className="py-2 text-sm font-bold">{row.avg.toFixed(2)}</td>
                    <td className="py-2"><Stars value={Math.round(row.avg)} /></td>
                    <td className="py-2 text-right font-mono text-[10px] text-[var(--color-text-secondary)]">{row.count}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </Panel>

      {/* Staff leaderboard */}
      <Panel title="Staff Leaderboard">
        {isLoading ? (
          <Skeleton className="h-32" />
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <th className="text-left font-mono text-[9px] uppercase tracking-wide text-[var(--color-text-muted)] pb-3">Rank</th>
                <th className="text-left font-mono text-[9px] uppercase tracking-wide text-[var(--color-text-muted)] pb-3">Name</th>
                <th className="text-left font-mono text-[9px] uppercase tracking-wide text-[var(--color-text-muted)] pb-3">Avg</th>
                <th className="text-left font-mono text-[9px] uppercase tracking-wide text-[var(--color-text-muted)] pb-3">Stars</th>
                <th className="text-right font-mono text-[9px] uppercase tracking-wide text-[var(--color-text-muted)] pb-3">Total</th>
              </tr>
            </thead>
            <tbody>
              {(stats?.byStaff || []).length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-[var(--color-text-muted)] font-mono text-[10px] py-4">No data</td>
                </tr>
              ) : (
                (stats?.byStaff || [])
                  .slice()
                  .sort((a, b) => b.avg - a.avg)
                  .map((row, idx) => (
                    <tr key={row.supportId ?? row.name} className="border-b border-[var(--color-border)]">
                      <td className="py-2 font-mono text-[10px] text-[var(--color-text-muted)]">#{idx + 1}</td>
                      <td className="py-2 text-sm font-bold">{row.name}</td>
                      <td className="py-2 text-sm font-bold">{row.avg.toFixed(2)}</td>
                      <td className="py-2"><Stars value={Math.round(row.avg)} /></td>
                      <td className="py-2 text-right font-mono text-[10px] text-[var(--color-text-secondary)]">{row.count}</td>
                    </tr>
                  ))
              )}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
