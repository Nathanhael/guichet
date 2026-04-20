import { useState } from 'react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useT } from '../../i18n';
import { trpc } from '../../utils/trpc';

function formatSeconds(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const tooltipFormatter = (value: number | string) => formatSeconds(Number(value) || 0);

const CHART_TICK = { fontSize: 11, fontFamily: 'Inter, sans-serif', fill: 'var(--color-ink-muted)' };
const TOOLTIP_STYLE = {
  backgroundColor: 'var(--color-bg-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  fontFamily: 'Inter, sans-serif',
  fontSize: 12,
  boxShadow: 'var(--shadow-modal)',
};

interface DailyStatusRow {
  date: string;
  userId: string;
  onlineSeconds: number;
  awaySeconds: number;
}

interface AgentStatusStatsProps {
  userId?: string;
}

const DATE_INPUT = 'text-[12px] bg-[var(--color-bg-elevated)] rounded-[var(--radius-btn)] px-2.5 py-1 text-[var(--color-ink)] border border-transparent focus:border-[var(--color-accent)] focus:outline-none';

export default function AgentStatusStats({ userId }: AgentStatusStatsProps) {
  const t = useT();
  const today = new Date().toISOString().slice(0, 10);
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);

  const { data: teamStats } = userId
    ? trpc.status.getAgentStats.useQuery({ userId, fromDate, toDate })
    : trpc.status.getTeamStats.useQuery({ fromDate, toDate });

  const rows = Array.isArray(teamStats) ? (teamStats as DailyStatusRow[]) : [];
  const chartData = rows
    .filter((row) => row && typeof row.userId === 'string')
    .map((row) => ({
      name: row.userId.slice(0, 8),
      date: row.date,
      Online: row.onlineSeconds,
      Away: row.awaySeconds,
    }));

  return (
    <div className="rounded-[var(--radius-card)] bg-[var(--color-bg-surface)] shadow-[var(--shadow-card)] p-5">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <h3 className="text-[13px] font-semibold text-[var(--color-ink)]">
          {t('time_in_status')}
        </h3>
        <div className="flex items-center gap-2">
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className={DATE_INPUT} />
          <span className="text-[var(--color-ink-muted)] text-[12px]">→</span>
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className={DATE_INPUT} />
        </div>
      </div>

      {chartData.length === 0 ? (
        <div className="text-[var(--color-ink-muted)] text-[13px] text-center py-8">{t('no_data') || 'No data for selected period'}</div>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={chartData} layout="horizontal">
            <XAxis dataKey="date" tick={CHART_TICK} tickLine={false} axisLine={{ stroke: 'var(--color-border)' }} />
            <YAxis
              tickFormatter={(v: number) => formatSeconds(v)}
              tick={CHART_TICK}
              tickLine={false}
              axisLine={{ stroke: 'var(--color-border)' }}
            />
            <Tooltip formatter={tooltipFormatter as never} contentStyle={TOOLTIP_STYLE} />
            <Legend wrapperStyle={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: 'var(--color-ink-soft)' }} />
            <Bar dataKey="Online" fill="var(--color-accent-green)" radius={[4, 4, 0, 0]} />
            <Bar dataKey="Away" fill="var(--color-accent-amber)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}

      {chartData.length > 1 && (
        <div className="mt-4 pt-4 border-t border-[var(--color-border)]">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-muted)] mb-2">
            Availability Trend
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={chartData}>
              <XAxis dataKey="date" tick={CHART_TICK} tickLine={false} axisLine={{ stroke: 'var(--color-border)' }} />
              <YAxis
                tickFormatter={(v: number) => formatSeconds(v)}
                tick={CHART_TICK}
                tickLine={false}
                axisLine={{ stroke: 'var(--color-border)' }}
              />
              <Tooltip formatter={tooltipFormatter as never} contentStyle={TOOLTIP_STYLE} />
              <Line type="monotone" dataKey="Online" stroke="var(--color-accent-green)" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="Away" stroke="var(--color-accent-amber)" strokeWidth={1.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {chartData.length > 0 && (
        <div className="flex gap-4 flex-wrap mt-3 pt-3 border-t border-[var(--color-border)]">
          {(['Online', 'Away'] as const).map((key) => {
            const total = chartData.reduce((sum, row) => sum + ((row as unknown as Record<string, number>)[key] || 0), 0);
            const bg = key === 'Online' ? 'var(--color-accent-green)' : 'var(--color-accent-amber)';
            return (
              <div key={key} className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: bg }} />
                <span className="text-[12px] text-[var(--color-ink-muted)]">{key} {formatSeconds(total)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
