import { useState } from 'react';
import { Panel, StatCard, Skeleton } from './DashboardHelpers';
import AgentStatusStats from './AgentStatusStats';
import { useT } from '../../i18n';
import { getStatusColors, getStatusI18nKey } from '../../utils/statusColors';
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
import { useStoreShallow } from '../../store/useStore';
import { exportDashboardCSV, exportDashboardPDF, DashboardStats } from '../../utils/exportDashboard';
import { Download, FileText, AlertTriangle, RefreshCw, X, Star } from 'lucide-react';

// Shared Soft Product style constants — mirror the other admin panels.
const INPUT = 'h-8 px-2.5 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] text-[12px] text-[var(--color-ink)] border border-transparent focus:border-[var(--color-accent)] focus:outline-none';
const PRIMARY_BTN = 'h-9 px-4 inline-flex items-center gap-1.5 rounded-[var(--radius-btn)] bg-[var(--color-accent)] hover:brightness-110 text-white text-[13px] font-medium shadow-[var(--shadow-soft)] transition-all';
const SECONDARY_BTN = 'h-8 px-3 inline-flex items-center gap-1.5 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-hover)] text-[var(--color-ink)] text-[12px] font-medium transition-colors';

// Recharts tooltip styled with Soft Product tokens. Inter everywhere — no
// mono in data-viz chrome per the typography spec.
const tooltipStyle: React.CSSProperties = {
  backgroundColor: 'var(--color-bg-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  boxShadow: 'var(--shadow-card)',
  color: 'var(--color-ink)',
  fontFamily: 'Inter, system-ui, sans-serif',
  fontSize: 12,
};
const tooltipLabelStyle: React.CSSProperties = { color: 'var(--color-ink)', fontWeight: 500 };
const CHART_TICK = { fontSize: 11, fill: 'var(--color-ink-muted)', fontFamily: 'Inter, system-ui, sans-serif' } as const;

/** Typed shape of the getGlobalStats tRPC response for safe property access */
interface DashboardData {
  total: number;
  todayTotal: number;
  todayOpen: number;
  todayClosed: number;
  avgResponseMinutes: number;
  p95ResponseMinutes: number | null;
  avgRating: number | null;
  totalRatings: number;
  abandonedCount: number;
  oldestWaitMinutes: number;
  waitingOver3: number;
  resolutionRate: number;
  deptCounts: Record<string, number>;
  dailyTrend: { date: string; total: number }[];
  trendGranularity: string;
  supportStats: { name: string; total: number; today: number; avgRating: number | null }[];
  agentStats: { name: string; total: number; today: number }[];
  previousPeriod?: {
    total?: number;
    avgResponseMinutes?: number;
    avgRating?: number;
    abandonedCount?: number;
  };
}

export default function AdminStats() {
  const t = useT();
  const { memberships, activeMembershipId } = useStoreShallow((s) => ({
    memberships: s.memberships,
    activeMembershipId: s.activeMembershipId,
  }));
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

  const statsQuery = trpc.stats.getGlobalStats.useQuery(
    {
      dept: statsDept === 'all' ? undefined : statsDept,
      dateFrom: statsDateFrom || undefined,
      dateTo: statsDateTo || undefined,
    },
    { refetchInterval: 30000 }
  );
  const { data: stats, isLoading, error: statsError, refetch: refetchStats } = statsQuery;

  const { data: onlineTeam, error: onlineError } = trpc.status.getTeamStatus.useQuery(undefined, {
    refetchInterval: 15000,
  });
  const onlineUsers = (onlineTeam || []) as Array<{ userId: string; name: string; role: string; status: string }>;
  const availableCount = onlineUsers.filter(u => u.status === 'online').length;
  const totalOnline = onlineUsers.length;
  const capacityPct = totalOnline > 0 ? Math.round((availableCount / totalOnline) * 100) : 0;

  if (statsError) {
    return (
      <div className="min-w-[1280px] max-w-7xl mx-auto p-4">
        <div
          className="rounded-[var(--radius-card)] bg-[var(--color-bg-surface)] shadow-[var(--shadow-card)] p-8 flex flex-col items-center justify-center gap-4 border-l-4 border-[var(--color-urgent)]"
          role="alert"
        >
          <AlertTriangle className="h-10 w-10 text-[var(--color-urgent)]" aria-hidden />
          <div className="text-center">
            <h2 className="text-lg font-semibold text-[var(--color-ink)]">Failed to load dashboard</h2>
            <p className="text-[12px] text-[var(--color-ink-soft)] mt-1 max-w-md">{statsError.message}</p>
          </div>
          <button
            onClick={() => refetchStats()}
            className={PRIMARY_BTN}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Retry
          </button>
        </div>
      </div>
    );
  }

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

  const deptCounts: Record<string, number> = (stats as DashboardData).deptCounts || {};
  const totalTickets = stats.total || 1;

  return (
    <div className="space-y-5 min-w-[1280px] max-w-screen-2xl mx-auto pb-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-baseline gap-3">
          <h2 className="text-xl font-semibold text-[var(--color-ink)] tracking-tight">Dashboard</h2>
          <p className="text-[12px] text-[var(--color-ink-muted)]">Real-time metrics</p>
        </div>

        <div className="flex items-center gap-2">
          {/* Filter cluster: soft card holding dept select, date presets, and range */}
          <div className="flex items-center gap-2 rounded-[var(--radius-card)] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)] px-2 py-1.5">
            {/* Department filter */}
            <select
              value={statsDept}
              onChange={(e) => setStatsDept(e.target.value)}
              className={`${INPUT} min-w-[120px]`}
              aria-label="Filter by department"
            >
              <option value="all">All departments</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>

            <div className="w-px h-5 bg-[var(--color-border)]" />

            {/* Date presets — segmented pill group */}
            <div className="flex items-center gap-0.5 rounded-[var(--radius-pill)] bg-[var(--color-bg-elevated)] p-0.5">
              {[
                { key: 'today', label: 'Today' },
                { key: '7d', label: '7d' },
                { key: '14d', label: '14d' },
                { key: '30d', label: '30d' },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => applyPreset(key)}
                  className={`px-2.5 h-7 inline-flex items-center rounded-[var(--radius-pill)] text-[12px] font-medium transition-colors ${
                    activePreset === key
                      ? 'bg-[var(--color-bg-surface)] text-[var(--color-ink)] shadow-[var(--shadow-soft)]'
                      : 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="w-px h-5 bg-[var(--color-border)]" />

            {/* Date range */}
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                aria-label="Start date"
                value={statsDateFrom}
                onChange={(e) => { setStatsDateFrom(e.target.value); setActivePreset(null); }}
                className={`${INPUT} w-[122px]`}
              />
              <span className="text-[11px] text-[var(--color-ink-muted)]">→</span>
              <input
                type="date"
                aria-label="End date"
                value={statsDateTo}
                onChange={(e) => { setStatsDateTo(e.target.value); setActivePreset(null); }}
                className={`${INPUT} w-[122px]`}
              />
              {(statsDept !== 'all' || statsDateFrom || statsDateTo) && (
                <button
                  onClick={() => { setStatsDept('all'); setStatsDateFrom(''); setStatsDateTo(''); setActivePreset(null); }}
                  className="w-8 h-8 flex items-center justify-center rounded-full text-[var(--color-ink-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)] transition-colors"
                  title="Clear all filters"
                  aria-label="Clear all filters"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              )}
            </div>
          </div>

          <div className="flex gap-1.5 shrink-0">
            <button
              onClick={() => exportDashboardCSV(stats as DashboardStats)}
              className={SECONDARY_BTN}
              title="Export as CSV"
            >
              <Download className="h-3.5 w-3.5" aria-hidden /> CSV
            </button>
            <button
              onClick={() => exportDashboardPDF(stats as DashboardStats)}
              className={SECONDARY_BTN}
              title="Export as PDF"
            >
              <FileText className="h-3.5 w-3.5" aria-hidden /> PDF
            </button>
          </div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-6 gap-3">
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
      </div>

      <div className="grid grid-cols-12 gap-4">
        {/* Left Column: Health & Team */}
        <div className="col-span-4 space-y-4">
          <Panel title="Queue health">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-[var(--radius-card)] bg-[var(--color-bg-elevated)] p-3">
                <p className="text-[11px] text-[var(--color-ink-muted)]">Oldest waiting</p>
                <p className={`text-xl font-semibold tabular-nums mt-0.5 ${stats.oldestWaitMinutes > 3 ? 'text-[var(--color-urgent)]' : stats.oldestWaitMinutes > 0 ? 'text-[var(--color-ink)]' : 'text-[var(--color-ink-muted)]'}`}>
                  {stats.oldestWaitMinutes > 0 ? `${stats.oldestWaitMinutes}m` : '—'}
                </p>
              </div>
              <div className="rounded-[var(--radius-card)] bg-[var(--color-bg-elevated)] p-3">
                <p className="text-[11px] text-[var(--color-ink-muted)]">Waiting &gt;3 min</p>
                <p className={`text-xl font-semibold tabular-nums mt-0.5 ${stats.waitingOver3 > 0 ? 'text-[var(--color-urgent)]' : 'text-[var(--color-ink-muted)]'}`}>
                  {stats.waitingOver3}
                </p>
              </div>
            </div>
          </Panel>

          <Panel title="Online now" badge={`${totalOnline}`}>
            {onlineError ? (
              <p className="text-[12px] text-[var(--color-urgent)] py-2 text-center">Failed to load team status</p>
            ) : onlineUsers.length === 0 ? (
              <p className="text-[13px] text-[var(--color-ink-muted)] py-2 text-center">{t('no_data') || 'No agents online'}</p>
            ) : (
              <>
                <div className="mb-3">
                  <div className="flex justify-between text-[11px] text-[var(--color-ink-muted)] mb-1.5">
                    <span>{t('team_capacity') || 'Team capacity'}</span>
                    <span className="text-[var(--color-ink)] tabular-nums">{availableCount} / {totalOnline} ({capacityPct}%)</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-[var(--color-bg-elevated)] w-full overflow-hidden">
                    <div className="h-full rounded-full bg-[var(--color-accent-green)] transition-all" style={{ width: `${capacityPct}%` }} />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5 max-h-[200px] overflow-y-auto pr-1">
                  {onlineUsers.map((agent) => {
                    const colors = getStatusColors(agent.status);
                    return (
                      <div key={agent.userId} className="flex items-center gap-2 py-0.5">
                        <div className="w-6 h-6 rounded-full bg-[var(--color-bg-elevated)] flex items-center justify-center text-[9px] font-semibold text-[var(--color-ink)] shrink-0">
                          {agent.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                        </div>
                        <span className="text-[12px] text-[var(--color-ink)] truncate flex-1">{agent.name}</span>
                        <span className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} aria-hidden />
                        <span className={`text-[10px] ${colors.text}`}>{t(getStatusI18nKey(agent.status))}</span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </Panel>
        </div>

        {/* Center/Right: Trends & Distribution */}
        <div className="col-span-8 space-y-4">
          <Panel title={`Tickets trend (${stats.trendGranularity})`}>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={stats.dailyTrend} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="date" tick={CHART_TICK} interval={Math.ceil(stats.dailyTrend.length / 12)} />
                <YAxis tick={CHART_TICK} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} cursor={{ stroke: 'var(--color-border)' }} />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 11, fontFamily: 'Inter, system-ui, sans-serif' }} />
                <Line type="monotone" dataKey="total" stroke="var(--color-accent)" strokeWidth={2} dot={false} name="Total" />
              </LineChart>
            </ResponsiveContainer>
          </Panel>

          <div className="grid grid-cols-2 gap-4">
            <Panel title="Dept distribution">
              {departments.length === 0 ? (
                <p className="text-[13px] text-[var(--color-ink-muted)] py-2">No departments</p>
              ) : (
                <div className="space-y-2.5">
                  {departments.map((dept) => {
                    const count = deptCounts[dept.id] || 0;
                    const pct = Math.round((count / totalTickets) * 100);
                    return (
                      <div key={dept.id}>
                        <div className="flex justify-between mb-1">
                          <span className="text-[12px] text-[var(--color-ink)]">{dept.name}</span>
                          <span className="text-[11px] text-[var(--color-ink-muted)] tabular-nums">{count} ({pct}%)</span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-[var(--color-bg-elevated)] overflow-hidden">
                          <div className="h-full rounded-full bg-[var(--color-accent)] transition-all" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Panel>
          </div>
        </div>
      </div>

      {/* Support & Agent performance */}
      <div className="grid grid-cols-2 gap-4">
        <Panel title="Support performance">
          {stats.supportStats.length === 0 ? (
            <p className="text-[13px] text-[var(--color-ink-muted)]">No data yet</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(160, stats.supportStats.length * 35)}>
              <BarChart data={stats.supportStats} layout="vertical" margin={{ top: 0, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
                <XAxis type="number" tick={CHART_TICK} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={CHART_TICK} width={80} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} cursor={{ fill: 'var(--color-hover)' }} />
                <Bar dataKey="total" fill="var(--color-accent)" name="Total" radius={[0, 4, 4, 0]} />
                <Bar dataKey="today" fill="var(--color-accent-soft)" name="Today" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Panel>

        <Panel title="Agent performance">
          {stats.agentStats.length === 0 ? (
            <p className="text-[13px] text-[var(--color-ink-muted)]">No data yet</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(160, stats.agentStats.length * 35)}>
              <BarChart data={stats.agentStats} layout="vertical" margin={{ top: 0, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
                <XAxis type="number" tick={CHART_TICK} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={CHART_TICK} width={80} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} cursor={{ fill: 'var(--color-hover)' }} />
                <Bar dataKey="total" fill="var(--color-accent)" name="Total" radius={[0, 4, 4, 0]} />
                <Bar dataKey="today" fill="var(--color-accent-soft)" name="Today" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <TeamSatisfaction dateFrom={statsDateFrom} dateTo={statsDateTo} />
        <AgentStatusStats />
      </div>
    </div>
  );
}

function StarRating({ value }: { value: number }) {
  const rounded = Math.round(value);
  return (
    <span className="inline-flex gap-0.5" aria-label={`${value.toFixed(1)} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => {
        const filled = i <= rounded;
        return (
          <Star
            key={i}
            className={`h-3.5 w-3.5 ${filled ? 'text-[var(--color-accent-amber)] fill-[var(--color-accent-amber)]' : 'text-[var(--color-ink-muted)] opacity-40'}`}
            aria-hidden
          />
        );
      })}
    </span>
  );
}

function TeamSatisfaction({ dateFrom, dateTo }: { dateFrom: string; dateTo: string }) {
  const { data: staffRatings, isLoading, error: ratingsError } = trpc.rating.getStaffRatings.useQuery(
    {
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    },
    { refetchInterval: 30000 }
  );

  return (
    <Panel title="Team satisfaction">
      {ratingsError ? (
        <p className="text-[12px] text-[var(--color-urgent)] py-4 text-center">Failed to load ratings</p>
      ) : isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : !staffRatings || staffRatings.length === 0 ? (
        <p className="text-[13px] text-[var(--color-ink-muted)]">No ratings yet</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                <th className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-muted)] py-2 pr-4">Support staff</th>
                <th className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-muted)] py-2 pr-4">Avg rating</th>
                <th className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-muted)] py-2 pr-4">Stars</th>
                <th className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-muted)] py-2 text-right">Total ratings</th>
              </tr>
            </thead>
            <tbody>
              {staffRatings.map((staff) => {
                const avg = Number(staff.avgRating) || 0;
                const colorClass =
                  avg >= 4 ? 'text-[var(--color-ok)]' :
                  avg >= 3 ? 'text-[var(--color-accent-amber)]' :
                  'text-[var(--color-urgent)]';
                return (
                  <tr key={staff.supportId} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="py-2.5 pr-4 text-[13px] text-[var(--color-ink)]">{staff.supportName}</td>
                    <td className={`py-2.5 pr-4 text-[13px] font-semibold tabular-nums ${colorClass}`}>{avg.toFixed(1)}</td>
                    <td className="py-2.5 pr-4"><StarRating value={avg} /></td>
                    <td className="py-2.5 text-[13px] text-[var(--color-ink-soft)] tabular-nums text-right">{staff.totalRatings}</td>
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
