import { useState } from 'react';

/**
 * Dashboard Z3 — Staffing fit.
 *
 * Renders the dow×hour heatmap and the today-vs-typical strip from the
 * `dashboard.getStaffingHeatmap` payload. The optional staff-count
 * overlay (Z3b) is toggled per session — default off so admins opt in.
 *
 * Empty / warm-up rules from spec §7:
 *   - daysCollected === 0 (loading or fresh partner) -> generic empty
 *   - daysCollected < 7 -> "Need 7+ days of data. X collected so far."
 *   - daysCollected >= 7 -> render the matrix
 *
 * `excludeWeekends` hides Sat/Sun rows from the grid (the strip stays on
 * the today axis regardless — today might still be a weekend).
 */

export interface StaffingHeatmapData {
  heatmap: { dow: number; hour: number; tickets: number; staff?: number }[];
  todayVsTypical: { hour: number; todayCount: number; typicalCount: number }[];
  daysCollected: number;
}

export interface StaffingHeatmapZoneProps {
  data: StaffingHeatmapData | null;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  excludeWeekends?: boolean;
}

const DOW_LABELS_FULL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOURS = Array.from({ length: 24 }, (_, h) => h);

export function StaffingHeatmapZone({
  data,
  loading,
  error,
  onRetry,
  excludeWeekends,
}: StaffingHeatmapZoneProps) {
  const [showStaffOverlay, setShowStaffOverlay] = useState(false);

  if (loading) {
    return (
      <div data-testid="staffing-heatmap-loading" className="flex flex-col gap-2" aria-busy="true">
        <div className="h-6 bg-[var(--color-bg-elevated)] rounded animate-pulse" />
        <div className="h-32 bg-[var(--color-bg-elevated)] rounded animate-pulse" />
      </div>
    );
  }

  if (error) {
    return (
      <div data-testid="staffing-heatmap-error" className="flex items-center justify-between gap-3" role="alert">
        <span className="text-[13px] text-[var(--color-ink-muted)]">
          Could not load staffing data.
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

  if (data.daysCollected < 7) {
    return (
      <div className="text-[13px] text-[var(--color-ink-muted)]">
        Need 7+ days of data. {data.daysCollected} collected so far.
      </div>
    );
  }

  const cellIndex = new Map<string, number>();
  const staffIndex = new Map<string, number>();
  for (const c of data.heatmap) {
    cellIndex.set(`${c.dow}:${c.hour}`, c.tickets);
    if (c.staff !== undefined) staffIndex.set(`${c.dow}:${c.hour}`, c.staff);
  }
  const hasStaffData = staffIndex.size > 0;

  const maxTickets = data.heatmap.reduce((m, c) => Math.max(m, c.tickets), 0);
  const visibleDows = excludeWeekends ? [1, 2, 3, 4, 5] : [0, 1, 2, 3, 4, 5, 6];

  const stripMax = data.todayVsTypical.reduce(
    (m, s) => Math.max(m, s.todayCount, s.typicalCount),
    0,
  );

  return (
    <div className="flex flex-col gap-4">
      {hasStaffData && (
        <div className="flex justify-end">
          <button
            type="button"
            aria-pressed={showStaffOverlay}
            onClick={() => setShowStaffOverlay((v) => !v)}
            className="h-7 px-3 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-hover)] text-[11px] text-[var(--color-ink)] aria-pressed:bg-[var(--color-accent)] aria-pressed:text-white"
          >
            Staff overlay
          </button>
        </div>
      )}
      <div data-testid="staffing-today-strip" className="flex items-end gap-[2px] h-12">
        {data.todayVsTypical.map((slot) => {
          const todayH = stripMax > 0 ? (slot.todayCount / stripMax) * 100 : 0;
          const typicalH = stripMax > 0 ? (slot.typicalCount / stripMax) * 100 : 0;
          return (
            <div
              key={slot.hour}
              data-testid={`staffing-today-slot-${slot.hour}`}
              data-today={slot.todayCount}
              data-typical={slot.typicalCount}
              className="flex-1 relative h-full"
              title={`${slot.hour}:00 — today ${slot.todayCount}, typical ${slot.typicalCount}`}
            >
              <div
                className="absolute bottom-0 left-0 right-0 bg-[var(--color-ink-muted)] opacity-30"
                style={{ height: `${typicalH}%` }}
              />
              <div
                className="absolute bottom-0 left-0 right-0 bg-[var(--color-accent)]"
                style={{ height: `${todayH}%` }}
              />
            </div>
          );
        })}
      </div>

      <div data-testid="staffing-heatmap-grid" className="flex flex-col gap-[2px]">
        {visibleDows.map((dow) => (
          <div
            key={dow}
            data-testid={`staffing-row-${dow}`}
            className="flex items-center gap-[2px]"
          >
            <span className="w-10 text-[11px] text-[var(--color-ink-muted)]">
              {DOW_LABELS_FULL[dow]}
            </span>
            {HOURS.map((hour) => {
              const tickets = cellIndex.get(`${dow}:${hour}`) ?? 0;
              const staff = staffIndex.get(`${dow}:${hour}`);
              const intensity = maxTickets > 0 ? tickets / maxTickets : 0;
              const showBadge = showStaffOverlay && staff !== undefined;
              return (
                <div
                  key={hour}
                  data-testid={`staffing-cell-${dow}-${hour}`}
                  data-tickets={tickets}
                  data-intensity={intensity}
                  className="flex-1 h-5 rounded-sm flex items-center justify-center"
                  style={{
                    backgroundColor:
                      intensity > 0
                        ? `color-mix(in srgb, var(--color-accent) ${Math.round(intensity * 100)}%, transparent)`
                        : 'var(--color-bg-elevated)',
                  }}
                  title={`${DOW_LABELS_FULL[dow]} ${hour}:00 — ${tickets} tickets${staff !== undefined ? `, ${staff} staff` : ''}`}
                >
                  {showBadge && (
                    <span
                      data-testid={`staffing-cell-staff-${dow}-${hour}`}
                      className="text-[9px] font-medium text-[var(--color-ink)] leading-none"
                    >
                      {staff}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export default StaffingHeatmapZone;
