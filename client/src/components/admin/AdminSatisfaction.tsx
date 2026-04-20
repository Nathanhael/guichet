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
import { useStoreShallow } from '../../store/useStore';

interface AnalyticsData {
  trend: { date: string; avg: number; count: number }[];
  distribution: { rating: number; count: number }[];
  byDept: { dept: string; avg: number; count: number }[];
  byStaff: { supportId: string | null; name: string; avg: number; count: number }[];
  summary: { avg: number; total: number; withComment: number };
}

const CHART_TICK = { fontSize: 11, fontFamily: 'Inter, sans-serif', fill: 'var(--color-ink-muted)' };
const TOOLTIP_STYLE = {
  backgroundColor: 'var(--color-bg-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  fontFamily: 'Inter, sans-serif',
  fontSize: 12,
  color: 'var(--color-ink)',
  boxShadow: 'var(--shadow-modal)',
};
const COL_HEAD = 'text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-muted)] pb-3';
const DATE_INPUT = 'px-2.5 py-1 text-[12px] rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] border border-transparent focus:border-[var(--color-accent)] focus:outline-none text-[var(--color-ink)]';

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
  if (rating >= 4) return 'var(--color-accent)';
  if (rating === 3) return 'var(--color-accent-amber)';
  return 'var(--color-urgent)';
}

function ChipButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded-[var(--radius-pill)] text-[12px] font-medium transition-colors ${
        active
          ? 'bg-[var(--color-bg-surface)] text-[var(--color-ink)] shadow-[var(--shadow-soft)]'
          : 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]'
      }`}
    >
      {children}
    </button>
  );
}

export default function AdminSatisfaction() {
  const { memberships, activeMembershipId } = useStoreShallow((s) => ({
    memberships: s.memberships,
    activeMembershipId: s.activeMembershipId,
  }));
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
    <div className="space-y-4 pb-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.2px] text-[var(--color-ink)]">Satisfaction Analytics</h1>
          <p className="text-[13px] text-[var(--color-ink-muted)] mt-1">Ticket ratings, trends and per-staff comparison</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-[var(--radius-pill)] bg-[var(--color-bg-elevated)]">
          <ChipButton active={dept === 'all'} onClick={() => setDept('all')}>All Depts</ChipButton>
          {departments.map(d => (
            <ChipButton key={d.id} active={dept === d.id} onClick={() => setDept(d.id)}>{d.name}</ChipButton>
          ))}

          <div className="w-px h-4 bg-[var(--color-border)] mx-1" />

          <div className="flex items-center gap-0.5">
            {presets.map(p => (
              <ChipButton
                key={p.key}
                active={activePreset === p.key}
                onClick={() => applyPreset(p.key, setDateFrom, setDateTo, setActivePreset)}
              >
                {p.label}
              </ChipButton>
            ))}
          </div>

          <div className="w-px h-4 bg-[var(--color-border)] mx-1" />

          <div className="flex items-center gap-1 px-1">
            <input
              type="date"
              value={dateFrom}
              onChange={e => { setDateFrom(e.target.value); setActivePreset(null); }}
              className={DATE_INPUT}
            />
            <span className="text-[12px] text-[var(--color-ink-muted)]">→</span>
            <input
              type="date"
              value={dateTo}
              onChange={e => { setDateTo(e.target.value); setActivePreset(null); }}
              className={DATE_INPUT}
            />
          </div>
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
          <StatCard label="Average Rating" value={stats ? stats.summary.avg.toFixed(2) : '—'} color="dark" />
          <StatCard label="Total Ratings" value={stats ? stats.summary.total : '—'} color="dark" />
          <StatCard label="Comment Rate" value={stats ? `${commentRate}%` : '—'} color="dark" />
        </div>
      )}

      {/* Charts row */}
      <div className="grid grid-cols-2 gap-4">
        <Panel title="Rating Trend">
          {isLoading ? (
            <Skeleton className="h-48" />
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={stats?.trend || []} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="date" tick={CHART_TICK} tickLine={false} axisLine={{ stroke: 'var(--color-border)' }} />
                <YAxis
                  domain={[0, 5]}
                  ticks={[1, 2, 3, 4, 5]}
                  tick={CHART_TICK}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--color-border)' }}
                />
                <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: 'var(--color-ink)' }} />
                <Legend wrapperStyle={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: 'var(--color-ink-soft)' }} />
                <Line
                  type="monotone"
                  dataKey="avg"
                  name="Avg Rating"
                  stroke="var(--color-accent)"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Panel>

        <Panel title="Rating Distribution">
          {isLoading ? (
            <Skeleton className="h-48" />
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={fullDist} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="label" tick={CHART_TICK} tickLine={false} axisLine={{ stroke: 'var(--color-border)' }} />
                <YAxis tick={CHART_TICK} tickLine={false} axisLine={{ stroke: 'var(--color-border)' }} />
                <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: 'var(--color-ink)' }} />
                <Bar dataKey="count" name="Count" radius={[4, 4, 0, 0]}>
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
                <th className={COL_HEAD}>Department</th>
                <th className={COL_HEAD}>Avg</th>
                <th className={COL_HEAD}>Stars</th>
                <th className={`${COL_HEAD} text-right`}>Total</th>
              </tr>
            </thead>
            <tbody>
              {(stats?.byDept || []).length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-[var(--color-ink-muted)] text-[13px] py-4">No data</td>
                </tr>
              ) : (
                (stats?.byDept || []).map(row => (
                  <tr key={row.dept} className="border-b border-[var(--color-border)] last:border-b-0">
                    <td className="py-2 text-[14px] font-medium text-[var(--color-ink)]">{row.dept || '—'}</td>
                    <td className="py-2 text-[14px] font-medium text-[var(--color-ink)] tabular-nums">{row.avg.toFixed(2)}</td>
                    <td className="py-2"><Stars value={Math.round(row.avg)} /></td>
                    <td className="py-2 text-right text-[12px] text-[var(--color-ink-muted)] tabular-nums">{row.count}</td>
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
                <th className={COL_HEAD}>Rank</th>
                <th className={COL_HEAD}>Name</th>
                <th className={COL_HEAD}>Avg</th>
                <th className={COL_HEAD}>Stars</th>
                <th className={`${COL_HEAD} text-right`}>Total</th>
              </tr>
            </thead>
            <tbody>
              {(stats?.byStaff || []).length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-[var(--color-ink-muted)] text-[13px] py-4">No data</td>
                </tr>
              ) : (
                (stats?.byStaff || [])
                  .slice()
                  .sort((a, b) => b.avg - a.avg)
                  .map((row, idx) => (
                    <tr key={row.supportId ?? row.name} className="border-b border-[var(--color-border)] last:border-b-0">
                      <td className="py-2 text-[12px] text-[var(--color-ink-muted)] tabular-nums">#{idx + 1}</td>
                      <td className="py-2 text-[14px] font-medium text-[var(--color-ink)]">{row.name}</td>
                      <td className="py-2 text-[14px] font-medium text-[var(--color-ink)] tabular-nums">{row.avg.toFixed(2)}</td>
                      <td className="py-2"><Stars value={Math.round(row.avg)} /></td>
                      <td className="py-2 text-right text-[12px] text-[var(--color-ink-muted)] tabular-nums">{row.count}</td>
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
