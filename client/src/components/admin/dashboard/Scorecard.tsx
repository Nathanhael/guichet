/**
 * Dashboard Z2 — Scorecard.
 *
 * Three controlled cards (SLA, CSAT, Volume) with big-number + trend +
 * SLA color band per spec §3 / §8. Parent owns the tRPC query and passes
 * data in. Click on any card routes to its drill-down per spec §5:
 *   SLA -> AdminTickets filtered to breached
 *   CSAT -> AdminSatisfaction
 *   Volume -> AdminTickets (current period)
 */

export type SlaBand = 'green' | 'amber' | 'red' | 'neutral';

export interface ScorecardCardData {
  value: number | null;
  prevValue: number | null;
  deltaPct: number | null;
  band: SlaBand;
  tooltip?: string;
}

export interface ScorecardData {
  sla: ScorecardCardData;
  csat: ScorecardCardData;
  volume: ScorecardCardData;
}

export interface ScorecardProps {
  data: ScorecardData | null;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
}

const CARD_BASE =
  'flex flex-col gap-2 p-4 rounded-[var(--radius-card)] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-hover)] shadow-[var(--shadow-soft)] transition-colors no-underline';
const CARD_LABEL =
  'text-[12px] uppercase tracking-wide text-[var(--color-ink-muted)]';
const CARD_VALUE =
  'text-[28px] font-semibold leading-none text-[var(--color-ink)]';
const CARD_DELTA = 'text-[11px] text-[var(--color-ink-muted)]';

const BAND_COLOR: Record<SlaBand, string> = {
  green: 'var(--color-ok, #22c55e)',
  amber: 'var(--color-accent-amber, #f59e0b)',
  red: 'var(--color-urgent, #ef4444)',
  neutral: 'transparent',
};

export function Scorecard({ data, loading, error, onRetry }: ScorecardProps) {
  if (loading) {
    return (
      <div data-testid="scorecard-loading" className="grid grid-cols-3 gap-3" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-24 rounded-[var(--radius-card)] bg-[var(--color-bg-elevated)] animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div data-testid="scorecard-error" className="flex items-center justify-between gap-3" role="alert">
        <span className="text-[13px] text-[var(--color-ink-muted)]">
          Could not load scorecard.
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

  return (
    <div className="grid grid-cols-3 gap-3">
      <Card
        testId="scorecard-sla"
        label="SLA"
        href="/admin/tickets?slaBreached=1"
        card={data.sla}
        format="percent"
      />
      <Card
        testId="scorecard-csat"
        label="CSAT"
        href="/admin/satisfaction"
        card={data.csat}
        format="decimal"
      />
      <Card
        testId="scorecard-volume"
        label="Volume"
        href="/admin/tickets"
        card={data.volume}
        format="integer"
      />
    </div>
  );
}

interface CardProps {
  testId: string;
  label: string;
  href: string;
  card: ScorecardCardData;
  format: 'percent' | 'decimal' | 'integer';
}

function formatValue(value: number | null, format: CardProps['format']): string {
  if (value === null) return '—';
  if (format === 'percent') return `${value.toFixed(1)}%`;
  if (format === 'decimal') return value.toFixed(1);
  return Math.round(value).toString();
}

function trendDirection(deltaPct: number | null): 'up' | 'down' | undefined {
  if (deltaPct === null || deltaPct === 0) return undefined;
  return deltaPct > 0 ? 'up' : 'down';
}

function Card({ testId, label, href, card, format }: CardProps) {
  const trend = trendDirection(card.deltaPct);
  const dataAttrs: Record<string, string> = {
    'data-testid': testId,
    'data-band': card.band,
  };
  if (trend) dataAttrs['data-trend'] = trend;
  if (card.tooltip) dataAttrs.title = card.tooltip;

  return (
    <a
      href={href}
      aria-label={label}
      className={CARD_BASE}
      style={{ borderTop: `2px solid ${BAND_COLOR[card.band]}` }}
      {...dataAttrs}
    >
      <span className={CARD_LABEL}>{label}</span>
      <span
        data-testid={`${testId}-value`}
        className={CARD_VALUE}
        title={card.value === null ? 'Need 1+ closed ticket' : undefined}
      >
        {formatValue(card.value, format)}
      </span>
      {card.deltaPct !== null ? (
        <span className={CARD_DELTA} aria-label={`${trend === 'up' ? 'Up' : 'Down'} ${Math.abs(card.deltaPct)} percent vs previous period`}>
          {trend === 'up' ? '▲' : '▼'} {Math.abs(card.deltaPct).toFixed(1)}%
        </span>
      ) : (
        <span className={CARD_DELTA}>&nbsp;</span>
      )}
    </a>
  );
}

export default Scorecard;
