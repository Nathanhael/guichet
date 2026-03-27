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
import { exportDashboardCSV, exportDashboardPDF } from '../../utils/exportDashboard';
import { Download, FileText, AlertTriangle } from 'lucide-react';

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
          <h2 className="text-2xl font-bold uppercase tracking-tight">Dashboard</h2>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">Real-time performance metrics and historical trends</p>
        </div>

        <div className="flex gap-1 shrink-0">
          <button
            onClick={() => exportDashboardCSV(stats as any)}
            className="btn-secondary"
            title="Export as CSV"
          >
            <Download className="h-3.5 w-3.5" /> CSV
          </button>
          <button
            onClick={() => exportDashboardPDF(stats as any)}
            className="btn-secondary"
            title="Export as PDF"
          >
            <FileText className="h-3.5 w-3.5" /> PDF
          </button>
        </div>

        <div className="flex items-center gap-2 border border-[var(--color-border)] p-2 bg-[var(--color-bg-surface)] overflow-x-auto">
          {/* Department filter */}
          <div className="flex gap-1">
            {(['all', ...departments.map(d => d.id)] as string[]).map((d) => (
              <button
                key={d}
                onClick={() => setStatsDept(d)}
                className={`px-3 py-1.5 text-xs font-bold uppercase border ${
                  statsDept === d
                    ? 'border-[var(--color-border)] bg-[var(--color-text-primary)] text-[var(--color-bg-base)]'
                    : 'border-transparent text-[var(--color-text-muted)] hover:opacity-100'
                }`}
              >
                {d === 'all' ? 'All' : (departments.find(dep => dep.id === d)?.name || d)}
              </button>
            ))}
          </div>

          <div className="w-px h-6 bg-[var(--color-border)] mx-1" />

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
                className={`px-2.5 py-1.5 text-xs font-bold uppercase border ${
                  activePreset === key
                    ? 'border-[var(--color-border)] bg-[var(--color-text-primary)] text-[var(--color-bg-base)]'
                    : 'border-transparent text-[var(--color-text-muted)] hover:opacity-100'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="w-px h-6 bg-[var(--color-border)] mx-1" />

          {/* Date range */}
          <div className="flex items-center gap-2">
            <input
              type="date"
              aria-label="Start date"
              value={statsDateFrom}
              onChange={(e) => { setStatsDateFrom(e.target.value); setActivePreset(null); }}
              className="input-field text-xs"
            />
            <span className="text-xs text-[var(--color-text-muted)]">→</span>
            <input
              type="date"
              aria-label="End date"
              value={statsDateTo}
              onChange={(e) => { setStatsDateTo(e.target.value); setActivePreset(null); }}
              className="input-field text-xs"
            />
            {(statsDept !== 'all' || statsDateFrom || statsDateTo) && (
              <button
                onClick={() => { setStatsDept('all'); setStatsDateFrom(''); setStatsDateTo(''); setActivePreset(null); }}
                className="p-1.5 border border-[var(--color-border)] text-[var(--color-text-muted)] hover:opacity-100"
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
            <div className={`border p-3 ${stats.oldestWaitMinutes > 3 ? 'border-[var(--color-border)]' : 'border-[var(--color-border)]'}`}>
              <p className="text-xs uppercase font-bold text-[var(--color-text-secondary)]">Oldest waiting</p>
              <p className={`text-2xl font-bold mt-0.5 ${stats.oldestWaitMinutes > 3 ? '' : 'text-[var(--color-text-muted)]'}`}>
                {stats.oldestWaitMinutes > 0 ? `${stats.oldestWaitMinutes}m` : '—'}
              </p>
            </div>
            <div className={`border p-3 ${stats.waitingOver3 > 0 ? 'border-[var(--color-border)]' : 'border-[var(--color-border)]'}`}>
              <p className="text-xs uppercase font-bold text-[var(--color-text-secondary)]">Waiting &gt;3 min</p>
              <p className={`text-2xl font-bold mt-0.5 ${stats.waitingOver3 > 0 ? '' : 'text-[var(--color-text-muted)]'}`}>
                {stats.waitingOver3}
              </p>
            </div>
          </div>

          {/* Department distribution */}
          {departments.length > 0 && (
            <div className="mt-4 pt-4 border-t border-[var(--color-border)]">
              <p className="mono-label text-[var(--color-text-secondary)] mb-3">Dept distribution</p>
              <div className="space-y-2">
                {departments.map((dept) => {
                  const count = deptCounts[dept.id] || 0;
                  const pct = Math.round((count / totalTickets) * 100);
                  return (
                    <div key={dept.id}>
                      <div className="flex justify-between mb-1">
                        <span className="text-[10px] font-bold uppercase">{dept.name}</span>
                        <span className="text-[10px] font-bold text-[var(--color-text-secondary)]">{count} ({pct}%)</span>
                      </div>
                      <div className="h-1.5 w-full bg-bg-elevated">
                        <div className="h-full bg-[var(--color-text-primary)]" style={{ width: `${pct}%` }} />
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
            <p className="text-sm text-[var(--color-text-secondary)]">Live presence monitoring active</p>
          </div>
        </Panel>
      </div>

      {/* Sentiment Analysis */}
      <SentimentPanel stats={stats as any} />

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
            <p className="text-sm text-[var(--color-text-secondary)]">No data yet</p>
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
            <p className="text-sm text-[var(--color-text-secondary)]">No data yet</p>
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

function SentimentDot({ score }: { score: number }) {
  const style = score >= 0.3 ? 'bg-[var(--color-text-primary)]' : score >= -0.3 ? 'bg-text-muted' : 'border border-[var(--color-border)] bg-transparent';
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${style}`} />;
}

function sentimentLabel(score: number): string {
  if (score >= 0.3) return 'Positive';
  if (score >= -0.3) return 'Neutral';
  return 'Negative';
}

function SentimentPanel({ stats }: { stats: any }) {
  const { data: negativeTix } = trpc.ai.getNegativeSentimentTickets.useQuery(
    { limit: 10 },
    { refetchInterval: 30000 }
  );

  const score = stats.sentimentScore ?? 0;
  const sentimentByDept: Record<string, { avg: number | null; count: number }> = stats.sentimentByDept || {};
  const trendData = (stats.dailyTrend || [])
    .filter((d: any) => d.sentiment != null)
    .map((d: any) => ({
      date: d.date,
      sentiment: d.sentiment,
    }));

  return (
    <div className="grid grid-cols-3 gap-4">
      {/* Overall Sentiment */}
      <Panel title="Sentiment Score">
        <div className="flex items-center gap-4 mb-4">
          <SentimentDot score={score} />
          <span className="text-3xl font-bold tracking-tighter">{score.toFixed(2)}</span>
          <span className="text-xs font-bold uppercase text-[var(--color-text-secondary)]">{sentimentLabel(score)}</span>
        </div>

        {/* Per-department breakdown */}
        {Object.keys(sentimentByDept).length > 0 && (
          <div className="mt-3 pt-3 border-t border-[var(--color-border)]">
            <p className="mono-label text-[var(--color-text-secondary)] mb-2">By Department</p>
            <div className="space-y-1.5">
              {Object.entries(sentimentByDept).map(([dept, data]) => (
                <div key={dept} className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase">{dept}</span>
                  <div className="flex items-center gap-2">
                    <SentimentDot score={data.avg ?? 0} />
                    <span className="text-xs font-bold tabular-nums">{data.avg?.toFixed(2) ?? '—'}</span>
                    <span className="text-[9px] text-[var(--color-text-muted)]">({data.count})</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Panel>

      {/* Sentiment Trend */}
      <Panel title="Sentiment Trend">
        {trendData.length < 2 ? (
          <p className="text-sm text-[var(--color-text-secondary)] py-4 text-center">Not enough data for trend</p>
        ) : (
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={trendData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#93a1a1" />
              <XAxis dataKey="date" tick={{ fontSize: 9 }} interval={Math.ceil(trendData.length / 6)} />
              <YAxis tick={{ fontSize: 9 }} domain={[-1, 1]} ticks={[-1, -0.5, 0, 0.5, 1]} />
              <Tooltip formatter={(v) => [Number(v).toFixed(2), 'Sentiment']} />
              <Line type="monotone" dataKey="sentiment" stroke="#000000" strokeWidth={2} dot={false} name="Sentiment" />
            </LineChart>
          </ResponsiveContainer>
        )}
      </Panel>

      {/* Needs Attention */}
      <Panel title="Needs Attention">
        {!negativeTix || !Array.isArray(negativeTix) || negativeTix.length === 0 ? (
          <p className="text-sm text-[var(--color-text-secondary)] py-4 text-center">No negative sentiment tickets</p>
        ) : (
          <div className="space-y-2 max-h-[200px] overflow-y-auto">
            {negativeTix.map((t) => (
              <div
                key={t.ticketId}
                className="flex items-center gap-3 p-2 border border-[var(--color-border)] bg-bg-elevated"
              >
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold truncate">{t.agentName}</p>
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] font-bold uppercase px-1 py-0.5 border border-[var(--color-border)]">{t.dept}</span>
                    <span className="text-[9px] text-[var(--color-text-secondary)]">{t.messageCount} msgs</span>
                  </div>
                </div>
                <span className="text-xs font-bold tabular-nums">{t.avgSentiment.toFixed(2)}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>
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
