import { useState } from 'react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useT } from '../../i18n';
import { trpc } from '../../utils/trpc';

function formatSeconds(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// Recharts Tooltip formatter — typed to satisfy Formatter<ValueType, NameType>
const tooltipFormatter = (value: number | string) => formatSeconds(Number(value) || 0);

interface DailyStatusRow {
  date: string;
  userId: string;
  onlineSeconds: number;
  awaySeconds: number;
}

interface AgentStatusStatsProps {
  userId?: string;
}

export default function AgentStatusStats({ userId }: AgentStatusStatsProps) {
  const t = useT();
  const today = new Date().toISOString().slice(0, 10);
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);

  const { data: teamStats } = userId
    ? trpc.status.getAgentStats.useQuery({ userId, fromDate, toDate })
    : trpc.status.getTeamStats.useQuery({ fromDate, toDate });

  const chartData = ((teamStats || []) as DailyStatusRow[]).map((row) => ({
    name: row.userId.slice(0, 8),
    date: row.date,
    Online: row.onlineSeconds,
    Away: row.awaySeconds,
  }));

  return (
    <div className="border border-border bg-bg-surface p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-mono font-bold uppercase tracking-widest text-text-primary">
          {t('time_in_status')}
        </h3>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="text-[11px] font-mono bg-bg-elevated border border-border px-2 py-1 text-text-primary"
          />
          <span className="text-text-muted text-[11px]">→</span>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="text-[11px] font-mono bg-bg-elevated border border-border px-2 py-1 text-text-primary"
          />
        </div>
      </div>

      {chartData.length === 0 ? (
        <div className="text-text-muted text-xs text-center py-8">{t('no_data') || 'No data for selected period'}</div>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={chartData} layout="horizontal">
            <XAxis dataKey="date" tick={{ fontSize: 10, fontFamily: 'JetBrains Mono' }} />
            <YAxis
              tickFormatter={(v: number) => formatSeconds(v)}
              tick={{ fontSize: 10, fontFamily: 'JetBrains Mono' }}
            />
            <Tooltip
              formatter={tooltipFormatter as never}
              contentStyle={{
                backgroundColor: 'var(--color-bg-surface)',
                border: '1px solid var(--color-border-heavy)',
                fontFamily: 'JetBrains Mono',
                fontSize: 11,
              }}
            />
            <Legend wrapperStyle={{ fontFamily: 'JetBrains Mono', fontSize: 10 }} />
            <Bar dataKey="Online" fill="var(--color-accent-green)" />
            <Bar dataKey="Away" fill="var(--color-accent-amber)" />
          </BarChart>
        </ResponsiveContainer>
      )}

      {/* Historical trend — only show for multi-day ranges */}
      {chartData.length > 1 && (
        <div className="mt-4 pt-4 border-t border-border">
          <div className="text-[9px] font-mono font-bold uppercase tracking-widest text-text-muted mb-2">
            Availability Trend
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={chartData}>
              <XAxis dataKey="date" tick={{ fontSize: 10, fontFamily: 'JetBrains Mono' }} />
              <YAxis
                tickFormatter={(v: number) => formatSeconds(v)}
                tick={{ fontSize: 10, fontFamily: 'JetBrains Mono' }}
              />
              <Tooltip
                formatter={tooltipFormatter as never}
                contentStyle={{
                  backgroundColor: 'var(--color-bg-surface)',
                  border: '1px solid var(--color-border-heavy)',
                  fontFamily: 'JetBrains Mono',
                  fontSize: 11,
                }}
              />
              <Line type="monotone" dataKey="Online" stroke="var(--color-accent-green)" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="Away" stroke="var(--color-accent-amber)" strokeWidth={1.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {chartData.length > 0 && (
        <div className="flex gap-4 flex-wrap mt-3 pt-3 border-t border-border">
          {(['Online', 'Away'] as const).map((key) => {
            const total = chartData.reduce((sum, row) => sum + ((row as unknown as Record<string, number>)[key] || 0), 0);
            const colorMap: Record<string, string> = {
              Online: 'bg-accent-green',
              Away: 'bg-accent-amber',
            };
            return (
              <div key={key} className="flex items-center gap-1.5">
                <span className={`w-2 h-2 ${colorMap[key]}`} />
                <span className="text-[9px] font-mono text-text-muted">{key} {formatSeconds(total)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
