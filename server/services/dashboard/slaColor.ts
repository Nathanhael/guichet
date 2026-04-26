/**
 * SLA scorecard color band — server mirror.
 *
 * Identical logic to `client/src/utils/slaColor.ts`. The two files MUST stay
 * in sync; the dashboard scorecard uses both — backend stamps the `band`
 * field on the wire payload, frontend recomputes for live optimistic state.
 * Until a shared package exists, duplicate-and-test.
 *
 * @param actualPct  observed % of tickets that met SLA in the window
 * @param targetPct  configured target met-percentage (null when SLA unset)
 * @param warnPct    width of the amber band below target (clamped to >= 0)
 *
 * Banding:
 *   actual >= target               -> green
 *   target - warn <= actual < target -> amber
 *   actual < target - warn         -> red
 *   target null / actual null/NaN  -> neutral
 */
export type SlaBand = 'green' | 'amber' | 'red' | 'neutral';

export function slaColor(
  actualPct: number | null,
  targetPct: number | null,
  warnPct: number,
): SlaBand {
  if (targetPct === null || targetPct === undefined) return 'neutral';
  if (actualPct === null || actualPct === undefined) return 'neutral';
  if (Number.isNaN(actualPct) || Number.isNaN(targetPct)) return 'neutral';

  const safeWarn = Math.max(0, warnPct);
  if (actualPct >= targetPct) return 'green';
  if (actualPct >= targetPct - safeWarn) return 'amber';
  return 'red';
}
