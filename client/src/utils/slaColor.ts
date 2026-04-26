/**
 * SLA scorecard color band.
 *
 * Phase 1 of the dashboard redesign uses one colored card (SLA %); CSAT and
 * Volume stay neutral. Inputs come from the per-department config:
 * `slaTargetMinutes` drives whether a ticket counts as "met", and
 * `slaWarnPercent` widens the amber band below the met-percentage target.
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
 *
 * Mirror the same logic in `server/services/dashboard/scorecard.ts` when the
 * backend slice lands; both call sites must agree on band thresholds.
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
