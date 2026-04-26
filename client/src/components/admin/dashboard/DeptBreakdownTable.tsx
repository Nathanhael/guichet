import { useMemo, useState } from 'react';

/**
 * Dashboard Z5 — Department breakdown table.
 *
 * Sortable HTML table with 4 columns: Department / Volume / SLA % / CSAT.
 * Controlled component — parent (DashboardView) owns the tRPC query and
 * passes results in. Empty array hides the entire table per spec §7
 * ("Z5 zero rows -> hide table entirely (no empty header)").
 *
 * Sort rules:
 *   - default: volume descending
 *   - clicking a header re-sorts; clicking the active header toggles direction
 *   - null SLA / CSAT values always sink to the bottom (asc + desc)
 *
 * Row drill-page click is phase-2 (per spec §5); rows are static for now.
 */

export interface DeptRow {
  id: string;
  name: string;
  volume: number;
  slaPct: number | null;
  csat: number | null;
  breachCount: number;
}

export interface DeptBreakdownTableProps {
  data: DeptRow[] | null;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
}

type SortKey = 'name' | 'volume' | 'slaPct' | 'csat';
type SortDirection = 'asc' | 'desc';

const TH =
  'sticky top-0 px-3 py-2 text-left text-[12px] font-medium uppercase tracking-wide text-[var(--color-ink-muted)] cursor-pointer select-none';
const TD = 'px-3 py-2 text-[13px] text-[var(--color-ink)]';

function compareNullable(a: number | null, b: number | null, direction: SortDirection): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1; // nulls always last
  if (b === null) return -1;
  return direction === 'asc' ? a - b : b - a;
}

function compareString(a: string, b: string, direction: SortDirection): number {
  const cmp = a.localeCompare(b);
  return direction === 'asc' ? cmp : -cmp;
}

export function DeptBreakdownTable({ data, loading, error, onRetry }: DeptBreakdownTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('volume');
  const [direction, setDirection] = useState<SortDirection>('desc');

  const sorted = useMemo(() => {
    if (!data) return null;
    const rows = [...data];
    rows.sort((a, b) => {
      switch (sortKey) {
        case 'name':
          return compareString(a.name, b.name, direction);
        case 'volume':
          return direction === 'asc' ? a.volume - b.volume : b.volume - a.volume;
        case 'slaPct':
          return compareNullable(a.slaPct, b.slaPct, direction);
        case 'csat':
          return compareNullable(a.csat, b.csat, direction);
      }
    });
    return rows;
  }, [data, sortKey, direction]);

  if (loading) {
    return (
      <div data-testid="dept-breakdown-loading" className="flex flex-col gap-2" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-6 bg-[var(--color-bg-elevated)] rounded animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div data-testid="dept-breakdown-error" className="flex items-center justify-between gap-3" role="alert">
        <span className="text-[13px] text-[var(--color-ink-muted)]">
          Could not load department breakdown.
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

  if (!sorted || sorted.length === 0) return null;

  function header(label: string, key: SortKey) {
    const active = sortKey === key;
    const ariaSort = active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none';
    const arrow = active ? (direction === 'asc' ? ' ▲' : ' ▼') : '';
    return (
      <th
        scope="col"
        aria-sort={ariaSort}
        className={TH}
        onClick={() => {
          if (active) {
            setDirection(direction === 'asc' ? 'desc' : 'asc');
          } else {
            setSortKey(key);
            setDirection(key === 'name' ? 'asc' : 'desc');
          }
        }}
      >
        {label}
        {arrow}
      </th>
    );
  }

  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          {header('Department', 'name')}
          {header('Volume', 'volume')}
          {header('SLA %', 'slaPct')}
          {header('CSAT', 'csat')}
        </tr>
      </thead>
      <tbody>
        {sorted.map((row) => (
          <tr key={row.id} className="border-t border-[var(--color-border)]">
            <td className={TD}>{row.name}</td>
            <td className={TD}>{row.volume}</td>
            <td className={TD}>{row.slaPct === null ? '—' : `${Math.round(row.slaPct)}%`}</td>
            <td className={TD}>{row.csat === null ? '—' : row.csat.toFixed(1)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default DeptBreakdownTable;
