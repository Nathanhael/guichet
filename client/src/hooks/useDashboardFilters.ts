import { useCallback, useEffect, useState } from 'react';

/**
 * Filter state for the AdminView dashboard.
 *
 * Persisted in `window.location.search` via `history.replaceState` so that
 * (a) the morning glance is bookmarkable / shareable, (b) reload preserves
 * the view, and (c) browser back/forward replays the filter state.
 *
 * URL encoding (kept tidy — defaults are stripped):
 *   preset=<today|7d|14d|30d|custom>   (omit when '7d')
 *   from=YYYY-MM-DD, to=YYYY-MM-DD     (only when preset='custom')
 *   dept=<slug>
 *   weekends=off                       (only when excludeWeekends=true)
 */
export type DashboardPreset = 'today' | '7d' | '14d' | '30d' | 'custom';

export interface DashboardFilters {
  preset: DashboardPreset;
  dateFrom?: string;
  dateTo?: string;
  dept?: string;
  excludeWeekends: boolean;
}

export interface UseDashboardFiltersResult {
  filters: DashboardFilters;
  setFilter: <K extends keyof DashboardFilters>(
    key: K,
    value: DashboardFilters[K],
  ) => void;
  applyPreset: (preset: DashboardPreset) => void;
  reset: () => void;
}

const VALID_PRESETS: DashboardPreset[] = ['today', '7d', '14d', '30d', 'custom'];
const DEFAULT_PRESET: DashboardPreset = '7d';

const DEFAULTS: DashboardFilters = {
  preset: DEFAULT_PRESET,
  dateFrom: undefined,
  dateTo: undefined,
  dept: undefined,
  excludeWeekends: false,
};

function readFromUrl(): DashboardFilters {
  if (typeof window === 'undefined') return { ...DEFAULTS };
  const p = new URLSearchParams(window.location.search);

  const rawPreset = p.get('preset');
  const preset: DashboardPreset =
    rawPreset && (VALID_PRESETS as string[]).includes(rawPreset)
      ? (rawPreset as DashboardPreset)
      : DEFAULT_PRESET;

  return {
    preset,
    dateFrom: p.get('from') ?? undefined,
    dateTo: p.get('to') ?? undefined,
    dept: p.get('dept') ?? undefined,
    excludeWeekends: p.get('weekends') === 'off',
  };
}

function writeToUrl(filters: DashboardFilters): void {
  if (typeof window === 'undefined') return;
  const p = new URLSearchParams(window.location.search);

  if (filters.preset === DEFAULT_PRESET) p.delete('preset');
  else p.set('preset', filters.preset);

  if (filters.dateFrom) p.set('from', filters.dateFrom);
  else p.delete('from');

  if (filters.dateTo) p.set('to', filters.dateTo);
  else p.delete('to');

  if (filters.dept) p.set('dept', filters.dept);
  else p.delete('dept');

  if (filters.excludeWeekends) p.set('weekends', 'off');
  else p.delete('weekends');

  const next = p.toString();
  const current = window.location.search.replace(/^\?/, '');
  if (next === current) return;
  const url = `${window.location.pathname}${next ? `?${next}` : ''}${window.location.hash}`;
  window.history.replaceState(null, '', url);
}

export function useDashboardFilters(): UseDashboardFiltersResult {
  const [filters, setFilters] = useState<DashboardFilters>(() => readFromUrl());

  const commit = useCallback((next: DashboardFilters) => {
    setFilters(next);
    writeToUrl(next);
  }, []);

  const setFilter = useCallback(
    <K extends keyof DashboardFilters>(key: K, value: DashboardFilters[K]) => {
      setFilters((prev) => {
        const next: DashboardFilters = { ...prev, [key]: value };
        if (key === 'dateFrom' || key === 'dateTo') {
          next.preset = 'custom';
        }
        writeToUrl(next);
        return next;
      });
    },
    [],
  );

  const applyPreset = useCallback(
    (preset: DashboardPreset) => {
      setFilters((prev) => {
        const next: DashboardFilters = {
          ...prev,
          preset,
          ...(preset !== 'custom'
            ? { dateFrom: undefined, dateTo: undefined }
            : {}),
        };
        writeToUrl(next);
        return next;
      });
    },
    [],
  );

  const reset = useCallback(() => {
    commit({ ...DEFAULTS });
  }, [commit]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = () => setFilters(readFromUrl());
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, []);

  return { filters, setFilter, applyPreset, reset };
}
