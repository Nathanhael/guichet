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
import { Download, FileText, AlertTriangle, RefreshCw } from 'lucide-react';

/** Shared Recharts tooltip styles using brutalist design tokens */
const tooltipStyle: React.CSSProperties = {
  backgroundColor: 'var(--color-bg-elevated)',
  border: '1px solid var(--color-text-secondary)',
  borderRadius: 0,
  color: 'var(--color-text-primary)',
};
const tooltipLabelStyle: React.CSSProperties = { color: 'var(--color-text-primary)' };

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
        <div className="border-2 border-[var(--color-accent-red)] bg-[var(--color-bg-surface)] p-8 flex flex-col items-center justify-center gap-4">
          <AlertTriangle className="h-10 w-10 text-[var(--color-accent-red)]" />
          <div className="text-center">
            <h2 className="text-lg font-bold uppercase tracking-wide text-[var(--color-accent-red)]">Failed to load dashboard</h2>
            <p className="text-xs uppercase font-mono text-[var(--color-text-muted)] mt-2 max-w-md">{statsError.message}</p>
          </div>
          <button
            onClick={() => refetchStats()}
            className="btn-primary flex items-center gap-2"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Retry
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
    <div className="space-y-4 min-w-[1280px] max-w-screen-2xl mx-auto pb-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-baseline gap-3">
          <h2 className="text-xl font-bold uppercase tracking-tight">Dashboard</h2>
          <p className="text-[10px] font-mono uppercase text-[var(--color-text-muted)]">Real-time metrics</p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 border border-[var(--color-border)] p-1 bg-[var(--color-bg-surface)]">
            {/* Department filter */}
            <select
              value={statsDept}
              onChange={(e) => setStatsDept(e.target.value)}
              className="input-field py-1 text-[10px] font-bold uppercase min-w-[110px]"
              aria-label="Filter by department"
            >
              <option value="all">All Depts</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>

            <div className="w-px h-5 bg-[var(--color-border)] mx-0.5" />

            {/* Date presets */}
            <div className="flex gap-0.5">
              {[
                { key: 'today', label: 'Today' },
                { key: '7d', label: '7D' },
                { key: '14d', label: '14D' },
                { key: '30d', label: '30D' },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => applyPreset(key)}
                  className={`px-2 py-1 text-[10px] font-bold uppercase border ${
                    activePreset === key
                      ? 'border-[var(--color-border)] bg-[var(--color-text-primary)] text-[var(--color-bg-base)]'
                      : 'border-transparent text-[var(--color-text-muted)] hover:opacity-100'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="w-px h-5 bg-[var(--color-border)] mx-0.5" />

            {/* Date range */}
            <div className="flex items-center gap-1.5 px-1">
              <input
                type="date"
                aria-label="Start date"
                value={statsDateFrom}
                onChange={(e) => { setStatsDateFrom(e.target.value); setActivePreset(null); }}
                className="input-field py-1 text-[10px] w-[105px]"
              />
              <span className="text-[10px] text-[var(--color-text-muted)]">→</span>
              <input
                type="date"
                aria-label="End date"
                value={statsDateTo}
                onChange={(e) => { setStatsDateTo(e.target.value); setActivePreset(null); }}
                className="input-field py-1 text-[10px] w-[105px]"
              />
              {(statsDept !== 'all' || statsDateFrom || statsDateTo) && (
                <button
                  onClick={() => { setStatsDept('all'); setStatsDateFrom(''); setStatsDateTo(''); setActivePreset(null); }}
                  className="p-1 border border-[var(--color-border)] text-[var(--color-text-muted)] hover:opacity-100"
                  title="Clear all filters"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          <div className="flex gap-1 shrink-0">
            <button
              onClick={() => exportDashboardCSV(stats as DashboardStats)}
              className="btn-secondary py-1 text-[10px]"
              title="Export as CSV"
            >
              <Download className="h-3 w-3" /> CSV
            </button>
            <button
              onClick={() => exportDashboardPDF(stats as DashboardStats)}
              className="btn-secondary py-1 text-[10px]"
              title="Export as PDF"
            >
              <FileText className="h-3 w-3" /> PDF
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
              <div className={`border p-3 ${stats.oldestWaitMinutes > 3 ? 'border-[var(--color-border)]' : 'border-[var(--color-border)]'}`}>
                <p className="text-[9px] uppercase font-bold text-[var(--color-text-secondary)]">Oldest waiting</p>
                <p className={`text-xl font-bold mt-0.5 ${stats.oldestWaitMinutes > 3 ? '' : 'text-[var(--color-text-muted)]'}`}>
                  {stats.oldestWaitMinutes > 0 ? `${stats.oldestWaitMinutes}m` : '—'}
                </p>
              </div>
              <div className={`border p-3 ${stats.waitingOver3 > 0 ? 'border-[var(--color-border)]' : 'border-[var(--color-border)]'}`}>
                <p className="text-[9px] uppercase font-bold text-[var(--color-text-secondary)]">Waiting &gt;3 min</p>
                <p className={`text-xl font-bold mt-0.5 ${stats.waitingOver3 > 0 ? '' : 'text-[var(--color-text-muted)]'}`}>
                  {stats.waitingOver3}
                </p>
              </div>
            </div>
          </Panel>

          <Panel title="Online now" badge={`${totalOnline}`}>
            {onlineError ? (
              <p className="text-xs uppercase font-bold text-[var(--color-accent-red)] py-2 text-center">Failed to load team status</p>
            ) : onlineUsers.length === 0 ? (
              <p className="text-sm text-text-muted py-2 text-center">{t('no_data') || 'No agents online'}</p>
            ) : (
              <>
                <div className="mb-3">
                  <div className="flex justify-between text-[9px] font-mono font-bold uppercase text-text-muted mb-1">
                    <span>{t('team_capacity') || 'Team capacity'}</span>
                    <span className="text-text-primary">{availableCount} / {totalOnline} ({capacityPct}%)</span>
                  </div>
                  <div className="h-1.5 bg-bg-elevated w-full">
                    <div className="h-full bg-accent-green" style={{ width: `${capacityPct}%` }} />
                  </div>
                </div>
                <div className="flex flex-col gap-1 max-h-[200px] overflow-y-auto pr-1">
                  {onlineUsers.map((agent) => {
                    const colors = getStatusColors(agent.status);
                    return (
                      <div key={agent.userId} className="flex items-center gap-2 py-0.5">
                        <div className="w-5 h-5 rounded-full bg-bg-elevated flex items-center justify-center text-[8px] font-bold text-text-primary shrink-0">
                          {agent.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                        </div>
                        <span className="text-[10px] font-semibold text-text-primary truncate flex-1">{agent.name}</span>
                        <span className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} />
                        <span className={`text-[8px] font-bold uppercase ${colors.text}`}>{t(getStatusI18nKey(agent.status))}</span>
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
          <Panel title={`Tickets Trend (${stats.trendGranularity})`}>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={stats.dailyTrend} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={Math.ceil(stats.dailyTrend.length / 12)} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="total" stroke="var(--color-text-primary)" strokeWidth={2} dot={false} name="Total" />
              </LineChart>
            </ResponsiveContainer>
          </Panel>

          <div className="grid grid-cols-2 gap-4">
            <Panel title="Dept distribution">
              {departments.length === 0 ? (
                <p className="text-sm text-text-muted py-2">No departments</p>
              ) : (
                <div className="space-y-2">
                  {departments.map((dept) => {
                    const count = deptCounts[dept.id] || 0;
                    const pct = Math.round((count / totalTickets) * 100);
                    return (
                      <div key={dept.id}>
                        <div className="flex justify-between mb-0.5">
                          <span className="text-[9px] font-bold uppercase">{dept.name}</span>
                          <span className="text-[9px] font-bold text-[var(--color-text-secondary)]">{count} ({pct}%)</span>
                        </div>
                        <div className="h-1 w-full bg-bg-elevated">
                          <div className="h-full bg-[var(--color-text-primary)]" style={{ width: `${pct}%` }} />
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
            <p className="text-sm text-[var(--color-text-secondary)]">No data yet</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(160, stats.supportStats.length * 35)}>
              <BarChart data={stats.supportStats} layout="vertical" margin={{ top: 0, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={80} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} />
                <Bar dataKey="total" fill="var(--color-text-primary)" name="Total Tasks" />
                <Bar dataKey="today" fill="var(--color-text-secondary)" name="Today" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Panel>

        <Panel title="Agent performance">
          {stats.agentStats.length === 0 ? (
            <p className="text-sm text-[var(--color-text-secondary)]">No data yet</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(160, stats.agentStats.length * 35)}>
              <BarChart data={stats.agentStats} layout="vertical" margin={{ top: 0, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={80} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} />
                <Bar dataKey="total" fill="var(--color-text-primary)" name="Total Tickets" />
                <Bar dataKey="today" fill="var(--color-text-secondary)" name="Today" />
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
  const stars = [];
  for (let i = 1; i <= 5; i++) {
    const filled = i <= Math.round(value);
    stars.push(
      <svg
        key={i}
        xmlns="http://www.w3.org/2000/svg"
        className={`h-4 w-4 inline-block ${filled ? 'text-[var(--color-text-primary)]' : 'text-black/20 dark:text-white/20'}`}
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
  const { data: staffRatings, isLoading, error: ratingsError } = trpc.rating.getStaffRatings.useQuery(
    {
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    },
    { refetchInterval: 30000 }
  );

  return (
    <Panel title="Team Satisfaction">
      {ratingsError ? (
        <p className="text-xs uppercase font-bold text-[var(--color-accent-red)] py-4 text-center">Failed to load ratings</p>
      ) : isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : !staffRatings || staffRatings.length === 0 ? (
        <p className="text-sm text-[var(--color-text-secondary)]">No ratings yet</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                <th className="font-mono text-[9px] uppercase text-[var(--color-text-muted)] tracking-wide py-2 pr-4">Support Staff</th>
                <th className="font-mono text-[9px] uppercase text-[var(--color-text-muted)] tracking-wide py-2 pr-4">Avg Rating</th>
                <th className="font-mono text-[9px] uppercase text-[var(--color-text-muted)] tracking-wide py-2 pr-4">Stars</th>
                <th className="font-mono text-[9px] uppercase text-[var(--color-text-muted)] tracking-wide py-2 text-right">Total Ratings</th>
              </tr>
            </thead>
            <tbody>
              {staffRatings.map((staff) => {
                const avg = Number(staff.avgRating) || 0;
                const colorClass =
                  avg >= 4 ? '' :
                  avg >= 3 ? 'text-[var(--color-text-secondary)]' :
                  'text-[var(--color-text-muted)]';
                return (
                  <tr key={staff.supportId} className="border-b border-[var(--color-border)]">
                    <td className="py-2 pr-4 text-sm font-bold">{staff.supportName}</td>
                    <td className={`py-2 pr-4 text-sm font-bold tabular-nums ${colorClass}`}>{avg.toFixed(1)}</td>
                    <td className="py-2 pr-4"><StarRating value={avg} /></td>
                    <td className="py-2 text-sm font-bold text-[var(--color-text-secondary)] text-right">{staff.totalRatings}</td>
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
