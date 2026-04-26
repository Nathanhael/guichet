import type { DashboardFilters } from '../hooks/useDashboardFilters';

/**
 * Convert dashboard filter state into the explicit `{ dateFrom, dateTo }`
 * pair the tRPC dashboard procedures expect.
 *
 * Presets are inclusive ranges anchored on "today" (UTC):
 *   today -> single-day range
 *   7d    -> today minus 6
 *   14d   -> today minus 13
 *   30d   -> today minus 29
 *   custom -> uses stored dateFrom / dateTo (falls back to today on either)
 */
export function resolveDateRange(
  filters: DashboardFilters,
  now: Date = new Date(),
): { dateFrom: string; dateTo: string } {
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const todayStr = today.toISOString().slice(0, 10);

  const presetDays =
    filters.preset === 'today'
      ? 0
      : filters.preset === '7d'
        ? 6
        : filters.preset === '14d'
          ? 13
          : filters.preset === '30d'
            ? 29
            : null;

  if (presetDays !== null) {
    const from = new Date(today);
    from.setUTCDate(from.getUTCDate() - presetDays);
    return {
      dateFrom: from.toISOString().slice(0, 10),
      dateTo: todayStr,
    };
  }

  return {
    dateFrom: filters.dateFrom ?? todayStr,
    dateTo: filters.dateTo ?? todayStr,
  };
}
