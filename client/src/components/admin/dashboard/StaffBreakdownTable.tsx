import { useMemo, useState } from 'react';

/**
 * Dashboard Z5 — Staff breakdown table.
 *
 * Sortable HTML table: Name / Handled / Avg response / CSAT. Same controlled
 * pattern as `DeptBreakdownTable` — parent owns the tRPC query, passes rows
 * in. Empty array hides the entire table per spec §7.
 *
 * Sort rules:
 *   - default: handled descending
 *   - clicking a header re-sorts; clicking the active header toggles direction
 *   - null avg-response / CSAT always sink to the bottom (asc + desc)
 *
 * Per-staff drill-page click is phase-2; rows stay static this slice.
 */

export interface StaffRow {
  id: string;
  name: string;
  handled: number;
  avgResponseMinutes: number | null;
  csat: number | null;
}

export interface StaffBreakdownTableProps {
  data: StaffRow[] | null;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
}

type SortKey = 'name' | 'handled' | 'avgResponseMinutes' | 'csat';
type SortDirection = 'asc' | 'desc';

const TH =
  'sticky top-0 px-3 py-2 text-left text-[12px] font-medium uppercase tracking-wide text-[var(--color-ink-muted)] cursor-pointer select-none';
const TD = 'px-3 py-2 text-[13px] text-[var(--color-ink)]';

function compareNullable(a: number | null, b: number | null, direction: SortDirection): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return direction === 'asc' ? a - b : b - a;
}

function compareString(a: string, b: string, direction: SortDirection): number {
  const cmp = a.localeCompare(b);
  return direction === 'asc' ? cmp : -cmp;
}

export function StaffBreakdownTable({ data, loading, error, onRetry }: StaffBreakdownTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('handled');
  const [direction, setDirection] = useState<SortDirection>('desc');

  const sorted = useMemo(() => {
    if (!data) return null;
    const rows = [...data];
    rows.sort((a, b) => {
      switch (sortKey) {
        case 'name':
          return compareString(a.name, b.name, direction);
        case 'handled':
          return direction === 'asc' ? a.handled - b.handled : b.handled - a.handled;
        case 'avgResponseMinutes':
          return compareNullable(a.avgResponseMinutes, b.avgResponseMinutes, direction);
        case 'csat':
          return compareNullable(a.csat, b.csat, direction);
      }
    });
    return rows;
  }, [data, sortKey, direction]);

  if (loading) {
    return (
      <div data-testid="staff-breakdown-loading" className="flex flex-col gap-2" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-6 bg-[var(--color-bg-elevated)] rounded animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div data-testid="staff-breakdown-error" className="flex items-center justify-between gap-3" role="alert">
        <span className="text-[13px] text-[var(--color-ink-muted)]">
          Could not load staff breakdown.
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
          {header('Name', 'name')}
          {header('Handled', 'handled')}
          {header('Avg response', 'avgResponseMinutes')}
          {header('CSAT', 'csat')}
        </tr>
      </thead>
      <tbody>
        {sorted.map((row) => (
          <tr key={row.id} className="border-t border-[var(--color-border)]">
            <td className={TD}>{row.name}</td>
            <td className={TD}>{row.handled}</td>
            <td className={TD}>
              {row.avgResponseMinutes === null
                ? '—'
                : `${Math.round(row.avgResponseMinutes)} min`}
            </td>
            <td className={TD}>{row.csat === null ? '—' : row.csat.toFixed(1)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default StaffBreakdownTable;
