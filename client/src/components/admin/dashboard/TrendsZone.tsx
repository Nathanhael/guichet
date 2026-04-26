import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

/**
 * Dashboard Z4 — Trend charts.
 *
 * Three Recharts lines (Volume / CSAT / Avg response) at the granularity
 * the server picks based on window length. Empty / thin states from
 * spec §7: the first chart appears once each series has at least 3 points.
 */

export type TrendGranularity = 'daily' | 'weekly' | 'monthly';

export interface TrendPoint {
  bucket: string;
  value: number | null;
}

export interface TrendsData {
  granularity: TrendGranularity;
  series: {
    volume: TrendPoint[];
    csat: TrendPoint[];
    avgResponseMinutes: TrendPoint[];
  };
}

export interface TrendsZoneProps {
  data: TrendsData | null;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
}

const GRANULARITY_LABEL: Record<TrendGranularity, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
};

const TOOLTIP_STYLE: React.CSSProperties = {
  backgroundColor: 'var(--color-bg-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  boxShadow: 'var(--shadow-card)',
  color: 'var(--color-ink)',
  fontFamily: 'Inter, system-ui, sans-serif',
  fontSize: 12,
};

const TICK = {
  fontSize: 11,
  fill: 'var(--color-ink-muted)',
  fontFamily: 'Inter, system-ui, sans-serif',
} as const;

export function TrendsZone({ data, loading, error, onRetry }: TrendsZoneProps) {
  if (loading) {
    return (
      <div data-testid="trends-loading" className="grid grid-cols-3 gap-3" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-32 rounded-[var(--radius-card)] bg-[var(--color-bg-elevated)] animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div data-testid="trends-error" className="flex items-center justify-between gap-3" role="alert">
        <span className="text-[13px] text-[var(--color-ink-muted)]">
          Could not load trend data.
        </span>
        <button
          type="button"
          onClick={onRetry}
          className="h-8 px-3 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-hover)] text-[12px] text-[var(--color-ink)]"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  const minPoints = Math.min(
    data.series.volume.length,
    data.series.csat.length,
    data.series.avgResponseMinutes.length,
  );

  if (minPoints < 3) {
    return (
      <div className="text-[13px] text-[var(--color-ink-muted)]">
        Not enough data — first chart appears at 3+ data points.
      </div>
    );
  }

  return (
    <div
      data-testid="trends-root"
      data-granularity={data.granularity}
      className="flex flex-col gap-3"
    >
      <div className="text-[11px] uppercase tracking-wide text-[var(--color-ink-muted)]">
        {GRANULARITY_LABEL[data.granularity]}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <ChartPanel
          testId="trends-chart-volume"
          title="Volume"
          data={data.series.volume}
          color="var(--color-accent)"
        />
        <ChartPanel
          testId="trends-chart-csat"
          title="CSAT"
          data={data.series.csat}
          color="var(--color-accent)"
        />
        <ChartPanel
          testId="trends-chart-response"
          title="Avg response (min)"
          data={data.series.avgResponseMinutes}
          color="var(--color-accent)"
        />
      </div>
    </div>
  );
}

interface ChartPanelProps {
  testId: string;
  title: string;
  data: TrendPoint[];
  color: string;
}

function ChartPanel({ testId, title, data, color }: ChartPanelProps) {
  return (
    <div
      data-testid={testId}
      data-points={data.length}
      className="rounded-[var(--radius-card)] bg-[var(--color-bg-elevated)] p-3"
    >
      <div className="text-[12px] text-[var(--color-ink-muted)] mb-1">{title}</div>
      <ResponsiveContainer width="100%" height={120}>
        <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--color-border)" vertical={false} />
          <XAxis dataKey="bucket" tick={TICK} tickLine={false} axisLine={false} />
          <YAxis tick={TICK} tickLine={false} axisLine={false} width={28} />
          <Tooltip contentStyle={TOOLTIP_STYLE} />
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default TrendsZone;
