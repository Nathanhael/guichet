import type {
  DashboardFilters,
  DashboardPreset,
} from '../../../hooks/useDashboardFilters';

/**
 * Dashboard filter bar — controlled component.
 *
 * Owns no state. Reads `filters` and exposes the four mutators of
 * `useDashboardFilters` (`applyPreset`, `setFilter`, `reset` reserved for
 * follow-up). Render this once at the top of `DashboardView`.
 *
 * The export and refresh buttons here are wiring stubs: callers pass
 * `onExportCsv` / `onExportPdf` / `onRefresh` when the dashboard procedures
 * land in subsequent slices. Buttons disable themselves when no handler is
 * provided so the visual chrome stays in place.
 */

const PRESET_BUTTONS: { value: DashboardPreset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7d' },
  { value: '14d', label: '14d' },
  { value: '30d', label: '30d' },
];

export interface FilterBarProps {
  filters: DashboardFilters;
  applyPreset: (preset: DashboardPreset) => void;
  setFilter: <K extends keyof DashboardFilters>(
    key: K,
    value: DashboardFilters[K],
  ) => void;
  reset: () => void;
  departments: { id: string; name: string }[];
  onRefresh?: () => void;
  onExportCsv?: () => void;
  onExportPdf?: () => void;
}

const PRESET_BTN_BASE =
  'h-8 px-3 inline-flex items-center rounded-[var(--radius-btn)] text-[12px] font-medium transition-colors';
const PRESET_BTN_OFF =
  'bg-[var(--color-bg-elevated)] text-[var(--color-ink-muted)] hover:bg-[var(--color-hover)]';
const PRESET_BTN_ON =
  'bg-[var(--color-accent)] text-white shadow-[var(--shadow-soft)]';
const SECONDARY_BTN =
  'h-8 px-3 inline-flex items-center gap-1.5 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-hover)] disabled:opacity-50 disabled:cursor-not-allowed text-[var(--color-ink)] text-[12px] font-medium transition-colors';
const INPUT =
  'h-8 px-2.5 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] text-[12px] text-[var(--color-ink)] border border-transparent focus:border-[var(--color-accent)] focus:outline-none';

export function FilterBar({
  filters,
  applyPreset,
  setFilter,
  departments,
  onRefresh,
  onExportCsv,
  onExportPdf,
}: FilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-1" role="group" aria-label="Date preset">
        {PRESET_BUTTONS.map(({ value, label }) => {
          const active = filters.preset === value;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={active}
              onClick={() => applyPreset(value)}
              className={`${PRESET_BTN_BASE} ${active ? PRESET_BTN_ON : PRESET_BTN_OFF}`}
            >
              {label}
            </button>
          );
        })}
      </div>

      <label className="flex items-center gap-1.5 text-[12px] text-[var(--color-ink-muted)]">
        <span className="sr-only">From date</span>
        <input
          type="date"
          aria-label="From date"
          value={filters.dateFrom ?? ''}
          onChange={(e) =>
            setFilter('dateFrom', e.target.value === '' ? undefined : e.target.value)
          }
          className={INPUT}
        />
      </label>

      <label className="flex items-center gap-1.5 text-[12px] text-[var(--color-ink-muted)]">
        <span className="sr-only">To date</span>
        <input
          type="date"
          aria-label="To date"
          value={filters.dateTo ?? ''}
          onChange={(e) =>
            setFilter('dateTo', e.target.value === '' ? undefined : e.target.value)
          }
          className={INPUT}
        />
      </label>

      <label className="flex items-center gap-1.5 text-[12px] text-[var(--color-ink-muted)]">
        <span className="sr-only">Department</span>
        <select
          aria-label="Department"
          value={filters.dept ?? ''}
          onChange={(e) =>
            setFilter('dept', e.target.value === '' ? undefined : e.target.value)
          }
          className={INPUT}
        >
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2 text-[12px] text-[var(--color-ink-muted)]">
        <input
          type="checkbox"
          aria-label="Exclude weekends"
          checked={filters.excludeWeekends}
          onChange={(e) => setFilter('excludeWeekends', e.target.checked)}
        />
        Exclude weekends
      </label>

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={onRefresh}
          disabled={!onRefresh}
          className={SECONDARY_BTN}
        >
          Refresh
        </button>
        <button
          type="button"
          onClick={onExportCsv}
          disabled={!onExportCsv}
          className={SECONDARY_BTN}
        >
          Export CSV
        </button>
        <button
          type="button"
          onClick={onExportPdf}
          disabled={!onExportPdf}
          className={SECONDARY_BTN}
        >
          Export PDF
        </button>
      </div>
    </div>
  );
}

export default FilterBar;
